"""Профилирование разделов книги: map-стадия с кэшем.

Порядок работы намеренно не «профилировать всё подряд».

**Сначала главы.** Профиль главы отвечает на вопрос планировщика — что здесь
за материал и как его группировать. Параграфы профилируются только тогда, когда
глава слишком велика, чтобы быть одной темой. На «Механике» это разница между
16 вызовами и 158.

**Кэш по содержимому.** Ключ — версия обработки, состав фрагментов раздела и
версия промпта. Книга не меняется, а планов по ней ученик строит несколько:
второй план не платит за профилирование вовсе.

**Один плохой раздел не роняет книгу.** Ошибка вызова гасится и записывается в
отчёт; планировщик получит такой раздел без профиля, то есть ровно так, как
видел его раньше.
"""

from __future__ import annotations

import contextvars
import hashlib
import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from django.db import transaction

from ..models import DocumentSection, KnowledgeChunk, SectionProfile
from ..profiles.context import build_context, collect_statistics
from ..profiles.contracts import PROFILE_PROMPT_VERSION, ProfileResult, ProfilingRequest
from ..profiles.providers import get_profiling_provider

logger = logging.getLogger(__name__)

# Сколько разделов профилируется одновременно. Потолок низкий сознательно:
# провайдеры OpenRouter отдают 429 задолго до того, как параллельность начнёт
# экономить время, а книга профилируется один раз.
MAX_CONCURRENCY = 4

# Глава крупнее — и её параграфы профилируются отдельно: одной темой такой
# материал не станет, а планировщику нужно знать, по какому шву делить.
LARGE_CHAPTER_PAGES = 15


@dataclass
class ProfilingReport:
    """Что произошло. Нужен, чтобы стоимость прогона была видна числом."""

    requested: int = 0
    from_cache: int = 0
    generated: int = 0
    failed: int = 0
    skipped_empty: int = 0
    errors: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "requested": self.requested,
            "from_cache": self.from_cache,
            "generated": self.generated,
            "failed": self.failed,
            "skipped_empty": self.skipped_empty,
        }


