"""Celery-задача обработки учебника.

Брокера в тестах нет: `CELERY_TASK_ALWAYS_EAGER` выполняет задачу прямо в
процессе. Проверяется граница — что через неё едет только идентификатор, что
задача не роняет воркер и что постановка в очередь происходит ПОСЛЕ фиксации
транзакции.
"""

import os
import ssl
import tempfile
from datetime import timedelta
from types import SimpleNamespace
from unittest import mock

from celery.exceptions import Retry
from django.core.exceptions import ImproperlyConfigured
from django.test import TestCase, override_settings
from django.utils import timezone

import config.settings as project_settings
from ai_engine.models import AIUsageQuotaState
from ai_engine.usage import AIUsageLimitExceeded, current_usage_context
from curriculum import storage as storage_module
from curriculum.models import Document, DocumentFile, IngestionJob
from curriculum.services import dispatch
from curriculum.tasks import MAX_RETRIES, _mark_quota_denied, ingest_document_task
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
    def test_celery_restores_usage_context_for_provider_calls(self):
        document = self._document()
        job = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.QUEUED,
            celery_task_id="usage-generation",
        )
        observed = []

        def run(*args, **kwargs):
            observed.append(current_usage_context())
            return SimpleNamespace(job=job, claimed=True)

        with mock.patch("curriculum.tasks.ingest_document", side_effect=run):
            ingest_document_task.apply(
                args=[str(document.pk)], task_id="usage-generation"
            ).get()

        self.assertEqual(observed[0].user_email, EMAIL)
        self.assertEqual(observed[0].feature, "curriculum_ingestion")

    @override_settings(AI_USAGE_ENFORCE_LIMITS=False)
    @mock.patch("ai_engine.usage.AIUsageQuotaState.objects.get_or_create")
    def test_disabled_quota_enforcement_does_not_touch_reservations(self, create):
        document = self._document()
        job = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.QUEUED,
            celery_task_id="quota-disabled-generation",
        )

        with mock.patch(
            "curriculum.tasks.ingest_document",
            return_value=SimpleNamespace(job=job, claimed=True),
        ) as run:
            ingest_document_task.apply(
                args=[str(document.pk)],
                task_id="quota-disabled-generation",
            ).get()

        run.assert_called_once()
        create.assert_not_called()

    @override_settings(
        AI_USAGE_ENFORCE_LIMITS=True,
        CURRICULUM_INGESTION_AI_RESERVATION_TOKENS=100,
        AI_PLAN_LIMITS={
            "free": {"context": 1000, "five_hour": 1000, "weekly": 1000}
        },
    )
    def test_worker_releases_quota_reservation_after_pipeline_exit(self):
        document = self._document()
        job = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.QUEUED,
            celery_task_id="quota-cleanup-generation",
        )

        def run(*args, **kwargs):
            state = AIUsageQuotaState.objects.get(user_email=EMAIL)
            self.assertEqual(len(state.reservations), 1)
            return SimpleNamespace(job=job, claimed=True)

        with mock.patch("curriculum.tasks.ingest_document", side_effect=run):
            ingest_document_task.apply(
                args=[str(document.pk)],
                task_id="quota-cleanup-generation",
            ).get()

        state = AIUsageQuotaState.objects.get(user_email=EMAIL)
        self.assertEqual(state.reservations, {})

    @override_settings(
        AI_USAGE_ENFORCE_LIMITS=True,
        CURRICULUM_INGESTION_AI_RESERVATION_TOKENS=11,
        AI_PLAN_LIMITS={
            "free": {"context": 100, "five_hour": 10, "weekly": 10}
        },
    )
    def test_worker_quota_denial_is_a_terminal_fenced_job_error(self):
        document = self._document()
        document.ingestion_status = Document.Status.QUEUED
        document.save(update_fields=["ingestion_status", "updated_at"])
        job = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.QUEUED,
            celery_task_id="quota-denied-generation",
        )

        with mock.patch("curriculum.tasks.ingest_document") as run:
            ingest_document_task.apply(
                args=[str(document.pk)],
                task_id="quota-denied-generation",
            ).get()

        run.assert_not_called()
        job.refresh_from_db()
        document.refresh_from_db()
        self.assertEqual(job.status, Document.Status.FAILED)
        self.assertEqual(job.error_code, "ai_usage_limit_exceeded")
        self.assertTrue(job.error_message)
        self.assertEqual(job.celery_task_id, "")
        self.assertIsNotNone(job.finished_at)
        self.assertEqual(document.ingestion_status, Document.Status.FAILED)
        attempt = job.attempts.get()
        self.assertFalse(attempt.succeeded)
        self.assertEqual(attempt.from_status, Document.Status.QUEUED)
        self.assertEqual(attempt.to_status, Document.Status.FAILED)
        self.assertEqual(attempt.error_code, "ai_usage_limit_exceeded")

    @override_settings(
        AI_USAGE_ENFORCE_LIMITS=True,
        CURRICULUM_INGESTION_AI_RESERVATION_TOKENS=1,
        AI_PLAN_LIMITS={
            "free": {"context": 1000, "five_hour": 1000, "weekly": 1000}
        },
    )
    def test_provider_call_quota_denial_reaches_fenced_terminal_job(self):
        document = self._document()
        document.ingestion_status = Document.Status.QUEUED
        document.save(update_fields=["ingestion_status", "updated_at"])
        job = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.QUEUED,
            celery_task_id="provider-denied-generation",
        )

        with mock.patch(
            "curriculum.tasks.ingest_document",
            side_effect=AIUsageLimitExceeded(
                window="five_hour",
                reset_at="2026-08-09T12:00:00Z",
            ),
        ):
            ingest_document_task.apply(
                args=[str(document.pk)],
                task_id="provider-denied-generation",
            ).get()

        job.refresh_from_db()
        document.refresh_from_db()
        self.assertEqual(job.status, Document.Status.FAILED)
        self.assertEqual(job.error_code, "ai_usage_limit_exceeded")
        self.assertEqual(document.ingestion_status, Document.Status.FAILED)
        self.assertEqual(
            AIUsageQuotaState.objects.get(user_email=EMAIL).reservations,
            {},
        )

    @override_settings(
        AI_USAGE_ENFORCE_LIMITS=True,
        CURRICULUM_INGESTION_AI_RESERVATION_TOKENS=11,
        AI_PLAN_LIMITS={
            "free": {"context": 100, "five_hour": 10, "weekly": 10}
        },
    )
    def test_quota_denial_from_duplicate_does_not_fail_the_active_generation(self):
        document = self._document()
        document.ingestion_status = Document.Status.VALIDATING
        document.save(update_fields=["ingestion_status", "updated_at"])
        job = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.VALIDATING,
            celery_task_id="active-generation",
        )

        with mock.patch("curriculum.tasks.ingest_document") as run:
            ingest_document_task.apply(
                args=[str(document.pk)],
                task_id="active-generation",
            ).get()

        run.assert_not_called()
        job.refresh_from_db()
        document.refresh_from_db()
        self.assertEqual(job.status, Document.Status.VALIDATING)
        self.assertEqual(job.celery_task_id, "active-generation")
        self.assertEqual(document.ingestion_status, Document.Status.VALIDATING)
        self.assertFalse(job.attempts.exists())

    def test_quota_denial_from_superseded_task_id_does_not_touch_new_generation(self):
        document = self._document()
        document.ingestion_status = Document.Status.QUEUED
        document.save(update_fields=["ingestion_status", "updated_at"])
        job = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.QUEUED,
            celery_task_id="new-generation",
        )

        changed = _mark_quota_denied(
            document,
            job.processing_version,
            expected_task_id="old-generation",
        )

        self.assertFalse(changed)
        job.refresh_from_db()
        document.refresh_from_db()
        self.assertEqual(job.status, Document.Status.QUEUED)
        self.assertEqual(job.celery_task_id, "new-generation")
        self.assertEqual(document.ingestion_status, Document.Status.QUEUED)
        self.assertFalse(job.attempts.exists())

    def test_celery_сообщение_без_job_не_запускает_пайплайн(self):
        document = self._document()

        with mock.patch("curriculum.tasks.ingest_document") as run:
            ingest_document_task.apply(
                args=[str(document.pk)],
                task_id="orphan-message",
            ).get()

        run.assert_not_called()
        self.assertFalse(IngestionJob.objects.filter(document=document).exists())

    def test_исчезнувший_документ_не_ошибка(self):
        # Пока задача ждала в очереди, документ удалили. Это штатная ситуация.
        ingest_document_task.apply(
            args=["11111111-1111-1111-1111-111111111111"]
        ).get()

    def test_задача_с_актуальным_id_обрабатывает_документ(self):
        document = self._document()
        document.ingestion_status = Document.Status.QUEUED
        document.save(update_fields=["ingestion_status", "updated_at"])
        job = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.QUEUED,
            celery_task_id="current-generation",
        )

        ingest_document_task.apply(
            args=[str(document.pk)],
            task_id="current-generation",
        ).get()

        job.refresh_from_db()
        document.refresh_from_db()
        self.assertEqual(job.status, Document.Status.READY)
        self.assertEqual(document.ingestion_status, Document.Status.READY)
        first_attempt = job.attempts.order_by("created_at").first()
        self.assertIsNotNone(first_attempt)
        self.assertEqual(first_attempt.from_status, Document.Status.QUEUED)
        self.assertEqual(first_attempt.to_status, Document.Status.VALIDATING)
        self.assertEqual(
            job.attempts.filter(to_status=Document.Status.VALIDATING).count(),
            1,
        )

    def test_запоздавшая_задача_не_перезапускает_новый_job(self):
        document = self._document()
        document.ingestion_status = Document.Status.QUEUED
        document.save(update_fields=["ingestion_status", "updated_at"])
        job = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.QUEUED,
            celery_task_id="new-generation",
        )

        with mock.patch("curriculum.tasks.ingest_document") as run:
            ingest_document_task.apply(
                args=[str(document.pk)],
                task_id="old-generation",
            ).get()

        run.assert_not_called()
        job.refresh_from_db()
        self.assertEqual(job.status, Document.Status.QUEUED)
        self.assertEqual(job.celery_task_id, "new-generation")

    def test_дубль_того_же_task_id_не_запускает_второй_пайплайн(self):
        document = self._document()
        document.ingestion_status = Document.Status.VALIDATING
        document.save(update_fields=["ingestion_status", "updated_at"])
        job = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.VALIDATING,
            celery_task_id="same-generation",
        )

        ingest_document_task.apply(
            args=[str(document.pk)],
            task_id="same-generation",
        ).get()

        job.refresh_from_db()
        document.refresh_from_db()
        self.assertEqual(job.status, Document.Status.VALIDATING)
        self.assertEqual(document.ingestion_status, Document.Status.VALIDATING)
        self.assertFalse(job.attempts.exists())

    def test_не_захваченный_failed_outcome_не_ретраится(self):
        document = self._document()
        document.ingestion_status = Document.Status.FAILED
        document.save(update_fields=["ingestion_status", "updated_at"])
        job = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.FAILED,
            error_code="storage_unavailable",
            celery_task_id="same-generation",
        )

        with mock.patch.object(ingest_document_task, "retry") as retry:
            ingest_document_task.apply(
                args=[str(document.pk)],
                task_id="same-generation",
            ).get()

        retry.assert_not_called()
        job.refresh_from_db()
        self.assertEqual(job.status, Document.Status.FAILED)
        self.assertEqual(job.retry_count, 0)

    def test_провал_пайплайна_не_роняет_воркер(self):
        # Без файла обработка провалится, но задача обязана завершиться штатно:
        # причина уже записана в джоб, и падать воркеру не из-за чего.
        document = self._document(with_file=False)
        document.ingestion_status = Document.Status.QUEUED
        document.save(update_fields=["ingestion_status", "updated_at"])
        IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.QUEUED,
            celery_task_id="failure-generation",
        )

        ingest_document_task.apply(
            args=[str(document.pk)],
            task_id="failure-generation",
        ).get()

        document.refresh_from_db()
        self.assertEqual(document.ingestion_status, Document.Status.FAILED)
        job = IngestionJob.objects.get(document=document)
        self.assertEqual(job.error_code, "no_file")

    def test_неожиданный_сбой_гасится_внутри_задачи(self):
        document = self._document()
        document.ingestion_status = Document.Status.QUEUED
        document.save(update_fields=["ingestion_status", "updated_at"])
        IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.QUEUED,
            celery_task_id="crash-generation",
        )
        with mock.patch(
            "curriculum.tasks.ingest_document", side_effect=RuntimeError("бум")
        ):
            # `.get()` при EAGER_PROPAGATES поднял бы исключение, если бы задача
            # его выпустила.
            ingest_document_task.apply(
                args=[str(document.pk)],
                task_id="crash-generation",
            ).get()

        document.refresh_from_db()
        job = IngestionJob.objects.get(document=document)
        self.assertEqual(document.ingestion_status, Document.Status.FAILED)
        self.assertEqual(job.error_code, "internal_error")

    def test_временная_ошибка_ставит_чистый_job_на_ограниченный_повтор(self):
        document = self._document()
        job = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.FAILED,
            error_code="storage_unavailable",
            error_message="raw storage error",
            celery_task_id="same-celery-task",
            finished_at=timezone.now(),
        )
        outcome = mock.Mock(job=job)

        with mock.patch(
            "curriculum.tasks.ingest_document", return_value=outcome
        ), mock.patch.object(
            ingest_document_task, "retry", side_effect=Retry()
        ) as retry:
            with self.assertRaises(Retry):
                ingest_document_task.run(str(document.pk))

        retry.assert_called_once_with(countdown=30)
        job.refresh_from_db()
        document.refresh_from_db()
        self.assertEqual(job.status, Document.Status.QUEUED)
        self.assertEqual(document.ingestion_status, Document.Status.QUEUED)
        self.assertEqual(job.error_code, "")
        self.assertEqual(job.error_message, "")
        self.assertIsNone(job.finished_at)
        self.assertEqual(job.retry_count, 1)
        self.assertEqual(job.celery_task_id, "same-celery-task")

    def test_ошибка_публикации_повтора_завершает_job(self):
        document = self._document()
        job = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.FAILED,
            error_code="storage_unavailable",
            celery_task_id="same-celery-task",
        )

        with mock.patch(
            "curriculum.tasks.ingest_document",
            return_value=mock.Mock(job=job),
        ), mock.patch.object(
            ingest_document_task,
            "retry",
            side_effect=ConnectionError("redis down"),
        ):
            ingest_document_task.run(str(document.pk))

        job.refresh_from_db()
        document.refresh_from_db()
        self.assertEqual(job.status, Document.Status.FAILED)
        self.assertEqual(job.error_code, dispatch.QUEUE_UNAVAILABLE_ERROR_CODE)
        self.assertEqual(job.celery_task_id, "")
        self.assertEqual(document.ingestion_status, Document.Status.FAILED)

    def test_старый_авторетрай_не_сбрасывает_новое_поколение(self):
        document = self._document()
        stale_job = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.FAILED,
            error_code="storage_unavailable",
            celery_task_id="old-generation",
        )
        IngestionJob.objects.filter(pk=stale_job.pk).update(
            status=Document.Status.VALIDATING,
            error_code="",
            celery_task_id="new-generation",
        )
        Document.objects.filter(pk=document.pk).update(
            ingestion_status=Document.Status.VALIDATING
        )

        with mock.patch(
            "curriculum.tasks.ingest_document",
            return_value=mock.Mock(job=stale_job, claimed=True),
        ), mock.patch.object(ingest_document_task, "retry") as retry:
            ingest_document_task.run(str(document.pk))

        retry.assert_not_called()
        stale_job.refresh_from_db()
        document.refresh_from_db()
        self.assertEqual(stale_job.status, Document.Status.VALIDATING)
        self.assertEqual(stale_job.celery_task_id, "new-generation")
        self.assertEqual(stale_job.retry_count, 0)
        self.assertEqual(document.ingestion_status, Document.Status.VALIDATING)

    def test_постоянная_ошибка_не_ретраится(self):
        document = self._document()
        job = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.FAILED,
            error_code="pdf_unreadable",
        )
        with mock.patch(
            "curriculum.tasks.ingest_document", return_value=mock.Mock(job=job)
        ), mock.patch.object(ingest_document_task, "retry") as retry:
            ingest_document_task.run(str(document.pk))

        retry.assert_not_called()
        job.refresh_from_db()
        self.assertEqual(job.status, Document.Status.FAILED)

    def test_число_автоматических_повторов_ограничено(self):
        self.assertEqual(ingest_document_task.max_retries, MAX_RETRIES)


