"""Машина состояний ingestion: переходы, идемпотентность, отказы."""

import tempfile

from django.test import TestCase

from curriculum import storage as storage_module
from curriculum.models import (
    Document,
    DocumentBlock,
    DocumentFile,
    DocumentPage,
    DocumentSection,
    ExtractedSolution,
    ExtractedTask,
    IngestionAttempt,
    IngestionJob,
    KnowledgeChunk,
)
from curriculum.ocr import NullOcrProvider, OcrResult
from curriculum.services.ingestion import ingest_document
from curriculum.tests.pdf_fixtures import scanned_pdf, textbook_pdf

EMAIL = "student@example.com"


class StubOcrProvider:
    """Детерминированный OCR без сети."""

    name = "stub-ocr"

    def __init__(self, text: str = "Problem 9. Stub page.\nSolution. x = 1."):
        self.text = text
        self.calls = 0

    def transcribe_page(self, png_bytes: bytes) -> OcrResult:
        self.calls += 1
        return OcrResult(text=self.text, model=self.name, succeeded=True)


class _IngestionBase(TestCase):
    def setUp(self):
        storage_module.set_storage(
            storage_module.LocalFileStorage(tempfile.mkdtemp())
        )

    def _make_document(self, pdf: bytes, **kwargs) -> Document:
        document = Document.objects.create(
            user_email=EMAIL, title=kwargs.pop("title", "Учебник"), **kwargs
        )
        key = storage_module.build_storage_key(
            user_email=EMAIL, document_id=str(document.pk), filename="book.pdf"
        )
        storage_module.get_storage().save(key, pdf)
        DocumentFile.objects.create(
            document=document,
            original_filename="book.pdf",
            sanitized_filename="book.pdf",
            storage_key=key,
            mime_type="application/pdf",
            byte_size=len(pdf),
            content_hash=storage_module.content_hash(pdf),
        )
        return document


class HappyPathTests(_IngestionBase):
    def setUp(self):
        super().setUp()
        self.document = self._make_document(textbook_pdf())
        self.outcome = ingest_document(
            self.document, ocr_provider=NullOcrProvider()
        )

    def test_reaches_ready(self):
        self.assertTrue(self.outcome.succeeded)
        self.document.refresh_from_db()
        self.assertEqual(self.document.ingestion_status, Document.Status.READY)

    def test_writes_every_derived_table(self):
        self.assertEqual(DocumentPage.objects.filter(document=self.document).count(), 2)
        self.assertGreater(
            DocumentSection.objects.filter(document=self.document).count(), 0
        )
        self.assertGreater(
            DocumentBlock.objects.filter(document=self.document).count(), 0
        )
        self.assertGreater(
            KnowledgeChunk.objects.filter(document=self.document).count(), 0
        )

    def test_page_count_reconciled_from_pdfium(self):
        self.document.refresh_from_db()
        self.assertEqual(self.document.page_count, 2)

    def test_tasks_and_solutions_in_separate_tables(self):
        tasks = ExtractedTask.objects.filter(document=self.document)
        solutions = ExtractedSolution.objects.filter(document=self.document)
        self.assertEqual(tasks.count(), 2)
        self.assertEqual(solutions.count(), 2)
        for task in tasks:
            self.assertNotIn("=", task.statement.split(".")[-1] or "")
            self.assertNotIn("Solution", task.statement)

    def test_solution_chunks_are_restricted(self):
        restricted = KnowledgeChunk.objects.filter(
            document=self.document,
            solution_visibility=KnowledgeChunk.SolutionVisibility.RESTRICTED,
        )
        self.assertEqual(restricted.count(), 2)
        for chunk in restricted:
            self.assertEqual(chunk.chunk_type, "solution")

    def test_no_always_visible_chunk_contains_solution_text(self):
        """Ключевая гарантия безопасности на уровне БД."""
        visible = KnowledgeChunk.objects.filter(
            document=self.document,
            solution_visibility=KnowledgeChunk.SolutionVisibility.ALWAYS,
        )
        for chunk in visible:
            self.assertNotIn("s = v0 t", chunk.normalized_text)
            self.assertNotIn("F = m a", chunk.normalized_text)

    def test_transitions_logged_in_order(self):
        job = IngestionJob.objects.get(document=self.document)
        statuses = list(
            IngestionAttempt.objects.filter(job=job).values_list("to_status", flat=True)
        )
        self.assertEqual(
            statuses,
            [
                Document.Status.VALIDATING,
                Document.Status.EXTRACTING,
                Document.Status.CLASSIFYING,
                Document.Status.OCR,
                Document.Status.RECONSTRUCTING,
                Document.Status.EXTRACTING_BLOCKS,
                Document.Status.CHUNKING,
                Document.Status.INDEXING,
                Document.Status.QUALITY_CHECK,
                Document.Status.READY,
            ],
        )

    def test_chunk_links_are_set(self):
        chunks = KnowledgeChunk.objects.filter(document=self.document).order_by(
            "page_start", "id"
        )
        self.assertTrue(any(c.next_id for c in chunks))
        self.assertTrue(any(c.previous_id for c in chunks))

    def test_task_chunks_linked_to_extracted_task(self):
        task_chunks = KnowledgeChunk.objects.filter(
            document=self.document, chunk_type="task"
        )
        self.assertGreater(task_chunks.count(), 0)
        for chunk in task_chunks:
            self.assertIsNotNone(chunk.task_id)