def compute_content_hash(
    section: DocumentSection, *, processing_version: str, chunk_ids: list[str]
) -> str:
    """Ключ кэша.

    Версия промпта входит наравне с содержимым: если мы стали спрашивать у
    модели другое, старый ответ не подходит, даже когда текст раздела тот же.
    """
    payload = "|".join(
        [
            PROFILE_PROMPT_VERSION,
            processing_version,
            str(section.pk),
            section.title or "",
            str(section.start_page or 0),
            str(section.end_page or 0),
            ",".join(sorted(chunk_ids)),
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def sections_to_profile(document, *, include_subsections: bool = True):
    """Главы, а к ним — параграфы только крупных глав.

    Профилировать каждый параграф книги можно, но это восьмикратная стоимость
    ради разделов, которые планировщик всё равно объединит в одну тему.
    """
    teachable = list(
        DocumentSection.objects.filter(document=document, is_teachable=True)
    )
    # Часть книги (level 1) — контейнер на сотню страниц. Её профиль слился бы
    # в «здесь про механику» и не помог бы ничему, зато стоил бы самого
    # дорогого контекста в книге. Профилируется глава.
    chapters = [s for s in teachable if s.level == 2]
    if not chapters:
        # Плоская книга без частей: главы лежат на первом уровне.
        chapters = [s for s in teachable if s.level <= 1]
    if not include_subsections:
        return chapters

    large = {
        chapter.pk
        for chapter in chapters
        if (chapter.end_page or 0) - (chapter.start_page or 0) >= LARGE_CHAPTER_PAGES
    }
    subsections = [
        section
        for section in teachable
        if section.level > 2 and section.parent_id in large
    ]
    return chapters + subsections


def profile_document_sections(
    document,
    *,
    processing_version: str = "",
    include_subsections: bool = True,
    provider=None,
) -> ProfilingReport:
    """Профилирует разделы книги и возвращает отчёт о прогоне."""
    version = processing_version or document.processing_version
    provider = provider or get_profiling_provider()
    report = ProfilingReport()

    pending: list[tuple[DocumentSection, ProfilingRequest, str]] = []
    selected = sections_to_profile(document, include_subsections=include_subsections)
    for section in selected:
        report.requested += 1
        chunk_ids = _chunk_ids(section, version)
        content_hash = compute_content_hash(
            section, processing_version=version, chunk_ids=chunk_ids
        )
        if _is_fresh(section, content_hash):
            report.from_cache += 1
            continue

        context = build_context(section, processing_version=version)
        if not context.strip():
            # Раздел без текста профилировать нечем. Это не ошибка: так
            # выглядят титул, пустая рубрика и глава, чей текст не распознался.
            report.skipped_empty += 1
            continue

        pending.append(
            (
                section,
                ProfilingRequest(
                    section_id=str(section.pk),
                    title=section.title,
                    number_label=section.number_label,
                    structural_role=section.structural_role,
                    level=section.level,
                    page_start=section.start_page or 0,
                    page_end=section.end_page or 0,
                    context=context,
                    content_statistics=collect_statistics(
                        section, processing_version=version
                    ),
                ),
                content_hash,
            )
        )

    if not pending:
        return report

    # Контекст копируется НА КАЖДЫЙ раздел, а не один раз на всех.
    # `copy_context` обязателен сам по себе — usage-метрики и tenant живут в
    # ContextVar и в пул сами не переезжают, воркер увидел бы пустой контекст и
    # записал расход не тому пользователю. Но один и тот же объект контекста
    # нельзя войти из двух потоков одновременно: Python отвечает «cannot enter
    # context: … is already entered». Снимок на задачу снимает и то, и другое.
    # Копии снимаются здесь, в родительском потоке: внутри воркера копировать
    # уже нечего — там контекст пуст.
    tasks = [(contextvars.copy_context(), item) for item in pending]

    def run(task):
        context, (section, request, content_hash) = task
        return section, request, content_hash, context.run(
            _profile_one, provider, request
        )

    workers = min(MAX_CONCURRENCY, len(tasks))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for section, request, content_hash, result in pool.map(run, tasks):
            if result is None:
                report.failed += 1
                report.errors.append(str(section.pk))
                continue
            _save(
                section,
                document,
                result,
                content_hash=content_hash,
                processing_version=version,
                statistics=request.content_statistics,
            )
            report.generated += 1

    return report


def _profile_one(provider, request: ProfilingRequest) -> ProfileResult | None:
    try:
        return provider.profile(request)
    except Exception as exc:  # провайдер, сеть, таймаут — причина не меняет реакцию
        logger.warning(
            "Профилирование раздела %s не удалось: %s", request.section_id, exc
        )
        return None


def _chunk_ids(section: DocumentSection, processing_version: str) -> list[str]:
    from ..profiles.context import descendant_ids

    queryset = KnowledgeChunk.objects.filter(section_id__in=descendant_ids(section))
    if processing_version:
        queryset = queryset.filter(processing_version=processing_version)
    return [str(pk) for pk in queryset.values_list("id", flat=True)]


def _is_fresh(section: DocumentSection, content_hash: str) -> bool:
    existing = SectionProfile.objects.filter(section=section).first()
    return existing is not None and existing.content_hash == content_hash


def _save(
    section: DocumentSection,
    document,
    result: ProfileResult,
    *,
    content_hash: str,
    processing_version: str,
    statistics: dict,
) -> None:
    with transaction.atomic():
        SectionProfile.objects.update_or_create(
            section=section,
            defaults={
                "document": document,
                "summary": result.summary,
                "concepts": result.concepts,
                "skills": result.skills,
                "prerequisites": result.prerequisites,
                "difficulty": result.difficulty,
                "is_teachable": result.is_teachable,
                "content_statistics": statistics,
                "content_hash": content_hash,
                "processing_version": processing_version,
                "prompt_version": result.prompt_version,
                "model": (result.model or "")[:160],
            },
        )
        # Оглавление обещало теорию, а в разделе одни ответы — доверяем тексту.
        # Обратное неверно: отметку `is_teachable=false`, поставленную по роли
        # раздела («Ответы», «Указатель»), профиль не отменяет, иначе одна
        # ошибка модели вернёт в программу приложение с ответами.
        if section.is_teachable and not result.is_teachable:
            section.is_teachable = False
            section.save(update_fields=["is_teachable"])
