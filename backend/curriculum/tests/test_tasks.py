"""Celery-задача обработки учебника.

Брокера в тестах нет: `CELERY_TASK_ALWAYS_EAGER` выполняет задачу прямо в
процессе. Проверяется граница — что через неё едет только идентификатор, что
задача не роняет воркер и что постановка в очередь происходит ПОСЛЕ фиксации
транзакции.
"""

import tempfile
from unittest import mock

from django.test import TestCase, override_settings

from curriculum import storage as storage_module
from curriculum.models import Document, DocumentFile, IngestionJob
from curriculum.services import dispatch
from curriculum.tasks import ingest_document_task
from curriculum.tests.pdf_fixtures import textbook_pdf

EMAIL = "student@example.com"


class _TaskBase(TestCase):
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


@override_settings(CELERY_TASK_ALWAYS_EAGER=True, CELERY_TASK_EAGER_PROPAGATES=True)
class IngestTaskTests(_TaskBase):
    def test_задача_обрабатывает_документ_по_идентификатору(self):
        document = self._document()

        ingest_document_task.apply(args=[str(document.pk)]).get()

        document.refresh_from_db()
        self.assertEqual(document.ingestion_status, Document.Status.READY)
        self.assertTrue(IngestionJob.objects.filter(document=document).exists())

    def test_исчезнувший_документ_не_ошибка(self):
        # Пока задача ждала в очереди, документ удалили. Это штатная ситуация.
        ingest_document_task.apply(
            args=["11111111-1111-1111-1111-111111111111"]
        ).get()

    def test_провал_пайплайна_не_роняет_воркер(self):
        # Без файла обработка провалится, но задача обязана завершиться штатно:
        # причина уже записана в джоб, и падать воркеру не из-за чего.
        document = self._document(with_file=False)

        ingest_document_task.apply(args=[str(document.pk)]).get()

        document.refresh_from_db()
        self.assertEqual(document.ingestion_status, Document.Status.FAILED)
        job = IngestionJob.objects.get(document=document)
        self.assertEqual(job.error_code, "no_file")

    def test_неожиданный_сбой_гасится_внутри_задачи(self):
        document = self._document()
        with mock.patch(
            "curriculum.tasks.ingest_document", side_effect=RuntimeError("бум")
        ):
            # `.get()` при EAGER_PROPAGATES поднял бы исключение, если бы задача
            # его выпустила.
            ingest_document_task.apply(args=[str(document.pk)]).get()


@override_settings(
    CELERY_TASK_ALWAYS_EAGER=True,
    CELERY_TASK_EAGER_PROPAGATES=True,
    CELERY_BROKER_URL="redis://localhost:6379/0",
)
class CeleryDispatchTests(_TaskBase):
    def test_постановка_в_очередь_происходит_после_фиксации_транзакции(self):
        # Воркер не должен увидеть документ раньше, чем транзакция вьюхи его
        # зафиксирует, — иначе задача не найдёт строку в базе.
        document = self._document()

        with mock.patch("curriculum.tasks.ingest_document_task.delay") as delay:
            delay.return_value = mock.Mock(id="task-123")
            with self.captureOnCommitCallbacks(execute=True) as callbacks:
                job = dispatch.enqueue_ingestion(document)
                self.assertEqual(
                    delay.call_count, 0, "до коммита задача не отправляется"
                )

        self.assertEqual(len(callbacks), 1)
        delay.assert_called_once()
        # Через границу брокера едет ТОЛЬКО идентификатор.
        args, kwargs = delay.call_args
        self.assertEqual(args, (str(document.pk),))
        self.assertEqual(set(kwargs), {"processing_version"})

        job.refresh_from_db()
        self.assertEqual(job.celery_task_id, "task-123")

    def test_без_модуля_задач_откатываемся_на_inline(self):
        # Выставленный раньше времени брокер не должен приводить к документу,
        # навсегда зависшему в статусе «загружен».
        document = self._document()
        with mock.patch.dict("sys.modules", {"curriculum.tasks": None}):
            dispatch.enqueue_ingestion(document)
        document.refresh_from_db()
        self.assertEqual(document.ingestion_status, Document.Status.READY)


class CelerySettingsTests(TestCase):
    def test_приложение_создаётся_и_задача_зарегистрирована(self):
        from config import celery_app

        self.assertIsNotNone(celery_app)
        self.assertIn("curriculum.ingest_document", celery_app.tasks)

    def test_pickle_запрещён(self):
        # Pickle в брокере = исполнение произвольного кода из сообщения.
        from config import celery_app

        self.assertEqual(celery_app.conf.accept_content, ["json"])
        self.assertEqual(celery_app.conf.task_serializer, "json")

    def test_результатов_у_задач_нет(self):
        # Хранилище результата — IngestionJob. Второй копии статуса быть не должно.
        from config import celery_app

        self.assertIsNone(celery_app.conf.result_backend)
        self.assertTrue(celery_app.conf.task_ignore_result)

    def test_одна_книга_за_раз_на_воркера(self):
        from config import celery_app

        self.assertEqual(celery_app.conf.worker_prefetch_multiplier, 1)
        self.assertTrue(celery_app.conf.task_acks_late)
        self.assertFalse(celery_app.conf.task_reject_on_worker_lost)


class BrokerKillSwitchTests(TestCase):
    """Третий рубильник: под тест-раннером брокера нет."""

    def test_под_тест_раннером_брокер_пуст(self):
        # Как только боевой REDIS_MASTER_URL появился в .env, восемь тестов
        # упали разом: resolve_mode начал выбирать celery, и документы в
        # inline-тестах перестали обрабатываться вовсе.
        from django.conf import settings

        self.assertEqual(settings.CELERY_BROKER_URL, "")
        self.assertEqual(dispatch.resolve_mode(), dispatch.MODE_INLINE)
