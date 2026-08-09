"""Индексация фрагментов книги векторами.

Главное свойство модуля: `index_document_chunks` **никогда не бросает**. Она
вызывается из середины пайплайна обработки книги, и провал эмбеддингов не
должен превращать успешно разобранный учебник в проваленную загрузку. Книга без
векторов полностью рабочая — лексический поиск и программа по ней строятся как
раньше, просто плотного поиска нет.

Второе свойство: повторная загрузка той же книги стоит $0. Вектор привязан к
`content_hash` фрагмента и модели, поэтому уже посчитанный фрагмент
переиспользуется, а не пересчитывается.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from django.conf import settings
from django.utils import timezone

from ..embeddings import (
    EMBEDDING_BATCH_SIZE,
    EmbeddingProvider,
    estimate_tokens,
    get_embedding_provider,
)
from ..models import Document, KnowledgeChunk

logger = logging.getLogger(__name__)


@dataclass
class IndexOutcome:
    """Что произошло. Возвращается вместо исключений."""

    considered: int = 0
    reused: int = 0
    embedded: int = 0
    skipped: int = 0
    failed: int = 0
    model: str = ""
    warnings: list[str] = field(default_factory=list)

    @property
    def touched(self) -> int:
        return self.reused + self.embedded


def _max_chunks() -> int:
    return int(getattr(settings, "CURRICULUM_MAX_EMBEDDED_CHUNKS", 4000))


def _reuse_map(
    chunks: list[KnowledgeChunk], *, model: str
) -> dict[str, list[float]]:
    """Готовые векторы для тех же `content_hash`, посчитанные ТОЙ ЖЕ моделью.

    Сравнение по модели обязательно: векторы разных моделей несопоставимы, и
    переиспользовать чужой — значит тихо смешать два несовместимых пространства
    в одном индексе.
    """
    hashes = {chunk.content_hash for chunk in chunks if chunk.content_hash}
    if not hashes or not model:
        return {}

    found: dict[str, list[float]] = {}
    rows = (
        KnowledgeChunk.objects.filter(
            content_hash__in=hashes,
            embedding_status=KnowledgeChunk.EmbeddingStatus.READY,
            embedding_model=model,
        )
        .exclude(embedding=None)
        .values_list("content_hash", "embedding")
    )
    for content_hash, embedding in rows:
        if content_hash not in found and embedding is not None:
            found[content_hash] = list(embedding)
    return found


def index_document_chunks(
    document: Document, *, provider: EmbeddingProvider | None = None
) -> IndexOutcome:
    """Считает и записывает векторы фрагментов документа. Не бросает никогда."""
    outcome = IndexOutcome()
    try:
        return _index(document, provider or get_embedding_provider(), outcome)
    except Exception:  # noqa: BLE001 — индексация не роняет обработку книги
        logger.exception("Индексация векторов упала для документа %s", document.pk)
        outcome.warnings.append("embedding_index_crashed")
        return outcome


def _index(
    document: Document, provider: EmbeddingProvider, outcome: IndexOutcome
) -> IndexOutcome:
    pending = list(
        KnowledgeChunk.objects.filter(document=document)
        .exclude(embedding_status=KnowledgeChunk.EmbeddingStatus.READY)
        .order_by("page_start", "id")
    )
    outcome.considered = len(pending)
    if not pending:
        return outcome

    if provider.name == "null-embedding":
        # Провайдер не настроен: помечаем `skipped`, а не `failed`. Это не
        # ошибка, и повторять такие чанки при каждом прогоне бессмысленно —
        # состояние изменится только вместе с конфигурацией.
        KnowledgeChunk.objects.filter(
            pk__in=[chunk.pk for chunk in pending]
        ).update(embedding_status=KnowledgeChunk.EmbeddingStatus.SKIPPED)
        outcome.skipped = len(pending)
        outcome.warnings.append("embedding_not_configured")
        return outcome

    limit = _max_chunks()
    if len(pending) > limit:
        overflow = pending[limit:]
        pending = pending[:limit]
        KnowledgeChunk.objects.filter(pk__in=[c.pk for c in overflow]).update(
            embedding_status=KnowledgeChunk.EmbeddingStatus.SKIPPED
        )
        outcome.skipped += len(overflow)
        outcome.warnings.append(
            f"embedding_capped_at_{limit}_of_{limit + len(overflow)}_chunks"
        )

    model = getattr(provider, "model", "") or provider.name
    outcome.model = model

    # 1. Даром: то, что уже посчитано этой же моделью для того же текста.
    reusable = _reuse_map(pending, model=model)
    remaining: list[KnowledgeChunk] = []
    now = timezone.now()
    reused_rows: list[KnowledgeChunk] = []
    for chunk in pending:
        vector = reusable.get(chunk.content_hash)
        if vector is None:
            remaining.append(chunk)
            continue
        chunk.embedding = vector
        chunk.embedding_model = model
        chunk.embedded_at = now
        chunk.embedding_status = KnowledgeChunk.EmbeddingStatus.READY
        reused_rows.append(chunk)

    if reused_rows:
        KnowledgeChunk.objects.bulk_update(
            reused_rows,
            ["embedding", "embedding_model", "embedded_at", "embedding_status"],
            batch_size=200,
        )
        outcome.reused = len(reused_rows)

    # 2. За деньги: всё остальное, батчами.
    for start in range(0, len(remaining), EMBEDDING_BATCH_SIZE):
        batch = remaining[start : start + EMBEDDING_BATCH_SIZE]
        texts = [chunk.normalized_text for chunk in batch]
        result = provider.embed(texts)

        if not result.matches(texts):
            # Падение батча помечает ТОЛЬКО свои чанки: соседние батчи могли
            # пройти, и глобальный `failed` стёр бы этот факт.
            KnowledgeChunk.objects.filter(pk__in=[c.pk for c in batch]).update(
                embedding_status=KnowledgeChunk.EmbeddingStatus.FAILED
            )
            outcome.failed += len(batch)
            code = (result.error or "embedding_failed").split(":")[0]
            if code not in outcome.warnings:
                outcome.warnings.append(code)
            continue

        stamped = timezone.now()
        for chunk, vector in zip(batch, result.vectors):
            chunk.embedding = vector
            chunk.embedding_model = result.model or model
            chunk.embedded_at = stamped
            chunk.embedding_status = KnowledgeChunk.EmbeddingStatus.READY
        KnowledgeChunk.objects.bulk_update(
            batch,
            ["embedding", "embedding_model", "embedded_at", "embedding_status"],
            batch_size=200,
        )
        outcome.embedded += len(batch)

    return outcome


@dataclass(frozen=True)
class IndexEstimate:
    """Оценка до траты: сколько фрагментов и примерно сколько токенов."""

    chunks: int
    reusable: int
    billable_chunks: int
    approx_tokens: int
    capped: bool


def estimate_document_index(
    document: Document, *, model: str = ""
) -> IndexEstimate:
    """Считает объём работы, ничего не меняя и никуда не ходя.

    Нужна `--dry-run` команде: стоимость показывается ДО того, как потрачена.
    """
    pending = list(
        KnowledgeChunk.objects.filter(document=document)
        .exclude(embedding_status=KnowledgeChunk.EmbeddingStatus.READY)
        .order_by("page_start", "id")
    )
    limit = _max_chunks()
    capped = len(pending) > limit
    considered = pending[:limit]

    reusable = _reuse_map(considered, model=model) if model else {}
    billable = [c for c in considered if c.content_hash not in reusable]
    return IndexEstimate(
        chunks=len(considered),
        reusable=len(considered) - len(billable),
        billable_chunks=len(billable),
        approx_tokens=sum(estimate_tokens(c.normalized_text) for c in billable),
        capped=capped,
    )
