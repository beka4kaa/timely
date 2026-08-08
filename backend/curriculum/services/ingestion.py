"""Проведение документа по пайплайну: PDF → страницы → блоки → чанки.

Здесь впервые соединяются модули, которые до сих пор вызывались только из
тестов: `upload_validation`, `storage`, `extraction`, `blocks`, `ocr` и
`chunking`.

Про синхронность. Очереди задач в проекте нет (ни Celery, ни RQ), хотя
`IngestionJob`/`IngestionAttempt` её явно предполагают. Поэтому обработка
идёт в вызывающем потоке, а от учебника на 1500 страниц защищают два лимита:
`MAX_PAGES_PER_RUN` на извлечение и `ocr.MAX_OCR_PAGES_PER_RUN` на платный OCR.
Полную книгу гоняем management-командой, а не запросом веб-сервера.

Идемпотентность по паре (документ, `processing_version`) — требование
docstring'а `IngestionJob`: контейнер эфемерный, воркер может быть убит в любой
момент. Повторный запуск не создаёт дублей: производные строки документа
удаляются перед перезаписью в одной транзакции.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

from django.db import transaction
from django.utils import timezone

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
from ..ocr import MAX_OCR_PAGES_PER_RUN, get_ocr_provider
from ..storage import get_storage

logger = logging.getLogger(__name__)

# Предохранитель синхронного пути. `upload_validation.MAX_PAGES` разрешает 1500.
MAX_PAGES_PER_RUN = 400


class IngestionError(RuntimeError):
    """Ошибка с машинным кодом для `IngestionJob.error_code`."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


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

    def __post_init__(self) -> None:
        if self.warnings is None:
            self.warnings = []

    @property
    def succeeded(self) -> bool:
        return self.job.status == Document.Status.READY


class _Recorder:
    """Пишет каждый переход в `IngestionAttempt` с длительностью."""

    def __init__(self, job: IngestionJob) -> None:
        self.job = job
        self._previous = job.status
        self._started = time.monotonic()

    def advance(self, to_status: str) -> None:
        elapsed_ms = int((time.monotonic() - self._started) * 1000)
        IngestionAttempt.objects.create(
            job=self.job,
            from_status=self._previous,
            to_status=to_status,
            succeeded=True,
            duration_ms=elapsed_ms,
        )
        self.job.status = to_status
        self.job.save(update_fields=["status", "updated_at"])
        Document.objects.filter(pk=self.job.document_id).update(
            ingestion_status=to_status
        )
        self._previous = to_status
        self._started = time.monotonic()

    def fail(self, code: str, message: str) -> None:
        elapsed_ms = int((time.monotonic() - self._started) * 1000)
        IngestionAttempt.objects.create(
            job=self.job,
            from_status=self._previous,
            to_status=Document.Status.FAILED,
            succeeded=False,
            error_code=code,
            error_message=message[:400],
            duration_ms=elapsed_ms,
        )
        self.job.status = Document.Status.FAILED
        self.job.error_code = code
        self.job.error_message = message[:400]
        self.job.finished_at = timezone.now()
        self.job.save(
            update_fields=[
                "status",
                "error_code",
                "error_message",
                "finished_at",
                "updated_at",
            ]
        )
        Document.objects.filter(pk=self.job.document_id).update(
            ingestion_status=Document.Status.FAILED
        )


