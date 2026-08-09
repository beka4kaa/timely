"""Индексация фрагментов книги векторами.

Главное свойство модуля: обычная ошибка embedding-провайдера не бросается. Она
не должна превращать успешно разобранный учебник в проваленную загрузку. Одно
исключение — `AIUsageLimitExceeded`: скрыть его как warning означало бы сделать
hard quota фиктивной, поэтому оно доходит до worker wrapper.

Второе свойство: повторная загрузка той же книги стоит $0. Вектор привязан к
`content_hash` фрагмента и модели, поэтому уже посчитанный фрагмент
переиспользуется, а не пересчитывается.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Callable, Collection
from uuid import UUID

from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from ai_engine.usage import AIUsageLimitExceeded

from ..embeddings import (
    EMBEDDING_BATCH_SIZE,
    EmbeddingProvider,
    estimate_tokens,
    get_embedding_provider,
)
from ..models import Document, KnowledgeChunk

logger = logging.getLogger(__name__)

# Один готовый vector(1536), материализованный как Python floats, заметно
# тяжелее своих 6 КБ в PostgreSQL. Ограничиваем reuse-выборку, чтобы 4000
# совпадений не превратились в сотни мегабайт одновременно.
REUSE_BATCH_SIZE = 100


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
    # ``iterator`` не оставляет все совпавшие строки в QuerySet cache. Это
    # важно и при небольшом входном батче: один content_hash может встречаться
    # в тысячах ранее проиндексированных строк.
    for content_hash, embedding in rows.iterator(chunk_size=REUSE_BATCH_SIZE):
        if content_hash not in found and embedding is not None:
            found[content_hash] = list(embedding)
    return found


def _reusable_hashes(
    chunks: list[KnowledgeChunk], *, model: str
) -> set[str]:
    """Готовые хеши для dry-run без чтения 1536-мерных массивов."""
    hashes = {chunk.content_hash for chunk in chunks if chunk.content_hash}
    if not hashes or not model:
        return set()
    return set(
        KnowledgeChunk.objects.filter(
            content_hash__in=hashes,
            embedding_status=KnowledgeChunk.EmbeddingStatus.READY,
            embedding_model=model,
        )
        .exclude(embedding=None)
        .values_list("content_hash", flat=True)
        .distinct()
    )


def index_document_chunks(
    document: Document,
    *,
    provider: EmbeddingProvider | None = None,
    heartbeat: Callable[[], None] | None = None,
    chunk_ids: Collection[UUID] | None = None,
    force_reindex: bool = False,
) -> IndexOutcome:
    """Считает и записывает векторы; наружу проходит только quota denial.

    ``chunk_ids`` привязывает вызов к строкам конкретного ingestion-запуска.
    Без этого оживший старый воркер мог после перезапуска выбрать уже новые
    фрагменты того же документа и записать в них результат своего провайдера.
    """
    outcome = IndexOutcome()
    try:
        return _index(
            document,
            provider or get_embedding_provider(),
            outcome,
            heartbeat=heartbeat,
            chunk_ids=chunk_ids,
            force_reindex=force_reindex,
        )
    except AIUsageLimitExceeded:
        raise
    except Exception:  # noqa: BLE001 — индексация не роняет обработку книги
        logger.exception("Индексация векторов упала для документа %s", document.pk)
        outcome.warnings.append("embedding_index_crashed")
        return outcome


def _index(
    document: Document,
    provider: EmbeddingProvider,
    outcome: IndexOutcome,
    *,
    heartbeat: Callable[[], None] | None,
    chunk_ids: Collection[UUID] | None,
    force_reindex: bool,
) -> IndexOutcome:
    model = getattr(provider, "model", "") or provider.name
    outcome.model = model
    pending_query = KnowledgeChunk.objects.filter(document_id=document.pk)
    if chunk_ids is not None:
        pending_query = pending_query.filter(pk__in=chunk_ids)
    if force_reindex:
        # Принудительный прогон выбирает READY тоже, но ничего не очищает
        # заранее: overflow и неудачный новый вызов не должны уничтожать
        # последний пригодный вектор.
        pass
    elif provider.name == "null-embedding":
        pending_query = pending_query.exclude(
            embedding_status=KnowledgeChunk.EmbeddingStatus.READY
        )
    else:
        # READY от другой модели — не готов: сравнивать такие векторы с query
        # текущей модели нельзя. Смена EMBEDDING_MODEL сама ставит их в работу.
        pending_query = pending_query.filter(
            ~Q(
                embedding_status=KnowledgeChunk.EmbeddingStatus.READY,
                embedding_model=model,
            )
        )
    # Старый READY-вектор нужен только базе как fallback при force-reindex;
    # тащить его в Python вместе с каждым кандидатом незачем.
    pending_query = pending_query.defer("embedding").order_by("page_start", "id")
    pending_count = pending_query.count()
    outcome.considered = pending_count
    if not pending_count:
        return outcome

    limit = _max_chunks()
    pending = list(pending_query[:limit])
    overflow_count = pending_count - len(pending)
    if overflow_count:
        # В force-режиме строки за пределом лимита вообще не трогаем: на них
        # остаётся последний READY-вектор. Обычная первичная индексация, как и
        # раньше, переводит непокрытый хвост в SKIPPED.
        if not force_reindex:
            overflow_ids = list(
                pending_query.values_list("pk", flat=True)[limit:]
            )
            KnowledgeChunk.objects.filter(pk__in=overflow_ids).update(
                embedding_status=KnowledgeChunk.EmbeddingStatus.SKIPPED
            )
        outcome.skipped += overflow_count
        outcome.warnings.append(
            f"embedding_capped_at_{limit}_of_{pending_count}_chunks"
        )

    if provider.name == "null-embedding":
        # Провайдер не настроен: помечаем `skipped`, а не `failed`. Это не
        # ошибка, и повторять такие чанки при каждом прогоне бессмысленно —
        # состояние изменится только вместе с конфигурацией.
        if not force_reindex:
            KnowledgeChunk.objects.filter(
                pk__in=[chunk.pk for chunk in pending]
            ).update(embedding_status=KnowledgeChunk.EmbeddingStatus.SKIPPED)
        outcome.skipped += len(pending)
        outcome.warnings.append("embedding_not_configured")
        return outcome

    # 1. Даром: то, что уже посчитано этой же моделью для того же текста.
    # Векторы читаются ограниченными порциями и освобождаются сразу после
    # bulk_update, иначе 4000 × 1536 Python floats легко занимают 150+ МБ.
    remaining: list[KnowledgeChunk] = []
    now = timezone.now()
    for start in range(0, len(pending), REUSE_BATCH_SIZE):
        candidates = pending[start : start + REUSE_BATCH_SIZE]
        reusable = {} if force_reindex else _reuse_map(candidates, model=model)
        reused_rows: list[KnowledgeChunk] = []
        for chunk in candidates:
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
                batch_size=REUSE_BATCH_SIZE,
            )
            outcome.reused += len(reused_rows)
        for chunk in reused_rows:
            chunk.embedding = None
        del reusable
        del reused_rows
        del candidates
    del pending

    # 2. За деньги: всё остальное, батчами.
    for start in range(0, len(remaining), EMBEDDING_BATCH_SIZE):
        batch = remaining[start : start + EMBEDDING_BATCH_SIZE]
        texts = [chunk.normalized_text for chunk in batch]
        result = provider.embed(texts)
        if heartbeat:
            heartbeat()

        if not result.matches(texts):
            # Падение батча помечает ТОЛЬКО свои чанки: соседние батчи могли
            # пройти, и глобальный `failed` стёр бы этот факт.
            failed_ids = [
                chunk.pk
                for chunk in batch
                if not (
                    force_reindex
                    and chunk.embedding_status == KnowledgeChunk.EmbeddingStatus.READY
                )
            ]
            if failed_ids:
                KnowledgeChunk.objects.filter(pk__in=failed_ids).update(
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
            # Канонический ключ пространства — запрошенная provider.model.
            # Ответ API может вернуть alias/revision и тогда dense-фильтр по
            # текущей модели иначе перестанет видеть только что записанный ряд.
            chunk.embedding_model = model
            chunk.embedded_at = stamped
            chunk.embedding_status = KnowledgeChunk.EmbeddingStatus.READY
        KnowledgeChunk.objects.bulk_update(
            batch,
            ["embedding", "embedding_model", "embedded_at", "embedding_status"],
            batch_size=200,
        )
        outcome.embedded += len(batch)
        for chunk in batch:
            chunk.embedding = None
        del result
        del texts
        del batch

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
    document: Document, *, model: str = "", include_ready: bool = False
) -> IndexEstimate:
    """Считает объём работы, ничего не меняя и никуда не ходя.

    Нужна `--dry-run` команде: стоимость показывается ДО того, как потрачена.
    """
    pending_query = KnowledgeChunk.objects.filter(document_id=document.pk)
    if not include_ready:
        if model:
            pending_query = pending_query.filter(
                ~Q(
                    embedding_status=KnowledgeChunk.EmbeddingStatus.READY,
                    embedding_model=model,
                )
            )
        else:
            pending_query = pending_query.exclude(
                embedding_status=KnowledgeChunk.EmbeddingStatus.READY
            )
    limit = _max_chunks()
    pending = list(
        pending_query.only(
            "id",
            "content_hash",
            "token_count",
            "normalized_text",
            "page_start",
        ).order_by("page_start", "id")[: limit + 1]
    )
    capped = len(pending) > limit
    considered = pending[:limit]

    # Force-reindex действительно пересчитывает выбранные строки, поэтому их
    # собственные старые векторы не уменьшают оценку. Обычному dry-run нужны
    # только хеши совпадений, а не сами массивы embedding.
    reusable = (
        set()
        if include_ready
        else _reusable_hashes(considered, model=model)
    )
    billable = [c for c in considered if c.content_hash not in reusable]
    return IndexEstimate(
        chunks=len(considered),
        reusable=len(considered) - len(billable),
        billable_chunks=len(billable),
        approx_tokens=sum(
            c.token_count or estimate_tokens(c.normalized_text) for c in billable
        ),
        capped=capped,
    )