@override_settings(
    CELERY_TASK_ALWAYS_EAGER=True,
    CELERY_TASK_EAGER_PROPAGATES=True,
    CELERY_BROKER_URL="redis://localhost:6379/0",
)
class CeleryDispatchTests(_TaskBase):
    @override_settings(CELERY_BROKER_URL="")
    def test_explicit_celery_without_broker_fails_closed(self):
        document = self._document()
        with mock.patch.object(dispatch, "ingest_document") as inline:
            job = dispatch.enqueue_ingestion(
                document,
                mode=dispatch.MODE_CELERY,
            )

        inline.assert_not_called()
        job.refresh_from_db()
        document.refresh_from_db()
        self.assertEqual(job.status, Document.Status.FAILED)
        self.assertEqual(job.error_code, dispatch.QUEUE_UNAVAILABLE_ERROR_CODE)
        self.assertEqual(document.ingestion_status, Document.Status.FAILED)

    def test_постановка_в_очередь_происходит_после_фиксации_транзакции(self):
        # Воркер не должен увидеть документ раньше, чем транзакция вьюхи его
        # зафиксирует, — иначе задача не найдёт строку в базе.
        document = self._document()

        with mock.patch("curriculum.tasks.ingest_document_task.apply_async") as publish:
            with self.captureOnCommitCallbacks(execute=True) as callbacks:
                job = dispatch.enqueue_ingestion(document)
                self.assertEqual(
                    publish.call_count, 0, "до коммита задача не отправляется"
                )

        self.assertEqual(len(callbacks), 1)
        publish.assert_called_once()
        # Через границу брокера едет ТОЛЬКО идентификатор.
        _, publish_kwargs = publish.call_args
        self.assertEqual(publish_kwargs["args"], [str(document.pk)])
        self.assertEqual(
            publish_kwargs["kwargs"], {"processing_version": job.processing_version}
        )
        self.assertEqual(publish_kwargs["task_id"], job.celery_task_id)

        job.refresh_from_db()
        self.assertTrue(job.celery_task_id)
        self.assertEqual(job.status, Document.Status.QUEUED)
        document.refresh_from_db()
        self.assertEqual(document.ingestion_status, Document.Status.QUEUED)

    def test_без_модуля_задач_не_запускаем_тяжёлый_inline(self):
        document = self._document()
        with mock.patch.dict("sys.modules", {"curriculum.tasks": None}):
            job = dispatch.enqueue_ingestion(document)
        document.refresh_from_db()
        job.refresh_from_db()
        self.assertEqual(document.ingestion_status, Document.Status.FAILED)
        self.assertEqual(job.error_code, dispatch.QUEUE_UNAVAILABLE_ERROR_CODE)

    def test_ошибка_публикации_не_оставляет_вечную_очередь(self):
        document = self._document()
        with mock.patch(
            "curriculum.tasks.ingest_document_task.apply_async",
            side_effect=ConnectionError("redis down"),
        ):
            with self.captureOnCommitCallbacks(execute=True):
                job = dispatch.enqueue_ingestion(document)

        document.refresh_from_db()
        job.refresh_from_db()
        self.assertEqual(document.ingestion_status, Document.Status.FAILED)
        self.assertEqual(job.status, Document.Status.FAILED)
        self.assertEqual(job.error_code, dispatch.QUEUE_UNAVAILABLE_ERROR_CODE)

    def test_ошибка_старой_публикации_не_затирает_новый_запуск(self):
        document = self._document()
        job = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.QUEUED,
            celery_task_id="new-generation",
        )

        returned = dispatch.mark_queue_unavailable(
            job,
            expected_task_id="old-generation",
        )

        returned.refresh_from_db()
        document.refresh_from_db()
        self.assertEqual(returned.status, Document.Status.QUEUED)
        self.assertEqual(returned.celery_task_id, "new-generation")
        self.assertNotEqual(
            returned.error_code,
            dispatch.QUEUE_UNAVAILABLE_ERROR_CODE,
        )

    def test_пользовательский_повтор_в_celery_учитывается_один_раз(self):
        document = self._document()
        job = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.FAILED,
            error_code="storage_unavailable",
        )
        with mock.patch("curriculum.tasks.ingest_document_task.apply_async"):
            with self.captureOnCommitCallbacks(execute=True):
                returned = dispatch.enqueue_ingestion(document)

        returned.refresh_from_db()
        self.assertEqual(returned.pk, job.pk)
        self.assertEqual(returned.status, Document.Status.QUEUED)
        self.assertEqual(returned.retry_count, 1)
        self.assertEqual(returned.error_code, "")

    @override_settings(CURRICULUM_INGEST_STALE_AFTER_SECONDS=60)
    def test_ручной_повтор_stale_job_сменяет_поколение(self):
        document = self._document()
        document.ingestion_status = Document.Status.CHUNKING
        document.save(update_fields=["ingestion_status", "updated_at"])
        job = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.CHUNKING,
            celery_task_id="old-generation",
            started_at=timezone.now() - timedelta(hours=2),
        )
        IngestionJob.objects.filter(pk=job.pk).update(
            updated_at=timezone.now() - timedelta(hours=2)
        )
        job.refresh_from_db()

        with mock.patch("curriculum.tasks.ingest_document_task.apply_async"):
            with self.captureOnCommitCallbacks(execute=True):
                returned = dispatch.enqueue_ingestion(document)

        returned.refresh_from_db()
        self.assertEqual(returned.status, Document.Status.QUEUED)
        self.assertEqual(returned.retry_count, 1)
        self.assertTrue(returned.celery_task_id)
        self.assertNotEqual(returned.celery_task_id, "old-generation")

    def test_новая_processing_version_гасит_старый_запуск(self):
        document = self._document()
        document.ingestion_status = Document.Status.CHUNKING
        document.save(update_fields=["ingestion_status", "updated_at"])
        old = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            processing_version="1.0.0",
            status=Document.Status.CHUNKING,
            celery_task_id="old-generation",
        )

        with mock.patch("curriculum.tasks.ingest_document_task.apply_async"):
            with self.captureOnCommitCallbacks(execute=True):
                new = dispatch.enqueue_ingestion(
                    document,
                    processing_version="2.0.0",
                )

        old.refresh_from_db()
        new.refresh_from_db()
        document.refresh_from_db()
        self.assertEqual(old.status, Document.Status.FAILED)
        self.assertEqual(old.error_code, dispatch.SUPERSEDED_ERROR_CODE)
        self.assertEqual(old.celery_task_id, "")
        self.assertEqual(new.status, Document.Status.QUEUED)
        self.assertTrue(new.celery_task_id)
        self.assertEqual(document.ingestion_status, Document.Status.QUEUED)

    def test_смена_версии_отзывает_tokens_даже_у_terminal_jobs(self):
        document = self._document()
        failed = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            processing_version="0.9.0",
            status=Document.Status.FAILED,
            error_code="storage_unavailable",
            celery_task_id="failed-generation",
        )
        ready = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            processing_version="1.0.0",
            status=Document.Status.READY,
            celery_task_id="ready-generation",
        )

        with mock.patch("curriculum.tasks.ingest_document_task.apply_async"):
            with self.captureOnCommitCallbacks(execute=True):
                dispatch.enqueue_ingestion(
                    document,
                    processing_version="2.0.0",
                )

        failed.refresh_from_db()
        ready.refresh_from_db()
        self.assertEqual(failed.status, Document.Status.FAILED)
        self.assertEqual(failed.error_code, "storage_unavailable")
        self.assertEqual(failed.celery_task_id, "")
        self.assertEqual(ready.status, Document.Status.READY)
        self.assertEqual(ready.celery_task_id, "")
        self.assertFalse(
            dispatch.claim_failed_retry(
                failed,
                expected_task_id="failed-generation",
            )
        )


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


