"""Машина состояний ingestion: переходы, идемпотентность, отказы."""

import tempfile
from unittest import mock

from django.test import SimpleTestCase, TestCase

from ai_engine.usage import AIUsageLimitExceeded

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
from curriculum.services.embedding_index import IndexOutcome
from curriculum.services.ingestion import detect_language, ingest_document
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


class LanguageDetectionTests(SimpleTestCase):
    """Язык книги нужен полнотекстовому поиску.

    До этого конфигурация FTS была зашита русской, и английский учебник
    разбирался русской морфологией: `learning` и `learn` не сходились к одной
    основе, а английские стоп-слова не отбрасывались.
    """

    def test_русский_текст(self):
        self.assertEqual(
            detect_language("Импульсом тела называется произведение массы"),
            "ru",
        )

    def test_английский_текст(self):
        self.assertEqual(
            detect_language("Machine learning is the science of programming"),
            "en",
        )

    def test_русский_с_формулами_и_латиницей(self):
        # В русском учебнике полно латиницы: обозначения, формулы, ссылки.
        # Порог низкий именно поэтому.
        text = "Импульс p = mv, где m — масса, v — velocity (LaTeX: \\vec{p})"
        self.assertEqual(detect_language(text), "ru")

    def test_текст_без_букв_не_даёт_языка(self):
        # Пустой ответ означает «не знаю», и прежнее значение честнее выдумки.
        self.assertEqual(detect_language("123 456 — 789"), "")
        self.assertEqual(detect_language(""), "")


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
            KnowledgeChunk.objects.filter(document_id=self.document.pk).count(), 0
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
            document_id=self.document.pk,
            solution_visibility=KnowledgeChunk.SolutionVisibility.RESTRICTED,
        )
        self.assertEqual(restricted.count(), 2)
        for chunk in restricted:
            self.assertEqual(chunk.chunk_type, "solution")

    def test_no_always_visible_chunk_contains_solution_text(self):
        """Ключевая гарантия безопасности на уровне БД."""
        visible = KnowledgeChunk.objects.filter(
            document_id=self.document.pk,
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
        chunks = KnowledgeChunk.objects.filter(document_id=self.document.pk).order_by(
            "page_start", "id"
        )
        self.assertTrue(any(c.next_id for c in chunks))
        self.assertTrue(any(c.previous_id for c in chunks))

    def test_task_chunks_linked_to_extracted_task(self):
        task_chunks = KnowledgeChunk.objects.filter(
            document_id=self.document.pk, chunk_type="task"
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
            KnowledgeChunk.objects.filter(document_id=document.pk).count(),
            ExtractedTask.objects.filter(document=document).count(),
        )
        second = ingest_document(document, ocr_provider=NullOcrProvider())
        self.assertTrue(second.succeeded)
        self.assertEqual(
            counts,
            (
                DocumentPage.objects.filter(document=document).count(),
                DocumentBlock.objects.filter(document=document).count(),
                KnowledgeChunk.objects.filter(document_id=document.pk).count(),
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


class RunFencingTests(_IngestionBase):
    def test_embedding_index_is_scoped_to_chunks_created_by_this_run(self):
        document = self._make_document(textbook_pdf())

        with mock.patch(
            "curriculum.services.ingestion.index_document_chunks",
            return_value=IndexOutcome(),
        ) as index_chunks:
            outcome = ingest_document(
                document,
                ocr_provider=NullOcrProvider(),
            )

        self.assertTrue(outcome.succeeded)
        scoped_ids = set(index_chunks.call_args.kwargs["chunk_ids"])
        current_ids = set(
            KnowledgeChunk.objects.filter(document_id=document.pk).values_list(
                "pk", flat=True
            )
        )
        self.assertEqual(scoped_ids, current_ids)

    def test_superseded_celery_run_does_not_touch_pipeline(self):
        document = self._make_document(
            textbook_pdf(), ingestion_status=Document.Status.QUEUED
        )
        job = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.QUEUED,
            celery_task_id="new-generation",
        )

        outcome = ingest_document(
            document,
            run_token="old-generation",
            ocr_provider=NullOcrProvider(),
        )

        job.refresh_from_db()
        document.refresh_from_db()
        self.assertEqual(outcome.job.pk, job.pk)
        self.assertEqual(job.status, Document.Status.QUEUED)
        self.assertEqual(job.celery_task_id, "new-generation")
        self.assertEqual(document.ingestion_status, Document.Status.QUEUED)
        self.assertFalse(IngestionAttempt.objects.filter(job=job).exists())
        self.assertFalse(DocumentPage.objects.filter(document=document).exists())


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

    def test_quota_denial_escapes_ingestion_for_worker_terminal_handling(self):
        class DeniedOcr:
            name = "denied"

            def transcribe_page(self, png_bytes):
                raise AIUsageLimitExceeded(
                    window="five_hour",
                    reset_at="2026-08-09T12:00:00Z",
                )

        document = self._make_document(scanned_pdf())
        with self.assertRaises(AIUsageLimitExceeded):
            ingest_document(document, ocr_provider=DeniedOcr())


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
