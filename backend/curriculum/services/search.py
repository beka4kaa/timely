"""Поиск по книгам пользователя.

Тонкий слой поверх готового `KnowledgeRetrievalService`: собирает кандидатов из
БД, отдаёт их сервису и переводит результат в форму ответа API.

Политику доступа здесь заново НЕ пишем. Она целиком в
`retrieval.apply_access_policy`, куда сервис ходит сам: правило «решения задач
ученику не отдаются» должно жить в одном месте, иначе новый endpoint однажды
разойдётся со старым.
"""

from __future__ import annotations

from dataclasses import dataclass

from ..models import Document, KnowledgeChunk
from ..retrieval import (
    KnowledgeRetrievalService,
    RetrievalBundle,
    RetrievalPolicy,
    get_lexical_retriever,
)
from .chunk_view import as_retrievable

# Сколько фрагментов максимум вернуть за запрос.
DEFAULT_LIMIT = 10
MAX_LIMIT = 50


@dataclass(frozen=True)
class SearchRequest:
    user_email: str
    query: str
    document_ids: list[str]
    limit: int
    mode: str


def search_chunks(request: SearchRequest) -> RetrievalBundle:
    """Гибридный поиск по документам пользователя.

    Кандидаты ограничены документами ЭТОГО пользователя ещё на уровне queryset,
    а не только политикой: два независимых рубежа дешевле одного, и первый из
    них не зависит от того, правильно ли вызвана вторая проверка.
    """
    documents = Document.objects.filter(user_email=request.user_email)
    if request.document_ids:
        documents = documents.filter(pk__in=request.document_ids)
    document_map = {str(doc.pk): doc for doc in documents}
    if not document_map:
        return RetrievalBundle(policy_mode=request.mode)

    chunks = [
        as_retrievable(chunk, document_map[str(chunk.document_id)])
        # `select_related("task")` убран: задача осталась в основной базе,
        # а JOIN между базами невозможен. `task_id` и так лежит в самом
        # чанке, и политике доступа этого достаточно.
        for chunk in KnowledgeChunk.objects.filter(document_id__in=document_map)
        .order_by("page_start", "id")
    ]
    if not chunks:
        return RetrievalBundle(policy_mode=request.mode)

    policy = RetrievalPolicy(mode=request.mode, max_chunks=request.limit)
    return KnowledgeRetrievalService(lexical=get_lexical_retriever()).retrieve(
        user_email=request.user_email,
        query=request.query,
        chunks=chunks,
        policy=policy,
        document_ids=list(document_map),
    )


def bundle_to_payload(bundle: RetrievalBundle) -> dict:
    """Ответ API.

    Векторов здесь нет и быть не должно: эмбеддинг — это внутреннее
    представление, отдавать его наружу незачем, а весит он в разы больше самого
    фрагмента.
    """
    return {
        "policy_mode": bundle.policy_mode,
        "truncated": bundle.truncated,
        "total_tokens": bundle.total_tokens,
        "results": [
            {
                "chunk_id": result.chunk_id,
                "document_id": result.document_id,
                "chunk_type": result.chunk_type,
                "section_path": result.section_path,
                "page_start": result.page_start,
                "page_end": result.page_end,
                "excerpt": result.excerpt,
                "citation": result.citation.render(),
                "retrieval_method": result.retrieval_method,
                "confidence": round(result.confidence, 4),
            }
            for result in bundle.results
        ],
    }


def clamp_limit(raw) -> int:
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return DEFAULT_LIMIT
    return max(1, min(value, MAX_LIMIT))
