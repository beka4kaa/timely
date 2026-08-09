"""Постановка документа в обработку.

Проверяется контракт, на который опирается фронтенд: job существует сразу, второй
клик не запускает вторую обработку, а зависший job не блокирует документ навсегда.
"""

import tempfile
from datetime import timedelta
from unittest import mock

from django.core.exceptions import ImproperlyConfigured
from django.test import TestCase, override_settings
from django.utils import timezone

from curriculum import storage as storage_module
from curriculum.models import Document, DocumentFile, IngestionJob
from curriculum.ocr import NullOcrProvider
from curriculum.services import dispatch
from curriculum.tests.pdf_fixtures import textbook_pdf

EMAIL = "student@example.com"


class _DispatchBase(TestCase):
    def setUp(self):
        storage_module.set_storage(
            storage_module.LocalFileStorage(tempfile.mkdtemp())
        )

    def _document(self, *, with_file: bool = True) -> Document:
        document = Document.objects.create(user_email=EMAIL, title="Механика")
        if not with_file:
            return document
        pdf = textbook_pdf()
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

    def _enqueue(self, document, **kwargs):
        kwargs.setdefault("ocr_provider", NullOcrProvider())
        return dispatch.enqueue_ingestion(document, **kwargs)


class InlineDispatchTests(_DispatchBase):
    def test_job_row_exists_after_enqueue(self):
        """Фронтенд получает 202 и идёт опрашивать статус — джоб обязан быть."""
        document = self._document()
        job = self._enqueue(document)
        self.assertTrue(IngestionJob.objects.filter(pk=job.pk).exists())

    def test_inline_mode_completes_processing(self):
        document = self._document()
        job = self._enqueue(document)
        document.refresh_from_db()
        self.assertEqual(document.ingestion_status, Document.Status.READY)
        self.assertEqual(job.status, Document.Status.READY)

    def test_failure_does_not_raise(self):
        """Постановка успешна даже когда обработка провалилась."""
        document = self._document(with_file=False)
        job = self._enqueue(document)
        self.assertEqual(job.status, Document.Status.FAILED)
        self.assertEqual(job.error_code, "no_file")

    def test_second_enqueue_does_not_duplicate_job(self):
        document = self._document()
        first = self._enqueue(document)
        second = self._enqueue(document)
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(IngestionJob.objects.filter(document=document).count(), 1)

    def test_new_processing_version_gets_its_own_job(self):
        document = self._document()
        self._enqueue(document)
        self._enqueue(document, processing_version="9.9.9")
        self.assertEqual(IngestionJob.objects.filter(document=document).count(), 2)

    def test_warnings_persisted_on_job(self):
        """Без этого асинхронный путь молча теряет причины вроде «OCR не настроен».

        Ответ на POST уходит раньше, чем предупреждения появятся, и опрос статуса
        остаётся единственным способом их показать.
        """
        document = self._document()
        job = self._enqueue(document)
        job.refresh_from_db()
        self.assertIsInstance(job.warnings, list)


class DoubleClickGuardTests(_DispatchBase):
    """Защита от повторной постановки, пока обработка идёт."""

    def test_running_job_is_not_redispatched(self):
        document = self._document()
        job = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.CHUNKING,
            started_at=timezone.now(),
        )
        with mock.patch.object(dispatch, "ingest_document") as run:
            returned = dispatch.enqueue_ingestion(document)
        run.assert_not_called()
        self.assertEqual(returned.pk, job.pk)

    def test_fresh_queued_job_is_not_redispatched(self):
        document = self._document()
        job = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.QUEUED,
        )
        with mock.patch.object(dispatch, "ingest_document") as run:
            returned = dispatch.enqueue_ingestion(document)
        run.assert_not_called()
        self.assertEqual(returned.pk, job.pk)

    def test_fresh_job_without_start_is_dispatched(self):
        """Строка есть, но обработка ещё не запускалась — запустить надо."""
        document = self._document()
        IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.UPLOADED,
            started_at=None,
        )
        job = self._enqueue(document)
        self.assertEqual(job.status, Document.Status.READY)

    def test_terminal_job_is_redispatched(self):
        """Повторный запуск после провала — это retry, а не блокировка."""
        document = self._document()
        failed = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.FAILED,
            error_code="no_file",
            started_at=timezone.now(),
        )
        job = self._enqueue(document)
        self.assertEqual(job.pk, failed.pk)
        self.assertEqual(job.status, Document.Status.READY)
        self.assertEqual(job.retry_count, 1)

    @override_settings(CURRICULUM_INGEST_STALE_AFTER_SECONDS=60)
    def test_stale_job_is_redispatched(self):
        """Убитый воркер не должен заблокировать документ навсегда."""
        document = self._document()
        stale = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.CHUNKING,
            started_at=timezone.now() - timedelta(hours=2),
        )
        IngestionJob.objects.filter(pk=stale.pk).update(
            updated_at=timezone.now() - timedelta(hours=2)
        )
        stale.refresh_from_db()
        self.assertTrue(dispatch.is_stale(stale))

        job = self._enqueue(document)
        self.assertEqual(job.status, Document.Status.READY)

    def test_terminal_job_is_never_stale(self):
        document = self._document()
        job = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.READY,
            started_at=timezone.now() - timedelta(days=7),
        )
        self.assertFalse(dispatch.is_stale(job))


class ModeSelectionTests(TestCase):
    """Выбор исполнителя. Дефолт обязан быть работающим, а не «правильным»."""

    @override_settings(CELERY_BROKER_URL="")
    def test_auto_without_broker_is_inline(self):
        self.assertEqual(dispatch.resolve_mode(), dispatch.MODE_INLINE)

    @override_settings(CELERY_BROKER_URL="redis://localhost:6379/0")
    def test_auto_with_broker_is_celery(self):
        self.assertEqual(dispatch.resolve_mode(), dispatch.MODE_CELERY)

    @override_settings(CELERY_BROKER_URL="redis://localhost:6379/0")
    def test_explicit_mode_wins_over_auto(self):
        self.assertEqual(
            dispatch.resolve_mode(dispatch.MODE_INLINE), dispatch.MODE_INLINE
        )

    @override_settings(CURRICULUM_INGEST_MODE="  CeLeRy  ")
    def test_mode_is_normalized(self):
        self.assertEqual(dispatch.resolve_mode(), dispatch.MODE_CELERY)

    @override_settings(CURRICULUM_INGEST_MODE="celrey")
    def test_invalid_mode_fails_loudly_instead_of_running_inline(self):
        with self.assertRaises(ImproperlyConfigured):
            dispatch.resolve_mode()