def ingest_document(
    document: Document,
    *,
    processing_version: str = PROCESSING_VERSION,
    max_pages: int = MAX_PAGES_PER_RUN,
    max_ocr_pages: int = MAX_OCR_PAGES_PER_RUN,
    ocr_provider=None,
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
    if job.status == Document.Status.FAILED:
        # Повторный запуск после ошибки: считаем это retry, а не новым джобом.
        job.retry_count += 1
        job.error_code = ""
        job.error_message = ""
        job.status = Document.Status.UPLOADED
    job.started_at = timezone.now()
    job.finished_at = None
    job.save()

    recorder = _Recorder(job)
    outcome = IngestionOutcome(job=job, document=document)

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
        )
    except IngestionError as exc:
        logger.warning(
            "Ingestion документа %s провалилась: %s (%s)",
            document.pk,
            exc.code,
            exc.message,
        )
        recorder.fail(exc.code, exc.message)
    except Exception as exc:  # noqa: BLE001 — наружу не отдаём ничего сырого
        logger.exception("Непредвиденная ошибка ingestion документа %s", document.pk)
        recorder.fail("internal_error", str(exc))

    document.refresh_from_db()
    outcome.document = document
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
) -> None:
    # 1. validating — файл на месте и читается.
    recorder.advance(Document.Status.VALIDATING)
    pdf_bytes = _read_file(document)

    # 2. extracting_native_text
    recorder.advance(Document.Status.EXTRACTING)
    try:
        pages = extraction.extract_pages(pdf_bytes, max_pages=max_pages)
    except extraction.PdfExtractionError as exc:
        raise IngestionError("pdf_unreadable", str(exc)) from exc
    if not pages:
        raise IngestionError("no_pages", "В PDF не найдено ни одной страницы")

    true_total = extraction.real_page_count(pdf_bytes)
    if len(pages) < true_total:
        outcome.warnings.append(
            f"processed_only_{len(pages)}_of_{true_total}_pages"
        )

    # 3. classifying_pages — какие страницы уходят в OCR.
    recorder.advance(Document.Status.CLASSIFYING)
    scanned = [p for p in pages if p.needs_ocr]

    # 4. ocr — только для сканов и только под лимитом стоимости.
    recorder.advance(Document.Status.OCR)
    ocr_texts: dict[int, tuple[str, str]] = {}
    if scanned:
        if len(scanned) > max_ocr_pages:
            outcome.warnings.append(
                f"ocr_limited_to_{max_ocr_pages}_of_{len(scanned)}_pages"
            )
        for page in scanned[:max_ocr_pages]:
            png = extraction.render_page_png(pdf_bytes, page.page_number)
            result = ocr_provider.transcribe_page(png)
            if result.succeeded and not result.is_empty:
                ocr_texts[page.page_number] = (result.text, result.model)
            elif result.error == "ocr_not_configured":
                # Один раз на документ, а не на каждую страницу.
                if "ocr_not_configured" not in outcome.warnings:
                    outcome.warnings.append("ocr_not_configured")
    outcome.ocr_pages = len(ocr_texts)

    # 5. reconstructing_structure — разделы и блоки из текста страниц.
    recorder.advance(Document.Status.RECONSTRUCTING)
    page_texts = [
        PageText(
            page_number=p.page_number,
            text=ocr_texts.get(p.page_number, (p.native_text, ""))[0],
        )
        for p in pages
    ]
    source_blocks, sections = classify_pages(page_texts, document_id=str(document.pk))

    # 6. extracting_blocks / chunking — считаем ДО транзакции, чтобы в ней были
    # только записи в БД.
    recorder.advance(Document.Status.EXTRACTING_BLOCKS)
    pairs = split_tasks_and_solutions(source_blocks)

    recorder.advance(Document.Status.CHUNKING)
    chunks = chunk_blocks(list(source_blocks), processing_version=processing_version)

    # 7. indexing — единственная транзакция на всю запись.
    recorder.advance(Document.Status.INDEXING)
    with transaction.atomic():
        _replace_derived_rows(document)
        page_rows = _write_pages(document, pages, ocr_texts, true_total)
        section_rows = _write_sections(document, sections)
        block_rows = _write_blocks(
            document, source_blocks, page_rows, section_rows, processing_version
        )
        task_rows, solution_count = _write_tasks_and_solutions(
            document, pairs, block_rows, section_rows
        )
        chunk_count = _write_chunks(
            document, chunks, section_rows, task_rows, processing_version
        )

    outcome.pages = len(page_rows)
    outcome.sections = len(section_rows)
    outcome.blocks = len(block_rows)
    outcome.tasks = len(task_rows)
    outcome.solutions = solution_count
    outcome.chunks = chunk_count

    # 8. quality_check — пустая книга не «готова».
    recorder.advance(Document.Status.QUALITY_CHECK)
    if chunk_count == 0:
        raise IngestionError(
            "no_content",
            "Из документа не удалось извлечь ни одного фрагмента: "
            "возможно, это скан, а OCR не настроен",
        )

    recorder.advance(Document.Status.READY)
    job.finished_at = timezone.now()
    job.save(update_fields=["finished_at", "updated_at"])
    Document.objects.filter(pk=document.pk).update(
        page_count=true_total, processing_version=processing_version
    )