class IdempotencyTests(_IngestionBase):
    def test_rerun_does_not_duplicate_rows(self):
        document = self._make_document(textbook_pdf())
        first = ingest_document(document, ocr_provider=NullOcrProvider())
        counts = (
            DocumentPage.objects.filter(document=document).count(),
            DocumentBlock.objects.filter(document=document).count(),
            KnowledgeChunk.objects.filter(document=document).count(),
            ExtractedTask.objects.filter(document=document).count(),
        )
        second = ingest_document(document, ocr_provider=NullOcrProvider())
        self.assertTrue(second.succeeded)
        self.assertEqual(
            counts,
            (
                DocumentPage.objects.filter(document=document).count(),
                DocumentBlock.objects.filter(document=document).count(),
                KnowledgeChunk.objects.filter(document=document).count(),
                ExtractedTask.objects.filter(document=document).count(),
            ),
        )
        self.assertEqual(first.chunks, second.chunks)

    def test_single_job_per_processing_version(self):
        document = self._make_document(textbook_pdf())
        ingest_document(document, ocr_provider=NullOcrProvider())
        ingest_document(document, ocr_provider=NullOcrProvider())
        self.assertEqual(IngestionJob.objects.filter(document=document).count(), 1)

    def test_attempt_log_is_append_only(self):
        document = self._make_document(textbook_pdf())
        ingest_document(document, ocr_provider=NullOcrProvider())
        job = IngestionJob.objects.get(document=document)
        first = IngestionAttempt.objects.filter(job=job).count()
        ingest_document(document, ocr_provider=NullOcrProvider())
        self.assertEqual(IngestionAttempt.objects.filter(job=job).count(), first * 2)

    def test_new_processing_version_gets_own_job(self):
        document = self._make_document(textbook_pdf())
        ingest_document(document, ocr_provider=NullOcrProvider())
        ingest_document(
            document, processing_version="2.0.0", ocr_provider=NullOcrProvider()
        )
        self.assertEqual(IngestionJob.objects.filter(document=document).count(), 2)


class OcrPathTests(_IngestionBase):
    def test_ocr_runs_only_on_scanned_pages(self):
        document = self._make_document(scanned_pdf())
        provider = StubOcrProvider()
        ingest_document(document, ocr_provider=provider)
        # Вторая страница пустая → ровно один вызов OCR, не два.
        self.assertEqual(provider.calls, 1)
        page_two = DocumentPage.objects.get(document=document, page_number=2)
        self.assertTrue(page_two.needs_ocr)
        self.assertTrue(page_two.ocr_applied)
        self.assertEqual(page_two.ocr_model, "stub-ocr")

    def test_ocr_text_is_classified_like_native_text(self):
        document = self._make_document(scanned_pdf())
        ingest_document(document, ocr_provider=StubOcrProvider())
        # У страницы-скана распознались задача и решение.
        self.assertTrue(
            ExtractedTask.objects.filter(document=document, page_start=2).exists()
        )

    def test_native_page_untouched_by_ocr(self):
        document = self._make_document(scanned_pdf())
        ingest_document(document, ocr_provider=StubOcrProvider())
        page_one = DocumentPage.objects.get(document=document, page_number=1)
        self.assertFalse(page_one.needs_ocr)
        self.assertFalse(page_one.ocr_applied)

    def test_unconfigured_ocr_warns_once_and_does_not_fail(self):
        document = self._make_document(scanned_pdf())
        outcome = ingest_document(document, ocr_provider=NullOcrProvider())
        self.assertTrue(outcome.succeeded)
        self.assertEqual(outcome.warnings.count("ocr_not_configured"), 1)

    def test_ocr_page_cap_is_reported(self):
        document = self._make_document(scanned_pdf())
        outcome = ingest_document(
            document, ocr_provider=StubOcrProvider(), max_ocr_pages=0
        )
        self.assertTrue(
            any(w.startswith("ocr_limited_to_0") for w in outcome.warnings),
            outcome.warnings,
        )


class FailurePathTests(_IngestionBase):
    def test_missing_file_fails_cleanly(self):
        document = Document.objects.create(user_email=EMAIL, title="Без файла")
        outcome = ingest_document(document)
        self.assertFalse(outcome.succeeded)
        self.assertEqual(outcome.job.error_code, "no_file")
        document.refresh_from_db()
        self.assertEqual(document.ingestion_status, Document.Status.FAILED)

    def test_corrupt_pdf_fails_with_code(self):
        document = self._make_document(b"%PDF-1.7\ngarbage not a real pdf\n%%EOF\n")
        outcome = ingest_document(document, ocr_provider=NullOcrProvider())
        self.assertFalse(outcome.succeeded)
        self.assertIn(outcome.job.error_code, {"pdf_unreadable", "no_pages", "no_content"})

    def test_failure_is_logged_as_unsuccessful_attempt(self):
        document = Document.objects.create(user_email=EMAIL, title="Без файла")
        ingest_document(document)
        job = IngestionJob.objects.get(document=document)
        failed = IngestionAttempt.objects.filter(job=job, succeeded=False)
        self.assertEqual(failed.count(), 1)
        self.assertEqual(failed.first().to_status, Document.Status.FAILED)

    def test_retry_after_failure_increments_counter(self):
        document = Document.objects.create(user_email=EMAIL, title="Без файла")
        ingest_document(document)
        ingest_document(document)
        job = IngestionJob.objects.get(document=document)
        self.assertEqual(job.retry_count, 1)

    def test_ingestion_never_raises(self):
        """View обязан получить статус, а не исключение."""
        document = Document.objects.create(user_email=EMAIL, title="Без файла")
        try:
            ingest_document(document)
        except Exception as exc:  # noqa: BLE001
            self.fail(f"ingest_document пробросил исключение: {exc!r}")
