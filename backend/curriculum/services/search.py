"""Поиск по книгам пользователя.

Тонкий слой поверх готового `KnowledgeRetrievalService`: собирает кандидатов из
БД, отдаёт их сервису и переводит результат в форму ответа API.

Политику доступа здесь заново НЕ пишем. Она целиком в
`retrieval.apply_access_policy`, куда сервис ходит сам: правило «решения задач
ученику не отдаются» должно жить в одном месте, иначе новый endpoint однажды
разойдётся со старым.
"""

from __future__ import annotations

import logging
from contextlib import nullcontext
from dataclasses import dataclass

from celery.exceptions import SoftTimeLimitExceeded
from django.db import transaction

from ..models import Document, KnowledgeChunk
from ..retrieval import (
    KnowledgeRetrievalService,
    RetrievalBundle,
    RetrievalPolicy,
    get_lexical_retriever,
)
from .chunk_view import as_retrievable
from .embedding_index import request_vector_repair

logger = logging.getLogger(__name__)

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
        # `select_related("task")` не нужен: у куска нет внешнего ключа на
        # задачу, а `task_id` лежит в самом куске.
        for chunk in KnowledgeChunk.objects.defer("embedding")
        .filter(document_id__in=document_map)
        .order_by("page_start", "id")
    ]
    if not chunks:
        return RetrievalBundle(policy_mode=request.mode)

    _request_vector_repair(list(document_map))

    policy = RetrievalPolicy(mode=request.mode, max_chunks=request.limit)
    return KnowledgeRetrievalService(lexical=get_lexical_retriever()).retrieve(
        user_email=request.user_email,
        query=request.query,
        chunks=chunks,
        policy=policy,
        document_ids=list(document_map),
    )


def _request_vector_repair(document_ids: list[str]) -> None:
    """Недостающие векторы задетых книг снова в очередь (решение 11).

    Поиск отвечает как обычно при любой ошибке починки: по словам куски
    находятся и без векторов. Кэш ключей — таблица в той же базе, и ошибка её
    запроса на Postgres обрывает всю транзакцию. Поэтому внутри чужой
    транзакции починка идёт в точке сохранения (`transaction.atomic`): откат
    снимает только её запросы, и поиск идёт дальше.

    Вне транзакции (autocommit, как в обычном запросе) точки сохранения нет:
    там каждый запрос и так своя транзакция. `atomic()` открыл бы настоящую, и
    ключ кэша ждал бы фиксации до конца публикации, а второй вопрос по той же
    книге — вместе с ним.
    """
    in_transaction = transaction.get_connection().in_atomic_block
    try:
        with transaction.atomic() if in_transaction else nullcontext():
            request_vector_repair(document_ids)
    except SoftTimeLimitExceeded:
        raise
    except Exception as exc:  # noqa: BLE001 — починка не ломает поиск
        logger.warning("Починку векторов запросить не удалось: %s", exc, exc_info=True)


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
