"""Проведение документа по пайплайну: PDF → страницы → блоки → чанки.

Здесь впервые соединяются модули, которые до сих пор вызывались только из
тестов: `upload_validation`, `storage`, `extraction`, `blocks`, `ocr` и
`chunking`.

Про исполнение. В production тяжёлый пайплайн запускает Celery-воркер,
а прямой вызов остаётся для management-команды и тестов. От учебника на 1500
страниц оба пути защищают два лимита: `MAX_PAGES_PER_RUN` на извлечение
и `ocr.MAX_OCR_PAGES_PER_RUN` на платный OCR.

Идемпотентность по паре (документ, `processing_version`) — требование
docstring'а `IngestionJob`: контейнер эфемерный, воркер может быть убит в любой
момент. Повторный запуск не создаёт дублей: производные строки документа
удаляются перед перезаписью в одной транзакции.
"""

from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass, field
from uuid import UUID, uuid4

from celery.exceptions import SoftTimeLimitExceeded
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from ai_engine.usage import (
    AIUsageLimitExceeded,
    prepaid_usage,
    release_usage_reservation,
    reservations_block_until,
    reserve_usage_capacity,
    resolve_usage_plan,
    usage_scope,
    usage_window_limit,
)

from .. import extraction
from ..blocks import PageText, SectionNode, classify_pages
from ..chunking import (
    chunk_blocks,
    compute_content_hash,
    normalize_text,
    split_tasks_and_solutions,
)
from ..models import (
    PROCESSING_VERSION,
    Document,
    DocumentBlock,
    DocumentPage,
    DocumentSection,
    ExtractedSolution,
    ExtractedTask,
    IngestionAttempt,
    IngestionJob,
    KnowledgeChunk,
)
from ..observability import log_ingestion_event
from ..outline.builder import build_outline
from ..outline.contracts import Source as OutlineSource
from ..outline.embedded import nodes_from_bookmarks
from ..epub_extraction import EpubExtractionError
from ..model_registry import ROLE_OCR, resolve_model
from ..ocr import (
    MAX_OCR_PAGES_PER_RUN,
    NullOcrProvider,
    OcrProvider,
    get_ocr_provider,
)
from ..parsers import UnsupportedDocumentType, resolve_parser
from ..storage import get_storage_for
from ..tokenizer import get_tokenizer
from ..upload_validation import MAX_PAGES as MAX_UPLOAD_PAGES
from .embedding_index import index_document_chunks

logger = logging.getLogger(__name__)

# Сколько страниц книги обрабатываем за прогон. Совпадает с гейтом загрузки:
# всё, что прошло `upload_validation`, обрабатывается целиком.
#
# Раньше здесь стояло 400 — предохранитель синхронного пути, когда пайплайн
# держал поток веб-сервера. Обработка давно в Celery, а цена оставалась: у
# книги на 682 страницы главы с 482-й не получали ни одного фрагмента. План по
# ним строился (структура приходит из закладок), но текста за ним не было, и
# тьютор по этим главам не находил ничего.
#
# Предохранитель стоимости остался там, где он и должен быть, — на платном OCR
# (`ocr.MAX_OCR_PAGES_PER_RUN`). Извлечение нативного текста считается локально.
MAX_PAGES_PER_RUN = MAX_UPLOAD_PAGES
# Сколько страниц дочитываем с конца книги ради оглавления, когда обработка
# упёрлась в лимит. Оглавление занимает единицы страниц, а стоит дёшево.
TAIL_PAGES_FOR_OUTLINE = 15


# Доля кириллицы, выше которой книга считается русской. Порог намеренно
# низкий: в русском учебнике полно латиницы — формулы, обозначения, ссылки на
# литературу, — а в английском кириллицы не бывает почти никогда.
CYRILLIC_SHARE_FOR_RU = 0.15
# Сколько символов хватает для решения. Первые страницы — это титул и
# оглавление, они на языке книги.
LANGUAGE_SAMPLE_CHARS = 20_000

# Задачу воркера остановил предел часа (`CELERY_TASK_SOFT_TIME_LIMIT`). Тот же
# код вьюха статуса ставит джобу, который убил жёсткий предел.
TIMED_OUT_ERROR_CODE = "timed_out"
TIMED_OUT_MESSAGE = "Обработка заняла больше часа и остановлена."

# В книге нет текста, а резерв на распознавание сканов не взялся (решение 13).
# Файл остаётся в хранилище: книгу обработают заново, когда лимита хватит.
OCR_QUOTA_ERROR_CODE = "ocr_quota"
OCR_QUOTA_MESSAGE = (
    "В книге одни сканы, а лимита на их распознавание не хватило. Файл сохранён."
)

# В книге нет текста, резерв взят, а ни одна страница-скан не распознана:
# модель не ответила или вернула пустое. Не `no_content`: распознавание
# настроено и было оплачено. Сам воркер обработку не повторяет.
OCR_FAILED_ERROR_CODE = "ocr_failed"
OCR_FAILED_MESSAGE = (
    "Сканы не распознались: сервис распознавания не ответил. "
    "Попробуй ещё раз позже."
)

# Запас срока резерва сканов сверх последней возможной страницы: рендер, запись
# расхода и снятие резерва.
OCR_RESERVE_MARGIN_SECONDS = 120


def detect_language(text: str) -> str:
    """Язык книги по доле кириллицы. `ru`, `en` или пусто, если букв нет.

    Дешёвая эвристика вместо библиотеки определения языка: различать нужно ровно
    те два языка, на которых приходят учебники, и делать это на этапе, где
    лишняя зависимость дороже пользы.

    Язык нужен полнотекстовому поиску: до этого он был зашит русским, и
    английский учебник разбирался русской морфологией.
    """
    sample = (text or "")[:LANGUAGE_SAMPLE_CHARS]
    cyrillic = sum(1 for ch in sample if "\u0400" <= ch <= "\u04ff")
    latin = sum(1 for ch in sample if ("a" <= ch <= "z") or ("A" <= ch <= "Z"))
    letters = cyrillic + latin
    if not letters:
        return ""
    return "ru" if cyrillic / letters >= CYRILLIC_SHARE_FOR_RU else "en"


