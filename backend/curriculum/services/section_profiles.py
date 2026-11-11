"""Профилирование разделов книги: map-стадия с кэшем.

Разбор идёт при составлении программы, а не после загрузки книги (решение 14),
и в два шага. `plan_section_profiling` без вызовов модели решает, какие разделы
разобрать, и оценивает цену каждого. `run_section_profiling` разбирает те из
них, на которые программа нашла лимит и время.

**Начатый раздел не бросается.** После срока новые разделы не стартуют, а
начатые программа ждёт ещё `LATE_RESULT_GRACE_SECONDS`. Раздел, который
досчитался позже, оплачен: его профиль сохраняет сам поток пула, и следующая
программа за него не платит.

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
import functools
import hashlib
import logging
import threading
import time
from collections import deque
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass, field

from django.db import connection, transaction

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

# Сколько секунд после срока разбора программа ещё ждёт начатые разделы.
# Дольше раздел досчитывается без неё и сохраняет профиль сам.
LATE_RESULT_GRACE_SECONDS = 30


@dataclass
class ProfilingReport:
    """Что произошло. Нужен, чтобы стоимость прогона была видна числом."""

    requested: int = 0
    from_cache: int = 0
    generated: int = 0
    failed: int = 0
    skipped_empty: int = 0
    # Не поместились в лимит, который программа нашла под разбор.
    skipped_limit: int = 0
    # Очередь дошла до раздела после срока: вызов не начинался.
    skipped_time: int = 0
    # Профиль успела сохранить другая программа по этой же книге, пока раздел
    # ждал своей очереди. Вызов не нужен, профиль есть.
    reused: int = 0
    # Ещё идут, когда программа перестала ждать: досчитаются и сохранят профиль
    # сами, но этой программе уже не достанутся. Токены — сумма их оценок.
    still_running: int = 0
    still_running_tokens: int = 0
    errors: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "requested": self.requested,
            "from_cache": self.from_cache,
            "generated": self.generated,
            "failed": self.failed,
            "skipped_empty": self.skipped_empty,
            "skipped_limit": self.skipped_limit,
            "skipped_time": self.skipped_time,
            "reused": self.reused,
            "still_running": self.still_running,
        }


@dataclass
class ProfilingWork:
    """Разделы, которым нужен вызов модели, с ценой каждого. Модель не вызывалась.

    `items`: раздел, запрос, ключ кэша и оценка цены вызова в токенах. Порядок
    тот же, что у `sections_to_profile`: сначала главы.
    """

    items: list[tuple[DocumentSection, ProfilingRequest, str, int]] = field(
        default_factory=list
    )
    requested: int = 0
    from_cache: int = 0
    skipped_empty: int = 0


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
    """Профилирует разделы книги без пределов и возвращает отчёт о прогоне."""
    provider = provider or get_profiling_provider()
    work = plan_section_profiling(
        document,
        processing_version=processing_version,
        include_subsections=include_subsections,
        provider=provider,
    )
    return run_section_profiling(
        document, work, provider=provider, processing_version=processing_version
    )


def plan_section_profiling(
    document,
    *,
    processing_version: str = "",
    include_subsections: bool = True,
    provider=None,
) -> ProfilingWork:
    """Какие разделы ещё надо разобрать и сколько стоит каждый. Без вызовов модели.

    Свежий профиль в кэше и раздел без текста вызова не требуют, поэтому в
    `items` не попадают.
    """
    version = processing_version or document.processing_version
    provider = provider or get_profiling_provider()
    work = ProfilingWork()

    selected = sections_to_profile(document, include_subsections=include_subsections)
    for section in selected:
        work.requested += 1
        chunk_ids = _chunk_ids(section, version)
        content_hash = compute_content_hash(
            section, processing_version=version, chunk_ids=chunk_ids
        )
        if _is_fresh(section, content_hash):
            work.from_cache += 1
            continue

        context = build_context(section, processing_version=version)
        if not context.strip():
            # Раздел без текста профилировать нечем. Это не ошибка: так
            # выглядят титул, пустая рубрика и глава, чей текст не распознался.
            work.skipped_empty += 1
            continue

        request = ProfilingRequest(
            section_id=str(section.pk),
            title=section.title,
            number_label=section.number_label,
            structural_role=section.structural_role,
            level=section.level,
            page_start=section.start_page or 0,
            page_end=section.end_page or 0,
            context=context,
            content_statistics=collect_statistics(section, processing_version=version),
        )
        work.items.append(
            (section, request, content_hash, provider.estimate_tokens(request))
        )
    return work


def run_section_profiling(
    document,
    work: ProfilingWork,
    *,
    items=None,
    stop_at: float | None = None,
    provider=None,
    processing_version: str = "",
    report: ProfilingReport | None = None,
) -> ProfilingReport:
    """Разбирает `items` из плана работы (по умолчанию все) и сохраняет профили.

    Что из плана не вошло в `items`, считается в `skipped_limit`. `stop_at` —
    момент `time.monotonic()`: раздел, до которого очередь дошла позже, не
    стартует и считается в `skipped_time`. Начатые разделы ждём ещё
    `LATE_RESULT_GRACE_SECONDS`, а не дождавшиеся досчитываются без нас и
    сохраняют профиль сами (`still_running`).

    Отчёт можно передать готовым: тогда его счётчики видны вызывающему и
    тогда, когда прогон оборвался ошибкой.
    """
    version = processing_version or document.processing_version
    provider = provider or get_profiling_provider()
    chosen = list(work.items if items is None else items)
    report = report if report is not None else ProfilingReport()
    report.requested = work.requested
    report.from_cache = work.from_cache
    report.skipped_empty = work.skipped_empty
    report.skipped_limit = max(0, len(work.items) - len(chosen))
    if not chosen:
        return report

    # Разделы раздаёт главный поток, по одному на освободившийся поток пула:
    # так срок и свежесть профиля проверяются прямо перед стартом раздела, а к
    # базе ходит только он. Сохраняет профили тоже он.
    pending = deque(chosen)
    running: dict[Future, tuple] = {}
    workers = min(MAX_CONCURRENCY, len(chosen))
    pool = ThreadPoolExecutor(max_workers=workers)
    try:
        while True:
            while pending and len(running) < workers:
                if stop_at is not None and time.monotonic() >= stop_at:
                    report.skipped_time += len(pending)
                    pending.clear()
                    break
                item = pending.popleft()
                section, request, content_hash, _estimate = item
                if _is_fresh(section, content_hash):
                    # Пока раздел ждал очереди, его разобрала другая программа
                    # по этой же книге: второй раз за него не платим.
                    report.reused += 1
                    continue
                # Контекст копируется на каждый раздел и здесь, в родительском
                # потоке: usage-метрики, предоплаченный резерв и tenant живут в
                # ContextVar и в пул сами не переезжают. Один объект контекста
                # нельзя войти из двух потоков сразу, поэтому копия своя у
                # каждого раздела.
                context = contextvars.copy_context()
                running[pool.submit(context.run, _profile_one, provider, request)] = item
            if not running:
                break
            done, _ = wait(
                running, timeout=_wait_seconds(stop_at), return_when=FIRST_COMPLETED
            )
            if not done:
                # Срок ожидания вышел: идущие разделы досчитаются без нас.
                break
            for future in done:
                _collect(
                    running.pop(future),
                    future.result(),
                    document=document,
                    version=version,
                    report=report,
                )
    finally:
        _hand_over(running, document=document, version=version, report=report)
        pool.shutdown(wait=False)
    return report


def _wait_seconds(stop_at: float | None) -> float | None:
    """Сколько ещё ждать начатые разделы. Без срока — сколько понадобится."""
    if stop_at is None:
        return None
    return max(0.0, stop_at + LATE_RESULT_GRACE_SECONDS - time.monotonic())


def _collect(item, result, *, document, version: str, report: ProfilingReport) -> None:
    """Результат раздела, который программа дождалась: сохраняем в этом потоке."""
    section, request, content_hash, _estimate = item
    if result is None:
        report.failed += 1
        report.errors.append(str(section.pk))
        return
    _save(
        section,
        document,
        result,
        content_hash=content_hash,
        processing_version=version,
        statistics=request.content_statistics,
    )
    report.generated += 1


def _hand_over(running: dict, *, document, version: str, report: ProfilingReport) -> None:
    """Разделы, которых программа больше не ждёт.

    Уже досчитанный сохраняется здесь же. Ещё идущий оплачен и потому не
    бросается: его профиль сохранит поток пула, когда раздел досчитается
    (`_save_late`). Сумма оценок таких разделов остаётся им в резерве разбора.
    """
    main = threading.get_ident()
    for future, item in running.items():
        if future.done():
            try:
                _collect(item, future.result(), document=document, version=version, report=report)
            except Exception:  # noqa: BLE001 — не прячем исходную ошибку прогона
                logger.warning(
                    "Профиль раздела %s не сохранён", item[0].pk, exc_info=True
                )
            continue
        report.still_running += 1
        report.still_running_tokens += item[3]
        future.add_done_callback(
            functools.partial(
                _save_late, item=item, document=document, version=version, main=main
            )
        )


def _save_late(future: Future, *, item, document, version: str, main: int) -> None:
    """Раздел досчитался, когда программа его уже не ждала.

    Вызов оплачен, поэтому профиль сохраняется: следующая программа за него не
    заплатит. Пишет его поток пула своей транзакцией и закрывает своё
    соединение, потому что после ухода программы его никто не закроет. Если
    раздел досчитался в ту же секунду, когда программа его отпустила, колбэк
    приходит в главный поток: тогда соединение запроса не трогаем.
    """
    section, request, content_hash, _estimate = item
    in_pool = threading.get_ident() != main
    try:
        result = None if future.cancelled() else future.result()
        if result is not None:
            _save(
                section,
                document,
                result,
                content_hash=content_hash,
                processing_version=version,
                statistics=request.content_statistics,
            )
    except Exception:  # noqa: BLE001 — ответа ученику уже нет, остаётся лог
        logger.warning("Поздний профиль раздела %s не сохранён", section.pk, exc_info=True)
    finally:
        if in_pool:
            connection.close()


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