def _read_file(document: Document) -> bytes:
    file_row = getattr(document, "file", None)
    if file_row is None:
        raise IngestionError("no_file", "У документа нет привязанного файла")
    try:
        # storage.open() отдаёт bytes, а не файловый объект.
        return get_storage().open(file_row.storage_key)
    except Exception as exc:  # noqa: BLE001
        raise IngestionError("storage_unavailable", str(exc)) from exc


def _replace_derived_rows(document: Document) -> None:
    """Убирает производные строки прошлого прогона.

    Порядок важен: чанки и решения ссылаются на задачи и блоки, поэтому
    удаляются первыми. Это и есть механизм идемпотентности — повторный прогон
    той же версии не плодит дубли.
    """
    KnowledgeChunk.objects.filter(document=document).delete()
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


def _write_sections(
    document: Document, sections: list[SectionNode]
) -> dict[str, DocumentSection]:
    rows: dict[str, DocumentSection] = {}
    # Сначала создаём все узлы, потом связываем parent: родитель может встретиться
    # в списке позже ребёнка, если у книги «рваная» нумерация.
    for node in sections:
        rows[node.path] = DocumentSection.objects.create(
            document=document,
            kind=node.kind,
            title=node.title[:400],
            path=node.path,
            order_index=node.order_index,
            start_page=node.start_page,
            end_page=node.end_page,
        )
    for node in sections:
        if node.parent_path and node.parent_path in rows:
            row = rows[node.path]
            row.parent = rows[node.parent_path]
            row.save(update_fields=["parent"])
    return rows


def _write_blocks(
    document: Document,
    source_blocks,
    page_rows: dict[int, DocumentPage],
    section_rows: dict[str, DocumentSection],
    processing_version: str,
) -> dict[str, DocumentBlock]:
    # Пары собираются вместе с строками, а не зипуются потом: блок со страницей
    # за лимитом `max_pages` пропускается, и `zip` по исходному списку сдвинул бы
    # соответствие block_id → строка на всё последующее.
    pairs: list[tuple[str, DocumentBlock]] = []
    for block in source_blocks:
        page_row = page_rows.get(block.page)
        if page_row is None:
            continue
        normalized = normalize_text(block.text)
        pairs.append(
            (
                block.block_id,
                DocumentBlock(
                    document=document,
                    page=page_row,
                    section=section_rows.get(block.section_path),
                    kind=block.kind,
                    reading_order=block.reading_order,
                    raw_text=block.text,
                    normalized_text=normalized,
                    extraction_method=page_row.extraction_method,
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
    section_rows: dict[str, DocumentSection],
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


def _write_chunks(
    document: Document,
    chunks,
    section_rows: dict[str, DocumentSection],
    task_rows: dict[str, ExtractedTask],
    processing_version: str,
) -> int:
    created: list[KnowledgeChunk] = []
    for chunk in chunks:
        # У чанка-решения `task_block_id` указывает на блок задачи. У самого
        # чанка-задачи его нет — там задача это он сам, поэтому FK ищется по
        # собственному block_id. Связь нужна обеим сторонам: по ней политика
        # отсекает решение, зная task_id (см. KnowledgeChunk.task).
        task_row = task_rows.get(chunk.task_block_id or "")
        if task_row is None and chunk.chunk_type == "task" and chunk.block_ids:
            task_row = task_rows.get(chunk.block_ids[0])
        created.append(
            KnowledgeChunk.objects.create(
                document=document,
                section=section_rows.get(chunk.section_path),
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
                task=task_row,
            )
        )

    # Связи parent/previous/next проставляем вторым проходом: на момент создания
    # соседа ещё нет.
    for chunk, row in zip(chunks, created, strict=False):
        updates: list[str] = []
        if chunk.parent_index is not None:
            row.parent = created[chunk.parent_index]
            updates.append("parent")
        if chunk.previous_index is not None:
            row.previous = created[chunk.previous_index]
            updates.append("previous")
        if chunk.next_index is not None:
            row.next = created[chunk.next_index]
            updates.append("next")
        if updates:
            row.save(update_fields=updates)
    return len(created)
