"""Файл книги читается своим хранилищем и удаляется вместе с книгой."""

from __future__ import annotations

import shutil
import tempfile
from unittest import mock

from celery.exceptions import SoftTimeLimitExceeded
from django.test import TestCase

from curriculum import storage as storage_module
from curriculum.models import (
    Document,
    DocumentFile,
    IngestionJob,
    LearningGoal,
)
from curriculum.services import ingestion
from curriculum.storage import LocalFileStorage, StorageError
from curriculum.tasks import ingest_document_task
from curriculum.tests.test_storage_s3 import StubClientError, make_storage

EMAIL = "lifecycle@example.com"


class FileLifecycleTests(TestCase):
    def setUp(self):
        self.store, self.s3 = make_storage()
        storage_module.set_storage(self.store)
        self.addCleanup(storage_module.set_storage, None)

    def _book(self, *, backend="s3", store=None, goal=None) -> tuple[Document, str]:
        store = store or self.store
        document = Document.objects.create(user_email=EMAIL, title="Книга", goal=goal)
        key = storage_module.build_storage_key(
            user_email=EMAIL, document_id=str(document.pk), filename="book.pdf"
        )
        data = b"%PDF-1.4 test"
        store.save(key, data)
        DocumentFile.objects.create(
            document=document,
            original_filename="book.pdf",
            sanitized_filename="book.pdf",
            storage_backend=backend,
            storage_key=key,
            mime_type="application/pdf",
            byte_size=len(data),
            content_hash=storage_module.content_hash(data),
        )
        return document, key

    def test_file_is_read_from_the_backend_it_was_saved_to(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        data = b"local bytes"
        document, key = self._book(backend="local", store=LocalFileStorage(tmp))
        LocalFileStorage(tmp).save(key, data)
        document = Document.objects.get(pk=document.pk)
        with self.settings(CURRICULUM_STORAGE_ROOT=tmp):
            self.assertEqual(ingestion._read_file(document), data)

    def test_read_file_lets_the_time_limit_through(self):
        document, _ = self._book()
        with mock.patch(
            "curriculum.services.ingestion.get_storage_for",
            side_effect=SoftTimeLimitExceeded(),
        ):
            with self.assertRaises(SoftTimeLimitExceeded):
                ingestion._read_file(document)

    def test_get_storage_for_s3_without_settings_is_an_error(self):
        storage_module.set_storage(None)
        with mock.patch.object(storage_module, "s3_settings_from_django", return_value=None):
            with self.assertRaises(StorageError):
                storage_module.get_storage_for("s3")

    def test_get_storage_for_reuses_the_process_storage(self):
        self.assertIs(storage_module.get_storage_for("s3"), self.store)
        self.assertIs(
            storage_module.get_storage_for("s3"), storage_module.get_storage_for("s3")
        )

    def test_get_storage_for_default_local_is_one_object(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        storage_module.set_storage(None)
        with self.settings(CURRICULUM_STORAGE_ROOT=tmp), mock.patch.object(
            storage_module, "s3_settings_from_django", return_value=None
        ):
            self.assertIs(
                storage_module.get_storage_for("local"),
                storage_module.get_storage_for("local"),
            )

    def test_deleting_a_book_deletes_its_file(self):
        document, key = self._book()
        self.assertTrue(self.store.exists(key))
        with self.captureOnCommitCallbacks(execute=True):
            document.delete()
        self.assertFalse(self.store.exists(key))

    def test_file_is_kept_until_commit(self):
        document, key = self._book()
        with self.captureOnCommitCallbacks(execute=False):
            document.delete()
        self.assertTrue(self.store.exists(key))

    def test_deleting_a_subject_deletes_book_files(self):
        goal = LearningGoal.objects.create(user_email=EMAIL, original_text="механика")
        _, key = self._book(goal=goal)
        with self.captureOnCommitCallbacks(execute=True):
            goal.delete()
        self.assertFalse(self.store.exists(key))

    def test_storage_failure_on_delete_is_only_logged(self):
        document, key = self._book()
        pk = document.pk
        self.s3.raise_on["delete_object"] = StubClientError("AccessDenied")
        with self.assertLogs("curriculum.signals", "WARNING") as cm, \
                self.captureOnCommitCallbacks(execute=True):
            document.delete()
        self.assertTrue(
            any("curriculum_file_delete_failed" in line and key in line for line in cm.output)
        )
        self.assertFalse(Document.objects.filter(pk=pk).exists())

    def test_deleting_a_queued_book_removes_the_file_and_the_task_skips(self):
        document, key = self._book()
        IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.QUEUED,
            celery_task_id="queued-1",
        )
        document_id = str(document.pk)
        with self.captureOnCommitCallbacks(execute=True):
            document.delete()
        self.assertFalse(self.store.exists(key))
        with mock.patch("curriculum.tasks.ingest_document") as pipeline:
            result = ingest_document_task.apply(args=[document_id], task_id="queued-1")
        self.assertTrue(result.successful(), result.traceback)
        pipeline.assert_not_called()
        self.assertFalse(IngestionJob.objects.filter(celery_task_id="queued-1").exists())
