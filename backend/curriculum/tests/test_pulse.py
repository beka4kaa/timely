"""Пульс обработки из фонового потока (решение 15).

Пока идёт блок, поток раз в интервал двигает `updated_at` джоба своего запуска.
Зависание считается по этому пульсу, поэтому поток не должен ни замолкать на
живом запуске, ни бить после конца блока или за чужой запуск.

`TransactionTestCase`: поток ходит в базу своим соединением и видит только
зафиксированные строки.
"""

import threading
import time
import uuid
from datetime import timedelta
from unittest import mock

from django.conf import settings
from django.db import InterfaceError, OperationalError
from django.test import SimpleTestCase, TransactionTestCase
from django.utils import timezone

import config.settings as project_settings
from curriculum.models import Document, IngestionJob
from curriculum.services import pulse
from curriculum.services.pulse import job_pulse

EMAIL = "student@example.com"
INTERVAL = 0.05


class JobPulseTests(TransactionTestCase):
    def _job(self, *, celery_task_id: str = "t") -> IngestionJob:
        document = Document.objects.create(user_email=EMAIL, title="Механика")
        job = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.OCR,
            celery_task_id=celery_task_id,
        )
        # `updated_at` — auto_now: прошлое время ставится только через update().
        IngestionJob.objects.filter(pk=job.pk).update(
            updated_at=timezone.now() - timedelta(hours=1)
        )
        job.refresh_from_db()
        return job

    def _age(self, job: IngestionJob) -> timedelta:
        job.refresh_from_db()
        return timezone.now() - job.updated_at

    def test_pulse_moves_updated_at_while_the_block_runs(self):
        job = self._job()

        with job_pulse(job.pk, run_token="t", interval_seconds=INTERVAL):
            time.sleep(0.3)

        self.assertLess(self._age(job), timedelta(seconds=5))

    def test_pulse_stops_after_the_block(self):
        job = self._job()

        with mock.patch.object(pulse, "_beat", wraps=pulse._beat) as beat:
            with job_pulse(job.pk, run_token="t", interval_seconds=INTERVAL):
                time.sleep(0.3)
            job.refresh_from_db()
            last_pulse = job.updated_at
            beats = beat.call_count
            time.sleep(0.3)

        job.refresh_from_db()
        self.assertGreater(beats, 0)
        self.assertEqual(beat.call_count, beats)
        self.assertEqual(job.updated_at, last_pulse)

    def test_pulse_ignores_a_superseded_run(self):
        job = self._job(celery_task_id="другой")
        before = job.updated_at

        with mock.patch.object(pulse, "_beat", wraps=pulse._beat) as beat:
            with job_pulse(job.pk, run_token="t", interval_seconds=INTERVAL):
                time.sleep(0.3)

        job.refresh_from_db()
        self.assertEqual(job.updated_at, before)
        # Запуск заменён: первый же удар ничего не обновил, и поток вышел.
        self.assertEqual(beat.call_count, 1)

    def test_pulse_survives_a_database_error(self):
        job = self._job()
        real_beat = pulse._beat
        calls = []

        def flaky(job_id, run_token):
            calls.append(run_token)
            if len(calls) == 1:
                raise OperationalError("connection lost")
            return real_beat(job_id, run_token)

        with mock.patch("curriculum.services.pulse._beat", side_effect=flaky):
            with self.assertLogs("curriculum.services.pulse", level="WARNING") as logs:
                with job_pulse(job.pk, run_token="t", interval_seconds=INTERVAL):
                    time.sleep(0.3)

        self.assertLess(self._age(job), timedelta(seconds=5))
        self.assertGreaterEqual(len(calls), 2)
        self.assertIn("connection lost", "\n".join(logs.output))

    def test_pulse_survives_an_interface_error(self):
        # `InterfaceError` — не подкласс `DatabaseError`, а сосед: соединение
        # закрыто под ногами. Это тоже ошибка базы, пульс не гаснет.
        job = self._job()
        real_beat = pulse._beat
        calls = []

        def flaky(job_id, run_token):
            calls.append(run_token)
            if len(calls) == 1:
                raise InterfaceError("connection already closed")
            return real_beat(job_id, run_token)

        with mock.patch("curriculum.services.pulse._beat", side_effect=flaky):
            with self.assertLogs("curriculum.services.pulse", level="WARNING") as logs:
                with job_pulse(job.pk, run_token="t", interval_seconds=INTERVAL):
                    time.sleep(0.3)

        self.assertLess(self._age(job), timedelta(seconds=5))
        self.assertGreaterEqual(len(calls), 2)
        self.assertIn("connection already closed", "\n".join(logs.output))

    def test_pulse_logs_an_unexpected_error_before_stopping(self):
        # Не ошибка базы: поток останавливается, но не молча, а с трейсбеком
        # в логе. Иначе книгу через пять минут сочтут зависшей без причины.
        broke = threading.Event()

        def broken(job_id, run_token):
            broke.set()
            raise RuntimeError("неожиданная поломка")

        with mock.patch.object(pulse, "_beat", side_effect=broken) as beat:
            with self.assertLogs("curriculum.services.pulse", level="ERROR") as logs:
                with job_pulse(uuid.uuid4(), run_token="t", interval_seconds=0.01):
                    self.assertTrue(broke.wait(5))
                    time.sleep(0.05)

        self.assertEqual(beat.call_count, 1)
        self.assertIn("неожиданная поломка", "\n".join(logs.output))
        self.assertIsNotNone(logs.records[-1].exc_info)

    def test_a_hung_pulse_does_not_hold_the_worker(self):
        # Удар повис на мёртвом соединении, а книга уже готова: воркер не
        # должен ждать его минутами.
        job_id = uuid.uuid4()
        beating = threading.Event()
        release = threading.Event()

        def hung(job_id, run_token):
            beating.set()
            release.wait(5)
            return 1

        with mock.patch.object(
            pulse, "_beat", side_effect=hung
        ) as beat, mock.patch.object(pulse, "JOIN_TIMEOUT_SECONDS", 0.2):
            with job_pulse(job_id, run_token="t", interval_seconds=0.01):
                # Блок кончается, только когда удар уже идёт.
                self.assertTrue(beating.wait(5))
                leaving = time.monotonic()
            waited = time.monotonic() - leaving
            release.set()
            for thread in threading.enumerate():
                if thread.name == f"ingest-pulse-{job_id}":
                    thread.join(5)

        self.assertLess(waited, 1.0)
        # Остановленный поток, дождавшись удара, больше не бьёт.
        self.assertEqual(beat.call_count, 1)


class PulseIntervalSettingTests(SimpleTestCase):
    def test_the_pulse_interval_is_clamped(self):
        clamp = project_settings._clamped_pulse_seconds
        self.assertEqual(clamp(60, 300), 60)
        # Ноль бил бы по строке джоба без паузы весь час.
        self.assertEqual(clamp(0, 300), 5)
        self.assertEqual(clamp(-1, 300), 5)
        # Пульс не реже порога делал бы любую живую книгу зависшей между ударами.
        self.assertEqual(clamp(300, 300), 100)
        self.assertEqual(clamp(60, 60), 20)
        self.assertEqual(settings.CURRICULUM_INGEST_PULSE_SECONDS, 60)