class BrokerEnvironmentTests(TestCase):
    def test_northflank_prefixed_redis_url_is_discovered(self):
        with mock.patch.dict(
            os.environ,
            {"NF_REDIS_CACHE_REDIS_MASTER_URL": "rediss://northflank.example/0"},
            clear=True,
        ):
            self.assertEqual(
                project_settings._redis_url_from_env(),
                "rediss://northflank.example/0",
            )

    def test_rediss_broker_keeps_certificate_verification_enabled(self):
        options = project_settings._broker_ssl_options(
            "rediss://northflank.example/0"
        )
        self.assertEqual(options, {"ssl_cert_reqs": ssl.CERT_REQUIRED})
        self.assertFalse(
            project_settings._broker_ssl_options("redis://localhost:6379/0")
        )

    def test_explicit_broker_url_wins_over_northflank_fallback(self):
        with mock.patch.dict(
            os.environ,
            {
                "CELERY_BROKER_URL": "redis://explicit.example/0",
                "NF_REDIS_CACHE_REDIS_MASTER_URL": "rediss://northflank.example/0",
            },
            clear=True,
        ):
            self.assertEqual(
                project_settings._redis_url_from_env(),
                "redis://explicit.example/0",
            )

    def test_other_northflank_addon_prefix_is_supported(self):
        with mock.patch.dict(
            os.environ,
            {"NF_BOOK_QUEUE_REDIS_MASTER_URL": "rediss://queue.example/0"},
            clear=True,
        ):
            self.assertEqual(
                project_settings._redis_url_from_env(), "rediss://queue.example/0"
            )

    def test_multiple_unknown_northflank_redis_addons_require_explicit_url(self):
        with mock.patch.dict(
            os.environ,
            {
                "NF_FIRST_REDIS_MASTER_URL": "rediss://first.example/0",
                "NF_SECOND_REDIS_MASTER_URL": "rediss://second.example/0",
            },
            clear=True,
        ):
            with self.assertRaises(ImproperlyConfigured):
                project_settings._redis_url_from_env()

    def test_known_and_other_northflank_redis_addons_are_also_ambiguous(self):
        with mock.patch.dict(
            os.environ,
            {
                "NF_REDIS_CACHE_REDIS_MASTER_URL": "rediss://cache.example/0",
                "NF_OTHER_REDIS_MASTER_URL": "rediss://other.example/0",
            },
            clear=True,
        ):
            with self.assertRaises(ImproperlyConfigured):
                project_settings._redis_url_from_env()
