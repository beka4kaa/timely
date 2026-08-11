"""Состояние поискового индекса книги: построен ли он и из чего состоит.

Нужно, чтобы отличать «эмбеддинги плохие» от «эмбеддингов нет». Разница видна
только изнутри: `PgVectorDenseRetriever` отбирает фрагменты по
`embedding_status=READY` И по точному совпадению `embedding_model`. Не совпало —
плотная половина гибрида возвращает пусто, ошибки при этом нет, и поиск тихо
вырождается в лексический. Снаружи это выглядит просто как «отвечает так себе».

Модуль ходит в базу, но не в сеть и ничего не считает моделью: диагностику не
должно быть страшно запускать сколько угодно раз.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .models import Document, KnowledgeChunk


def _percentile(values: list[int], share: float) -> int:
    if not values:
        return 0
    ordered = sorted(values)
    index = max(0, math.ceil(len(ordered) * share) - 1)
    return ordered[index]


@dataclass
class IndexStats:
    """Всё, что нужно знать об индексе одной книги."""

    document_id: str
    title: str
    language: str
    processing_version: str
    page_count: int = 0

    total_chunks: int = 0
    #: Сколько фрагментов в каждом статусе эмбеддинга.
    by_status: dict[str, int] = field(default_factory=dict)
    #: Какие модели лежат в базе и сколько готовых фрагментов у каждой.
    models: dict[str, int] = field(default_factory=dict)
    #: Модель, которой сейчас считался бы вектор запроса.
    active_model: str = ""
    #: Фрагменты без привязки к разделу: они не попадут ни в одну цитату.
    unbound_chunks: int = 0
    #: Размер фрагмента в токенах.
    tokens_min: int = 0
    tokens_median: int = 0
    tokens_p95: int = 0
    tokens_max: int = 0

    @property
    def ready_chunks(self) -> int:
        return self.by_status.get(KnowledgeChunk.EmbeddingStatus.READY, 0)

    @property
    def searchable_chunks(self) -> int:
        """Сколько фрагментов реально доступно плотному поиску.

        Готовых мало — это ещё не всё: считаются только те, что посчитаны
        ДЕЙСТВУЮЩЕЙ моделью. Остальные для `PgVectorDenseRetriever` не
        существуют.
        """
        return self.models.get(self.active_model, 0) if self.active_model else 0

    @property
    def dense_search_works(self) -> bool:
        return self.searchable_chunks > 0

    def problems(self) -> list[str]:
        """Найденные неполадки простым языком. Пусто — индекс здоров."""
        found: list[str] = []
        if not self.total_chunks:
            found.append("У книги нет ни одного фрагмента — она не обработана.")
            return found

        if not self.active_model:
            found.append(
                "Провайдер эмбеддингов не настроен: плотный поиск отключён, "
                "работает только лексический."
            )
        elif not self.dense_search_works:
            stored = ", ".join(sorted(self.models)) or "ничего"
            found.append(
                f"Ни один фрагмент не посчитан действующей моделью "
                f"«{self.active_model}» (в базе: {stored}). Плотный поиск "
                "возвращает пусто, и гибрид вырождается в лексический."
            )
        elif self.searchable_chunks < self.total_chunks:
            found.append(
                f"Плотному поиску доступно {self.searchable_chunks} фрагментов "
                f"из {self.total_chunks}: остальные не посчитаны или считались "
                "другой моделью."
            )

        failed = self.by_status.get(KnowledgeChunk.EmbeddingStatus.FAILED, 0)
        if failed:
            found.append(f"{failed} фрагментов не удалось посчитать.")

        if self.unbound_chunks:
            found.append(
                f"{self.unbound_chunks} фрагментов не привязаны к разделу — "
                "по ним нельзя дать цитату."
            )

        if not self.language:
            found.append(
                "У книги не проставлен язык: полнотекстовый поиск возьмёт "
                "конфигурацию по умолчанию вместо морфологии языка."
            )
        return found

    def as_dict(self) -> dict:
        return {
            "document_id": self.document_id,
            "title": self.title,
            "language": self.language,
            "processing_version": self.processing_version,
            "page_count": self.page_count,
            "total_chunks": self.total_chunks,
            "by_status": dict(self.by_status),
            "models": dict(self.models),
            "active_model": self.active_model,
            "searchable_chunks": self.searchable_chunks,
            "dense_search_works": self.dense_search_works,
            "unbound_chunks": self.unbound_chunks,
            "tokens": {
                "min": self.tokens_min,
                "median": self.tokens_median,
                "p95": self.tokens_p95,
                "max": self.tokens_max,
            },
            "problems": self.problems(),
        }


def collect_index_stats(document: Document, *, active_model: str = "") -> IndexStats:
    """Собирает состояние индекса книги.

    `active_model` передаётся снаружи, чтобы модуль не решал сам, настроен ли
    провайдер: команда знает это лучше и умеет объяснить пользователю.
    """
    stats = IndexStats(
        document_id=str(document.pk),
        title=document.title,
        language=document.language,
        processing_version=document.processing_version,
        page_count=document.page_count,
        active_model=active_model,
    )

    chunks = KnowledgeChunk.objects.filter(
        document_id=document.pk,
        processing_version=document.processing_version,
    )
    rows = list(
        chunks.values_list(
            "embedding_status", "embedding_model", "token_count", "section_id"
        )
    )
    stats.total_chunks = len(rows)
    if not rows:
        return stats

    tokens: list[int] = []
    for status, model, token_count, section_id in rows:
        stats.by_status[status] = stats.by_status.get(status, 0) + 1
        if status == KnowledgeChunk.EmbeddingStatus.READY and model:
            stats.models[model] = stats.models.get(model, 0) + 1
        if section_id is None:
            stats.unbound_chunks += 1
        tokens.append(int(token_count or 0))

    stats.tokens_min = min(tokens)
    stats.tokens_max = max(tokens)
    stats.tokens_median = _percentile(tokens, 0.5)
    stats.tokens_p95 = _percentile(tokens, 0.95)
    return stats