class IngestionError(RuntimeError):
    """Ошибка с машинным кодом для `IngestionJob.error_code`."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class SupersededIngestion(RuntimeError):
    """Запуск заменён более новым поколением Celery-задачи."""


@dataclass
class IngestionOutcome:
    """Итог прогона — то, что показываем пользователю и логируем."""

    job: IngestionJob
    document: Document
    pages: int = 0
    ocr_pages: int = 0
    sections: int = 0
    blocks: int = 0
    tasks: int = 0
    solutions: int = 0
    chunks: int = 0
    warnings: list[str] = None  # type: ignore[assignment]
    # Сводка сканов (`OcrSummary.as_dict()`). Пусто, если обработка до
    # распознавания не дошла.
    ocr_summary: dict[str, int | str] = field(default_factory=dict)
    # False означает, что Celery-запуск не захватил job: его уже
    # заменило другое поколение. Задача не должна ретраить чужую
    # ошибку из просто перечитанного outcome.
    claimed: bool = True

    def __post_init__(self) -> None:
        if self.warnings is None:
            self.warnings = []

    @property
    def succeeded(self) -> bool:
        return self.job.status == Document.Status.READY


@dataclass(frozen=True)
class OcrSummary:
    """Что стало со сканами книги: по ней ученик видит строку у книги.

    - `scanned` — страниц-сканов среди обработанных страниц;
    - `attempted` — сколько ушло в распознавание (не больше `max_ocr_pages`),
      если резерв взят и цикл начался, даже когда он оборвался посреди;
      0, если распознавание не запускалось;
    - `recognized` — сколько вернулись с текстом;
    - `skipped` — `"quota"` (не хватает сейчас) или `"window"` (сумма больше
      окна тарифа), если резерв не взялся, иначе пусто;
    - `reset_at` — когда лимит восстановится, только для `"quota"`;
    - `plan` — тариф ученика, только при отказе;
    - `stopped` — `"time"`, если распознавание остановилось по своему времени
      (`_ocr_time_is_up`), только в этом случае: повтор оборвался бы на той же
      странице и заплатил бы за неё снова.
    """

    scanned: int = 0
    attempted: int = 0
    recognized: int = 0
    skipped: str = ""
    reset_at: str = ""
    plan: str = ""
    stopped: str = ""

    def as_dict(self) -> dict[str, int | str]:
        data: dict[str, int | str] = {
            "scanned": self.scanned,
            "attempted": self.attempted,
            "recognized": self.recognized,
            "skipped": self.skipped,
        }
        if self.skipped == "quota":
            data["reset_at"] = self.reset_at
        if self.skipped:
            data["plan"] = self.plan
        if self.stopped:
            data["stopped"] = self.stopped
        return data


class _Recorder:
    """Пишет каждый переход в `IngestionAttempt` с длительностью."""

    def __init__(self, job: IngestionJob, *, run_token: str = "") -> None:
        self.job = job
        self._run_token = run_token
        self._previous = job.status
        self._started = time.monotonic()

    def _jobs(self):
        jobs = IngestionJob.objects.filter(pk=self.job.pk)
        if self._run_token:
            jobs = jobs.filter(celery_task_id=self._run_token)
        return jobs

    def advance(
        self, to_status: str, *, document_fields: dict | None = None
    ) -> None:
        elapsed_ms = int((time.monotonic() - self._started) * 1000)
        attempt_from = self._previous
        now = timezone.now()
        with transaction.atomic():
            # Везде берём блокировки в одном порядке: document → job.
            # Dispatch делает так же, поэтому retry не создаёт deadlock.
            Document.objects.select_for_update().get(pk=self.job.document_id)
            changed = self._jobs().update(status=to_status, updated_at=now)
            if not changed:
                raise SupersededIngestion
            IngestionAttempt.objects.create(
                job=self.job,
                from_status=self._previous,
                to_status=to_status,
                succeeded=True,
                duration_ms=elapsed_ms,
            )
            Document.objects.filter(pk=self.job.document_id).update(
                ingestion_status=to_status,
                updated_at=now,
                **(document_fields or {}),
            )
        self.job.status = to_status
        self.job.updated_at = now
        self._previous = to_status
        self._started = time.monotonic()
        log_ingestion_event(
            "transition",
            document_id=self.job.document_id,
            job_id=self.job.pk,
            processing_version=self.job.processing_version,
            from_status=attempt_from,
            to_status=to_status,
            duration_ms=elapsed_ms,
            retry_count=self.job.retry_count,
        )

    def fail(self, code: str, message: str) -> None:
        elapsed_ms = int((time.monotonic() - self._started) * 1000)
        message = message[:400]
        now = timezone.now()
        with transaction.atomic():
            Document.objects.select_for_update().get(pk=self.job.document_id)
            # Готовую книгу ничто не переписывает в провал, даже предел часа,
            # пришедший сразу после READY: такой запуск считается уже не своим.
            changed = (
                self._jobs()
                .exclude(status=Document.Status.READY)
                .update(
                    status=Document.Status.FAILED,
                    error_code=code,
                    error_message=message,
                    finished_at=now,
                    updated_at=now,
                )
            )
            if not changed:
                raise SupersededIngestion
            IngestionAttempt.objects.create(
                job=self.job,
                from_status=self._previous,
                to_status=Document.Status.FAILED,
                succeeded=False,
                error_code=code,
                error_message=message,
                duration_ms=elapsed_ms,
            )
            Document.objects.filter(pk=self.job.document_id).update(
                ingestion_status=Document.Status.FAILED,
                updated_at=now,
            )
        self.job.status = Document.Status.FAILED
        self.job.error_code = code
        self.job.error_message = message
        self.job.finished_at = now
        self.job.updated_at = now
        log_ingestion_event(
            "failed",
            document_id=self.job.document_id,
            job_id=self.job.pk,
            processing_version=self.job.processing_version,
            from_status=self._previous,
            to_status=Document.Status.FAILED,
            duration_ms=elapsed_ms,
            retry_count=self.job.retry_count,
            error_code=code,
        )


def ingest_document(
    document: Document,
    *,
    processing_version: str = PROCESSING_VERSION,
    max_pages: int = MAX_PAGES_PER_RUN,
    max_ocr_pages: int = MAX_OCR_PAGES_PER_RUN,
    ocr_provider=None,
    run_token: str = "",
) -> IngestionOutcome:
    """Главная точка входа. Наружу исключения не выпускает.

    Ошибка фиксируется в `IngestionJob.error_code` и в статусе `failed`: view
    обязан ответить пользователю понятным статусом, а не 500.
    """
    job, _ = IngestionJob.objects.get_or_create(
        document=document,
        processing_version=processing_version,
        defaults={
            "user_email": document.user_email,
            "status": Document.Status.UPLOADED,
        },
    )
    outcome = IngestionOutcome(job=job, document=document)
    now = timezone.now()

    if run_token:
        # Celery task id — поколение запуска. После ручного повтора
        # старый воркер может ожить после OCR. Он не имеет права
        # менять статусы или производные строки нового запуска.
        with transaction.atomic():
            Document.objects.select_for_update().get(pk=document.pk)
            started = IngestionJob.objects.filter(
                pk=job.pk,
                celery_task_id=run_token,
                status=Document.Status.QUEUED,
            ).update(
                status=Document.Status.VALIDATING,
                started_at=now,
                finished_at=None,
                updated_at=now,
            )
            if started:
                IngestionAttempt.objects.create(
                    job=job,
                    from_status=Document.Status.QUEUED,
                    to_status=Document.Status.VALIDATING,
                    succeeded=True,
                    duration_ms=0,
                )
                Document.objects.filter(pk=document.pk).update(
                    ingestion_status=Document.Status.VALIDATING,
                    updated_at=now,
                )
        if not started:
            logger.info(
                "Ingestion %s пропущен: Celery-запуск %s уже заменён",
                document.pk,
                run_token,
            )
            return _refresh_outcome(outcome, claimed=False)
        job.status = Document.Status.VALIDATING
        job.started_at = now
        job.finished_at = None
        job.updated_at = now
        log_ingestion_event(
            "claimed",
            document_id=document.pk,
            job_id=job.pk,
            processing_version=processing_version,
            from_status=Document.Status.QUEUED,
            to_status=Document.Status.VALIDATING,
            retry_count=job.retry_count,
        )
    else:
        previous_status = job.status
        if job.status == Document.Status.FAILED:
            # Повторный прямой запуск: retry, а не новый job.
            job.retry_count += 1
            job.error_code = ""
            job.error_message = ""
            job.status = Document.Status.UPLOADED
        job.started_at = now
        job.finished_at = None
        job.save()
        log_ingestion_event(
            "claimed",
            document_id=document.pk,
            job_id=job.pk,
            processing_version=processing_version,
            from_status=previous_status,
            to_status=job.status,
            retry_count=job.retry_count,
        )

    recorder = _Recorder(job, run_token=run_token)

    try:
        _run_pipeline(
            document,
            job,
            recorder,
            outcome,
            processing_version=processing_version,
            max_pages=max_pages,
            max_ocr_pages=max_ocr_pages,
            ocr_provider=ocr_provider or get_ocr_provider(),
            run_token=run_token,
        )
    except SupersededIngestion:
        logger.info(
            "Ingestion %s остановлен: запуск %s уже заменён",
            document.pk,
            run_token,
        )
        return _refresh_outcome(outcome, claimed=False)
    except IngestionError as exc:
        logger.warning(
            "Ingestion документа %s провалилась: %s (%s)",
            document.pk,
            exc.code,
            exc.message,
        )
        try:
            recorder.fail(exc.code, exc.message)
        except SupersededIngestion:
            return _refresh_outcome(outcome, claimed=False)
    except AIUsageLimitExceeded:
        # Worker wrapper owns the fenced terminal quota transition. Turning
        # this into internal_error here would hide a deterministic 429 reason.
        raise
    except SoftTimeLimitExceeded:
        # Предел часа. До жёсткого убийства остаётся минута, и её хватает,
        # чтобы закрыть джоб понятной ошибкой и записать предупреждения.
        logger.warning(
            "Ingestion документа %s остановлена по пределу времени", document.pk
        )
        try:
            recorder.fail(TIMED_OUT_ERROR_CODE, TIMED_OUT_MESSAGE)
        except SupersededIngestion:
            return _refresh_outcome(outcome, claimed=False)
    except Exception as exc:  # noqa: BLE001 — наружу не отдаём ничего сырого
        logger.exception("Непредвиденная ошибка ingestion документа %s", document.pk)
        try:
            recorder.fail("internal_error", str(exc))
        except SupersededIngestion:
            return _refresh_outcome(outcome, claimed=False)

    # Предупреждения и сводка сканов переживают запрос: при асинхронном запуске
    # ответ на POST уходит раньше, чем они появятся, и опрос статуса — единственный
    # способ их показать. Пишутся и при успехе, и при провале. Сводку пишет только
    # своё поколение: ожившее старое не перепишет строку новой обработки.
    # Блокировки в том же порядке, что везде: document → job.
    warnings = list(outcome.warnings)
    now = timezone.now()
    with transaction.atomic():
        Document.objects.select_for_update().get(pk=document.pk)
        jobs = IngestionJob.objects.filter(pk=job.pk)
        if run_token:
            jobs = jobs.filter(celery_task_id=run_token)
        claimed = bool(jobs.update(warnings=warnings, updated_at=now))
        if claimed:
            Document.objects.filter(pk=document.pk).update(
                ocr_summary=outcome.ocr_summary, updated_at=now
            )
    if not claimed:
        return _refresh_outcome(outcome, claimed=False)
    job.warnings = warnings
    job.updated_at = now

    if job.status == Document.Status.READY:
        log_ingestion_event(
            "completed",
            document_id=document.pk,
            job_id=job.pk,
            processing_version=processing_version,
            to_status=Document.Status.READY,
            retry_count=job.retry_count,
            pages=outcome.pages,
            ocr_pages=outcome.ocr_pages,
            sections=outcome.sections,
            blocks=outcome.blocks,
            tasks=outcome.tasks,
            solutions=outcome.solutions,
            chunks=outcome.chunks,
        )

    return _refresh_outcome(outcome)


def _refresh_outcome(
    outcome: IngestionOutcome,
    *,
    claimed: bool | None = None,
) -> IngestionOutcome:
    if claimed is not None:
        outcome.claimed = claimed
    outcome.job.refresh_from_db()
    outcome.document.refresh_from_db()
    return outcome


def _run_pipeline(
    document: Document,
    job: IngestionJob,
    recorder: _Recorder,
    outcome: IngestionOutcome,
    *,
    processing_version: str,
    max_pages: int,
    max_ocr_pages: int,
    ocr_provider,
    run_token: str,
) -> None:
    # 1. validating — файл на месте и читается.
    # Celery-запуск атомарно захватил этот статус ещё до входа
    # сюда: так дубль того же task id не запустит второй пайплайн.
    if not run_token:
        recorder.advance(Document.Status.VALIDATING)
    pdf_bytes = _read_file(document)

    # 2. extracting_native_text — формат определяется по СОДЕРЖИМОМУ.
    recorder.advance(Document.Status.EXTRACTING)
    try:
        parser = resolve_parser(pdf_bytes)
    except UnsupportedDocumentType as exc:
        raise IngestionError(exc.code, exc.message) from exc

    try:
        parsed = parser.parse(
            pdf_bytes, document_id=str(document.pk), limit=max_pages
        )
    except extraction.PdfExtractionError as exc:
        raise IngestionError("pdf_unreadable", str(exc)) from exc
    except EpubExtractionError as exc:
        raise IngestionError("epub_unreadable", str(exc)) from exc

    pages = parsed.pages
    if not parsed.has_structure and not pages:
        raise IngestionError("no_pages", "В PDF не найдено ни одной страницы")

    true_total = len(pages)
    tail_texts: dict[int, str] = {}
    # Закладки читаются здесь, пока байты PDF ещё под рукой: ниже они
    # освобождаются вместе со страницами. Это самый надёжный источник структуры
    # — разметка самого издателя, — и стоит он одного обращения к дереву
    # закладок, без чтения страниц.
    bookmarks: list[tuple[int, str, int]] = []
    bookmark_total = 0
    if parsed.has_pages:
        bookmarks, bookmark_total = extraction.read_bookmarks(pdf_bytes)
        true_total = extraction.real_page_count(pdf_bytes)
        if len(pages) < true_total:
            outcome.warnings.append(
                f"processed_only_{len(pages)}_of_{true_total}_pages"
            )
            # Оглавление часто печатают в конце книги, а обработка обрезана
            # предохранителем на `max_pages`. Дочитываем только хвост и только
            # ради структуры: это десяток страниц текста, а не второй проход.
            tail_texts = {
                page.page_number: page.text
                for page in extraction.extract_page_range(
                    pdf_bytes, true_total - TAIL_PAGES_FOR_OUTLINE + 1, true_total
                )
            }

    # 3. classifying_pages — какие страницы уходят в OCR.
    recorder.advance(Document.Status.CLASSIFYING)
    scanned = [p for p in pages if p.needs_ocr]

    # 4. ocr — только сканы, всё или ничего, под одним резервом (решение 13).
    recorder.advance(Document.Status.OCR)
    if isinstance(ocr_provider, NullOcrProvider) and scanned[:max_ocr_pages]:
        # Один раз на документ, а не на каждую страницу.
        outcome.warnings.append("ocr_not_configured")
    try:
        ocr_texts, ocr_summary = _recognize_scans(
            document,
            job,
            pdf_bytes,
            scanned,
            max_ocr_pages=max_ocr_pages,
            ocr_provider=ocr_provider,
            run_token=run_token,
        )
    finally:
        # После последнего возможного render_page_png исходный файл больше не
        # нужен. Не держим PDF одновременно со страницами, блоками и чанками.
        del pdf_bytes
        del scanned
    # Сразу в итог: сводку запишут и ветки провала ниже (`ocr_quota`, предел
    # часа, внутренняя ошибка), а не только готовая книга.
    outcome.ocr_summary = ocr_summary.as_dict()
    outcome.ocr_pages = len(ocr_texts)

    # Язык книги. Определяется по уже извлечённому тексту, до разбора структуры:
    # от него зависит морфология полнотекстового поиска, а раньше она была зашита
    # русской для любой книги.
    detected_language = detect_language(
        "\n".join(
            ocr_texts.get(page.page_number, (page.native_text, ""))[0]
            for page in pages[:20]
        )
        or "".join(block.text for block in (parsed.blocks or [])[:200])
    )

    # 5. reconstructing_structure — разделы и блоки.
    #
    # Ветка ровно одна: дал ли формат готовую структуру. EPUB даёт — заголовки
    # там размечены автором книги, и угадывать их регулярками значило бы
    # выбросить достоверные данные ради догадки. PDF не даёт, и структуру
    # приходится восстанавливать из текста.
    recorder.advance(Document.Status.RECONSTRUCTING)
    outline = None
    if parsed.has_structure:
        source_blocks, sections = parsed.blocks, parsed.sections
    else:
        page_texts = [
            PageText(
                page_number=p.page_number,
                text=ocr_texts.get(p.page_number, (p.native_text, ""))[0],
            )
            for p in pages
        ]
        source_blocks, sections = classify_pages(
            page_texts, document_id=str(document.pk)
        )
        # Структуру книги берём из её собственного оглавления, если оно есть.
        # Разметка тела остаётся источником БЛОКОВ — она для этого и нужна, —
        # но перестаёт быть источником глав: именно оттуда в программу попадали
        # «1. Вектор o» и «Шарик неподвижен» как разделы верхнего уровня.
        outline_pages = {p.page_number: p.text for p in page_texts}
        outline_pages.update(tail_texts)
        outline = build_outline(
            outline_pages,
            embedded=nodes_from_bookmarks(
                bookmarks, total_pages=bookmark_total or true_total
            ),
        )
        del outline_pages
        if outline.source == OutlineSource.HEURISTIC:
            # Оглавления нет — структура остаётся догадкой по телу, и честнее
            # оставить прежний путь, чем выдать пустую иерархию.
            outline = None
        del page_texts
    del parsed

    # 6. extracting_blocks / chunking — считаем ДО транзакции, чтобы в ней были
    # только записи в БД.
    recorder.advance(Document.Status.EXTRACTING_BLOCKS)
    pairs = split_tasks_and_solutions(source_blocks)

    recorder.advance(Document.Status.CHUNKING)
    # Размеры приходят из конфигурации, а сам `chunking` остаётся чистым и
    # тестируемым без поднятого Django.
    chunks = chunk_blocks(
        list(source_blocks),
        processing_version=processing_version,
        target_tokens=getattr(settings, "CURRICULUM_CHUNK_TARGET_TOKENS", 500),
        max_tokens=getattr(settings, "CURRICULUM_CHUNK_MAX_TOKENS", 650),
        overlap_tokens=getattr(settings, "CURRICULUM_CHUNK_OVERLAP_TOKENS", 75),
    )
    # Откат на приближённый счётчик безопасен, но МЕНЯЕТ границы фрагментов при
    # той же `PROCESSING_VERSION`. Молчать об этом нельзя: расхождение всплывёт
    # позже как «почему у одной книги хеши другие».
    if get_tokenizer().name == "heuristic":
        outcome.warnings.append("tokenizer_fallback_heuristic")

    # 7. indexing — единственная транзакция на всю запись.
    recorder.advance(Document.Status.INDEXING)
    with transaction.atomic():
        # Поколение защищает блокировка документа: её берут все, кто меняет
        # `celery_task_id`, поэтому после смены token старое поколение сюда не
        # проходит. Строку джоба не блокируем, чтобы пульс писал `updated_at` и
        # во время записи.
        Document.objects.select_for_update().get(pk=document.pk)
        if run_token and not IngestionJob.objects.filter(
            pk=job.pk,
            celery_task_id=run_token,
        ).exists():
            raise SupersededIngestion
        _replace_derived_rows(document)
        page_rows = _write_pages(document, pages, ocr_texts, true_total)
        section_rows = (
            _write_outline_sections(document, outline)
            if outline is not None
            else _write_sections(document, sections)
        )
        block_rows = _write_blocks(
            document, source_blocks, page_rows, section_rows, processing_version
        )
        task_rows, solution_count = _write_tasks_and_solutions(
            document, pairs, block_rows, section_rows
        )
        chunk_count, written_chunk_ids = _write_chunks(
            document, chunks, section_rows, task_rows, processing_version
        )

    outcome.pages = len(page_rows)
    outcome.sections = len(section_rows)
    outcome.blocks = len(block_rows)
    outcome.tasks = len(task_rows)
    outcome.solutions = solution_count
    outcome.chunks = chunk_count

    # Производные строки уже в БД. Перед сетевой индексацией освобождаем крупные
    # промежуточные графы, чтобы воркер не держал весь учебник в нескольких
    # представлениях одновременно.
    del pages
    del ocr_texts
    del source_blocks
    del sections
    del pairs
    del chunks
    del page_rows
    del section_rows
    del block_rows
    del task_rows

    # 7b. Векторы фрагментов. Строго ПОСЛЕ закрытия `transaction.atomic()`:
    # это сетевой вызов, и держать им открытую транзакцию — значит блокировать
    # строки на всё время работы внешнего провайдера.
    #
    # На сбоях провайдера `index_document_chunks` не бросает: провал
    # эмбеддингов не превращает разобранную книгу в проваленную загрузку. Он
    # возвращает предупреждения, и они видны в диагностике. Наружу проходят
    # только предел часа и отказ лимита.
    embedding_stop = _EmbeddingStop(job)
    index_outcome = index_document_chunks(
        document,
        heartbeat=lambda: _touch_job(job, run_token=run_token),
        chunk_ids=written_chunk_ids,
        should_stop=embedding_stop,
    )
    if embedding_stop.reason:
        # Куски, не дошедшие до провайдера, остались PENDING: их векторы потом
        # возьмёт починка. Книга при этом остаётся готовой (решение 11).
        logger.warning(
            "Документ %s: векторы остановлены раньше срока (%s), "
            "книга остаётся готовой",
            document.pk,
            embedding_stop.reason,
        )
        if "embedding_stopped_early" not in index_outcome.warnings:
            index_outcome.warnings.append("embedding_stopped_early")
    if index_outcome.failed:
        # Решение 11: книга готова и без части векторов, по словам её куски
        # находятся. Недостающие векторы снова поставит в очередь поиск.
        logger.warning(
            "Документ %s: не записаны векторы %s из %s кусков (%s), "
            "книга остаётся готовой",
            document.pk,
            index_outcome.failed,
            index_outcome.considered,
            ", ".join(index_outcome.warnings),
        )
    del written_chunk_ids
    for warning in index_outcome.warnings:
        if warning not in outcome.warnings:
            outcome.warnings.append(warning)

    # 8. quality_check — пустая книга не «готова».
    recorder.advance(Document.Status.QUALITY_CHECK)
    if chunk_count == 0 and ocr_summary.skipped in ("quota", "window"):
        # Текста нет, потому что сканы не распознаны из-за лимита. Причина своя,
        # а не «пустой документ»: книгу обработают заново, когда лимита хватит.
        raise IngestionError(OCR_QUOTA_ERROR_CODE, OCR_QUOTA_MESSAGE)
    if chunk_count == 0 and ocr_summary.attempted and not ocr_summary.recognized:
        # Резерв взят, страницы ушли в распознавание, и ни одна не вернулась с
        # текстом. Распознавание настроено, так что это не `no_content`.
        raise IngestionError(OCR_FAILED_ERROR_CODE, OCR_FAILED_MESSAGE)
    if chunk_count == 0:
        raise IngestionError(
            "no_content",
            "Из документа не удалось извлечь ни одного фрагмента: "
            "возможно, это скан, а OCR не настроен",
        )

    # Сводка сканов пишется в той же транзакции, что и READY: иначе книгу уже
    # видно готовой, а сводка ещё от прошлого прогона.
    recorder.advance(
        Document.Status.READY,
        document_fields={"ocr_summary": ocr_summary.as_dict()},
    )
    finished_at = timezone.now()
    with transaction.atomic():
        Document.objects.select_for_update().get(pk=document.pk)
        jobs = IngestionJob.objects.filter(pk=job.pk)
        if run_token:
            jobs = jobs.filter(celery_task_id=run_token)
        if not jobs.update(finished_at=finished_at, updated_at=finished_at):
            raise SupersededIngestion
        updates = {
            "page_count": true_total,
            "processing_version": processing_version,
            "updated_at": finished_at,
        }
        if detected_language:
            # Пустой результат означает «букв не нашлось» — прежнее значение
            # тогда честнее выдуманного.
            updates["language"] = detected_language
        Document.objects.filter(pk=document.pk).update(**updates)
    job.finished_at = finished_at
    job.updated_at = finished_at


def _recognize_scans(
    document: Document,
    job: IngestionJob,
    pdf_bytes: bytes,
    scanned: list[extraction.ExtractedPage],
    *,
    max_ocr_pages: int,
    ocr_provider: OcrProvider,
    run_token: str,
) -> tuple[dict[int, tuple[str, str]], OcrSummary]:
    """Распознаёт сканы всё или ничего, под одним резервом на всю обработку.

    Решение 13. До первой платной страницы резервируется цена всех сканов этой
    обработки (не больше `max_ocr_pages`). Не хватает — не распознаётся ни одна:
    продолжения нет, а повторная обработка распознала бы всё заново и снова
    списала бы лимит. Страницы расходуют этот резерв (`prepaid_usage`) и сверх
    него не резервируют, поэтому параллельный чат его не съест.

    Обрыв посреди (отказ лимита на странице или конец времени на распознавание)
    оставляет распознанное. Сбой страницы провайдер возвращает неуспехом, а не
    исключением. Всё остальное, предел часа тоже, уходит наверх, а резерв
    снимается в `finally`.
    """
    to_ocr = scanned[:max_ocr_pages]
    if not to_ocr or isinstance(ocr_provider, NullOcrProvider):
        # Платить не за что: страницы не рендерятся и ничего не резервируется.
        return {}, OcrSummary(scanned=len(scanned))

    email = document.user_email
    need = len(to_ocr) * ocr_provider.page_token_bound()
    try:
        reservation = reserve_usage_capacity(
            email,
            reserved_tokens=need,
            feature="curriculum_ocr",
            ttl_seconds=_ocr_reserve_ttl_seconds(),
        )
    except AIUsageLimitExceeded as denied:
        window_limit = usage_window_limit(email)
        # Больше окна тарифа сумма не поместится никогда, и время восстановления
        # тут ни при чём.
        beyond_window = window_limit is not None and need > window_limit
        skipped = "window" if beyond_window else "quota"
        reset_at = ""
        if skipped == "quota":
            # Если расход оставляет место, а мешают только живые брони (вызов
            # чата, остаток резерва упавшего воркера), лимит освободится вместе
            # с ними, а не со сбросом окна через несколько часов.
            blocked_until = reservations_block_until(email, need)
            reset_at = (
                blocked_until.isoformat().replace("+00:00", "Z")
                if blocked_until is not None
                else denied.reset_at
            )
        logger.info(
            "Сканы документа %s не распознаются: на %s страниц нужно %s токенов (%s)",
            document.pk,
            len(to_ocr),
            need,
            skipped,
        )
        return {}, OcrSummary(
            scanned=len(scanned),
            skipped=skipped,
            reset_at=reset_at,
            plan=resolve_usage_plan(email)["id"],
        )

    ocr_texts: dict[int, tuple[str, str]] = {}
    stopped = ""
    try:
        # Почта явно: прямой вызов `ingest_document` (тесты, команда) идёт без
        # контекста воркера, и расход страниц иначе никому бы не записался.
        with usage_scope(user_email=email), prepaid_usage(reservation):
            started = time.monotonic()
            for page in to_ocr:
                if _ocr_time_is_up(started):
                    logger.warning(
                        "Распознавание документа %s остановлено по времени: "
                        "распознано %s из %s страниц-сканов",
                        document.pk,
                        len(ocr_texts),
                        len(to_ocr),
                    )
                    stopped = "time"
                    break
                png = extraction.render_page_png(pdf_bytes, page.page_number)
                try:
                    result = ocr_provider.transcribe_page(png)
                except AIUsageLimitExceeded:
                    logger.info(
                        "Распознавание документа %s остановлено отказом лимита: "
                        "распознано %s из %s страниц-сканов",
                        document.pk,
                        len(ocr_texts),
                        len(to_ocr),
                    )
                    break
                finally:
                    # Растр страницы может быть мегабайтным; между OCR-вызовами
                    # держать предыдущую страницу незачем.
                    del png
                if result.succeeded and not result.is_empty:
                    ocr_texts[page.page_number] = (result.text, result.model)
                _touch_job(job, run_token=run_token)
                del result
    finally:
        release_usage_reservation(reservation)

    return ocr_texts, OcrSummary(
        scanned=len(scanned),
        attempted=len(to_ocr),
        recognized=len(ocr_texts),
        stopped=stopped,
    )


def _ocr_deadline_seconds() -> float:
    """Сколько секунд от начала распознавания ещё начинаются новые страницы."""
    return settings.CELERY_TASK_SOFT_TIME_LIMIT / 2


def _ocr_time_is_up(started: float) -> bool:
    """Новую страницу не начинаем после половины мягкого предела задачи.

    Вторая половина часа нужна структуре, записи и векторам. Если час кончится
    посреди распознавания, джоб закроется по пределу и оплаченные страницы
    пропадут.
    """
    return time.monotonic() - started >= _ocr_deadline_seconds()


def _ocr_reserve_ttl_seconds() -> int:
    """Срок резерва всех сканов: он переживает последнюю возможную страницу.

    Новых страниц нет после дедлайна `_ocr_time_is_up`, а последняя идёт не
    дольше таймаута страницы: `OCR_TIMEOUT` роли, с которым `get_ocr_provider`
    создаёт провайдера. Если воркер умер и `finally` резерв не снял, лимит
    ученика освобождается вскоре после этого, а не через общий срок резерва
    (`AI_USAGE_RESERVATION_TTL_SECONDS`, 65 минут).
    """
    page_timeout = resolve_model(ROLE_OCR).timeout_seconds
    return math.ceil(
        _ocr_deadline_seconds() + page_timeout + OCR_RESERVE_MARGIN_SECONDS
    )


def _read_file(document: Document) -> bytes:
    file_row = getattr(document, "file", None)
    if file_row is None:
        raise IngestionError("no_file", "У документа нет привязанного файла")
    try:
        # storage.open() отдаёт bytes, а не файловый объект.
        return get_storage_for(file_row.storage_backend).open(file_row.storage_key)
    except SoftTimeLimitExceeded:
        raise
    except Exception as exc:  # noqa: BLE001
        raise IngestionError("storage_unavailable", str(exc)) from exc


# Худшая пачка векторов при загрузке: 180 с × 3 попытки и паузы между ними
# (543 с), округлено вверх. Новую пачку после этой границы не начинаем.
EMBEDDING_DEADLINE_MARGIN_SECONDS = 600
# Столько упавших пачек подряд считается болезнью провайдера.
EMBEDDING_MAX_FAILED_BATCHES_IN_A_ROW = 2


class _EmbeddingStop:
    """`should_stop` векторов при загрузке: когда бросить платные пачки.

    Спрашивается перед каждой пачкой, причина остаётся в `reason`:

    * `batches_failed` — две пачки подряд упали. Провайдер болеет, остаток
      заберёт починка.
    * `deadline` — с начала запуска прошло столько, что худшая пачка не
      уложилась бы в мягкий предел часа. Иначе предел оборвал бы книгу,
      у которой уже записаны куски и оплачены сканы, и она стала бы
      `timed_out`.

    Время берётся из `timezone.now()`: `started_at` лежит в базе, а
    `monotonic` у другого процесса не сравнить.
    """

    def __init__(self, job: IngestionJob) -> None:
        self.reason = ""
        self._started_at = job.started_at
        self._seen: tuple[int, int, int] | None = None
        self._failed_in_a_row = 0

    def __call__(self, outcome) -> bool:
        snapshot = (outcome.failed, outcome.embedded, outcome.reused)
        if self._seen is not None:
            failed, embedded, reused = self._seen
            if (
                outcome.failed > failed
                and outcome.embedded == embedded
                and outcome.reused == reused
            ):
                self._failed_in_a_row += 1
            else:
                self._failed_in_a_row = 0
        self._seen = snapshot
        if self._failed_in_a_row >= EMBEDDING_MAX_FAILED_BATCHES_IN_A_ROW:
            self.reason = "batches_failed"
            return True
        if self._started_at is not None:
            limit = (
                settings.CELERY_TASK_SOFT_TIME_LIMIT
                - EMBEDDING_DEADLINE_MARGIN_SECONDS
            )
            if (timezone.now() - self._started_at).total_seconds() >= limit:
                self.reason = "deadline"
                return True
        return False


def _touch_job(job: IngestionJob, *, run_token: str = "") -> None:
    """Heartbeat долгой OCR/embedding-фазы для корректного stale-таймаута."""

    now = timezone.now()
    jobs = IngestionJob.objects.filter(pk=job.pk)
    if run_token:
        jobs = jobs.filter(celery_task_id=run_token)
    if not jobs.update(updated_at=now):
        raise SupersededIngestion
    job.updated_at = now


def _replace_derived_rows(document: Document) -> None:
    """Убирает производные строки прошлого прогона.

    Порядок важен: чанки и решения ссылаются на задачи и блоки, поэтому
    удаляются первыми. Это и есть механизм идемпотентности — повторный прогон
    той же версии не плодит дубли.
    """
    KnowledgeChunk.objects.filter(document_id=document.pk).delete()
    ExtractedSolution.objects.filter(document=document).delete()
    ExtractedTask.objects.filter(document=document).delete()
    DocumentBlock.objects.filter(document=document).delete()
    DocumentSection.objects.filter(document=document).delete()
    DocumentPage.objects.filter(document=document).delete()


def _write_pages(
    document: Document,
    pages: list[extraction.ExtractedPage],
    ocr_texts: dict[int, tuple[str, str]],
    true_total: int,
) -> dict[int, DocumentPage]:
    rows = []
    for page in pages:
        ocr = ocr_texts.get(page.page_number)
        rows.append(
            DocumentPage(
                document=document,
                page_number=page.page_number,
                width=page.width,
                height=page.height,
                native_text_length=page.native_text_length,
                needs_ocr=page.needs_ocr,
                ocr_applied=ocr is not None,
                ocr_model=(ocr[1] if ocr else ""),
                extraction_method=(
                    extraction.EXTRACTION_OCR if ocr else page.extraction_method
                ),
            )
        )
    DocumentPage.objects.bulk_create(rows)
    return {row.page_number: row for row in rows}


class SectionIndex:
    """Поиск раздела для блока: сначала по странице, потом по пути.

    По странице — потому что источник структуры и источник блоков теперь
    разные. Разделы приходят из оглавления книги, а блоки размечаются по телу,
    и общего идентификатора у них нет. Зато есть страница, и она надёжна: блок
    со страницы 34 лежит в том разделе, чей диапазон её накрывает.

    По пути — для EPUB и старого пути, где структуру и блоки строит один и тот
    же проход и `section_path` осмыслен. Раньше поиск был только по пути, и это
    молча ломалось: пути не уникальны, словарь схлопывал разные разделы в один,
    и 87% блоков книги привязывались к чужой секции.
    """

    def __init__(self, rows: list[DocumentSection]) -> None:
        self.rows = rows
        self._by_path: dict[str, DocumentSection] = {}
        for row in rows:
            # Побеждает первый: при коллизии путей поздний раздел не должен
            # забирать себе блоки раннего.
            self._by_path.setdefault(row.path, row)
        # Сортировка по началу и по убыванию уровня: у вложенных диапазонов
        # выигрывает самый глубокий, то есть параграф, а не часть.
        self._by_page = sorted(
            (r for r in rows if r.start_page),
            key=lambda r: (r.start_page, -r.level),
        )

    def __len__(self) -> int:
        return len(self.rows)

    def get(self, path: str) -> DocumentSection | None:
        return self._by_path.get(path)

    def for_page(self, page: int | None) -> DocumentSection | None:
        if not page:
            return None
        found = None
        for row in self._by_page:
            if row.start_page > page:
                break
            if row.end_page >= page:
                found = row
        return found

    def resolve(self, page: int | None, path: str = "") -> DocumentSection | None:
        return self.for_page(page) or (self.get(path) if path else None)


def _write_sections(
    document: Document, sections: list[SectionNode]
) -> SectionIndex:
    rows: dict[str, DocumentSection] = {}
    created: list[DocumentSection] = []
    # Сначала создаём все узлы, потом связываем parent: родитель может встретиться
    # в списке позже ребёнка, если у книги «рваная» нумерация.
    for node in sections:
        row = DocumentSection.objects.create(
            document=document,
            kind=node.kind,
            title=node.title[:400],
            path=node.path,
            order_index=node.order_index,
            start_page=node.start_page,
            end_page=node.end_page,
            level=_LEVEL_BY_KIND.get(node.kind, node.path.count(".") + 2),
        )
        rows.setdefault(node.path, row)
        created.append(row)
    for node, row in zip(sections, created):
        parent = rows.get(node.parent_path) if node.parent_path else None
        if parent is not None and parent.pk != row.pk:
            row.parent = parent
            row.save(update_fields=["parent"])
    return SectionIndex(created)


def _write_outline_sections(document: Document, outline) -> SectionIndex:
    """Записывает структуру, построенную по оглавлению книги.

    Родитель берётся по позиции в списке, а не по строке пути: путь остаётся
    только для показа и цитат, а иерархию держат `parent` и `level`.
    """
    created: list[DocumentSection] = []
    for index, node in enumerate(outline.nodes):
        created.append(
            DocumentSection.objects.create(
                document=document,
                kind=_KIND_BY_LEVEL.get(node.level, DocumentSection.Kind.SUBSECTION),
                title=node.title[:400],
                path=node.number_label[:120] or str(index + 1),
                order_index=index,
                start_page=node.start_page,
                end_page=node.end_page,
                level=node.level,
                number_label=node.number_label[:32],
                structural_role=node.role,
                printed_page=node.printed_page,
                source=node.source,
                confidence=node.confidence,
                verified=node.verified,
                is_teachable=node.is_teachable,
            )
        )

    for index, node in enumerate(outline.nodes):
        if node.parent_index is None:
            continue
        parent = created[node.parent_index]
        row = created[index]
        if parent.pk != row.pk:
            row.parent = parent
            row.save(update_fields=["parent"])

    return SectionIndex(created)


# Уровень книги ↔ `DocumentSection.Kind`. Уровень 1 — часть, 2 — глава, 3 —
# раздел; отдельного вида «часть» у модели нет, и часть показывается главой.
_KIND_BY_LEVEL = {
    1: DocumentSection.Kind.CHAPTER,
    2: DocumentSection.Kind.CHAPTER,
    3: DocumentSection.Kind.SECTION,
}

# Обратное отображение для форматов, которые сами дают вид узла (EPUB размечает
# заголовки автором книги). Раньше уровень выводился из числа точек в пути, и
# глава оказывалась на уровне 1 — там, где `planning.structure` ждёт ЧАСТЬ.
# Из-за этого модулями плана становились разделы глав, а сами главы не попадали
# в план вовсе.
_LEVEL_BY_KIND = {
    DocumentSection.Kind.CHAPTER: 2,
    DocumentSection.Kind.SECTION: 3,
    DocumentSection.Kind.SUBSECTION: 4,
}


def _write_blocks(
    document: Document,
    source_blocks,
    page_rows: dict[int, DocumentPage],
    section_rows: SectionIndex,
    processing_version: str,
) -> dict[str, DocumentBlock]:
    # Пары собираются вместе с строками, а не зипуются потом: блок со страницей
    # за лимитом `max_pages` пропускается, и `zip` по исходному списку сдвинул бы
    # соответствие block_id → строка на всё последующее.
    pairs: list[tuple[str, DocumentBlock]] = []
    for block in source_blocks:
        page_row = page_rows.get(block.page)
        # `page == 0` — это «страницы нет», а не «страница потерялась». Так
        # приходят форматы без страниц (EPUB), и такой блок обязан записаться:
        # иначе фрагменты сошлются в `block_ids` на несуществующие строки.
        # Ненулевая страница без строки — другое дело: она за лимитом
        # `max_pages`, и блок пропускается намеренно.
        if page_row is None and block.page != 0:
            continue
        normalized = normalize_text(block.text)
        pairs.append(
            (
                block.block_id,
                DocumentBlock(
                    document=document,
                    page=page_row,
                    section=section_rows.resolve(block.page, block.section_path),
                    kind=block.kind,
                    reading_order=block.reading_order,
                    normalized_text=normalized,
                    extraction_method=(
                        page_row.extraction_method if page_row else "structured"
                    ),
                    content_hash=compute_content_hash(
                        chunk_type=block.kind,
                        normalized_text=normalized,
                        processing_version=processing_version,
                    ),
                ),
            )
        )
    DocumentBlock.objects.bulk_create([row for _, row in pairs])
    # Ключ — block_id классификатора: он стабилен между прогонами, а pk — нет.
    return dict(pairs)


def _write_tasks_and_solutions(
    document: Document,
    pairs,
    block_rows: dict[str, DocumentBlock],
    section_rows: SectionIndex,
) -> tuple[dict[str, ExtractedTask], int]:
    tasks: dict[str, ExtractedTask] = {}
    solutions = 0
    for pair in pairs:
        block_row = block_rows.get(pair.task_block_id)
        task = ExtractedTask.objects.create(
            document=document,
            section=(block_row.section if block_row else None),
            block=block_row,
            number_label=pair.number_label[:32],
            statement=pair.task_text,
            page_start=pair.task_page,
            page_end=pair.task_page,
            content_hash=compute_content_hash(
                chunk_type="task",
                normalized_text=pair.task_text,
                processing_version=document.processing_version,
            ),
        )
        tasks[pair.task_block_id] = task
        if pair.solution_block_id and pair.solution_text:
            ExtractedSolution.objects.create(
                task=task,
                document=document,
                body=pair.solution_text,
                page_start=pair.solution_page,
                page_end=pair.solution_page,
                content_hash=compute_content_hash(
                    chunk_type="solution",
                    normalized_text=pair.solution_text,
                    processing_version=document.processing_version,
                ),
            )
            solutions += 1
    return tasks, solutions


def _row_pk(row):
    """Первичный ключ строки или `None`.

    Нужен там, где раньше присваивался объект: у кусков нет внешних ключей на
    раздел и задачу, хранится только UUID.
    """
    return row.pk if row is not None else None


def _write_chunks(
    document: Document,
    chunks,
    section_rows: SectionIndex,
    task_rows: dict[str, ExtractedTask],
    processing_version: str,
) -> tuple[int, tuple[UUID, ...]]:
    chunks = list(chunks)
    # Идентификаторы заранее: ссылки parent/previous/next ставятся по индексам
    # до вставки. Внешние ключи отложенные, запись идёт в одной транзакции.
    ids = [uuid4() for _ in chunks]

    def _linked(index: int | None):
        return ids[index] if index is not None else None

    created: list[KnowledgeChunk] = []
    for chunk_id, chunk in zip(ids, chunks, strict=True):
        # У чанка-решения `task_block_id` указывает на блок задачи. У самого
        # чанка-задачи его нет — там задача это он сам, поэтому FK ищется по
        # собственному block_id. Связь нужна обеим сторонам: по ней политика
        # отсекает решение, зная task_id (см. KnowledgeChunk.task).
        task_row = task_rows.get(chunk.task_block_id or "")
        if task_row is None and chunk.chunk_type == "task" and chunk.block_ids:
            task_row = task_rows.get(chunk.block_ids[0])
        created.append(
            KnowledgeChunk(
                id=chunk_id,
                document_id=document.pk,
                section_id=_row_pk(
                    section_rows.resolve(chunk.page_start, chunk.section_path)
                ),
                chunk_type=chunk.chunk_type,
                section_path=chunk.section_path,
                page_start=chunk.page_start,
                page_end=chunk.page_end,
                block_ids=list(chunk.block_ids),
                normalized_text=chunk.normalized_text,
                token_count=chunk.token_count,
                content_hash=chunk.content_hash,
                processing_version=processing_version,
                access_scope=(
                    KnowledgeChunk.AccessScope.SHARED
                    if document.visibility == Document.Visibility.SHARED
                    else KnowledgeChunk.AccessScope.OWNER
                ),
                solution_visibility=chunk.solution_visibility,
                task_id=_row_pk(task_row),
                parent_id=_linked(chunk.parent_index),
                previous_id=_linked(chunk.previous_index),
                next_id=_linked(chunk.next_index),
            )
        )
    KnowledgeChunk.objects.bulk_create(created, batch_size=500)
    return len(created), tuple(row.pk for row in created)
