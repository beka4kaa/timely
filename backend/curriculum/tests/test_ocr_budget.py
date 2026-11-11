"""Сканы: всё или ничего, с резервом на всю обработку (решения 13, 15, 17).

Распознавание сканов — единственное, за что обработка книги платит лимитом
ученика. До первой платной страницы резервируется цена всех сканов этой
обработки. Страницы расходуют этот резерв и сверх него не резервируют. Не
хватает — не распознаётся ни одна страница, а сводка у книги говорит почему.
"""

import os
import tempfile
import time
import uuid
from datetime import datetime
from types import SimpleNamespace
from unittest import mock, skipUnless

from celery.exceptions import SoftTimeLimitExceeded
from django.db import connection
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from ai_engine.models import AIUsageEvent, AIUsageQuotaState
from ai_engine.usage import (
    AIUsageLimitExceeded,
    build_usage_summary,
    provider_call_reservation,
    record_model_usage,
    reserve_usage_capacity,
    usage_scope,
)

from curriculum import storage as storage_module
from curriculum.models import (
    Document,
    DocumentFile,
    DocumentPage,
    IngestionJob,
    KnowledgeChunk,
)
from curriculum.ocr import (
    OCR_SYSTEM_PROMPT,
    OCR_USER_PROMPT,
    NullOcrProvider,
    OcrResult,
    VisionOcrProvider,
    get_ocr_provider,
)
from curriculum.services.ingestion import _ocr_time_is_up, ingest_document
from curriculum.tasks import TRANSIENT_ERROR_CODES
from curriculum.tests.pdf_fixtures import (
    SCAN,
    TEXTBOOK_PAGE_ONE,
    build_text_pdf,
    textbook_pdf,
)

EMAIL = "student@example.com"

ROOMY_LIMITS = {"free": {"five_hour": 100_000, "weekly": 100_000}}
TIGHT_LIMITS = {"free": {"five_hour": 10_000, "weekly": 10_000}}


def _ocr_reserves() -> list[dict]:
    """Живые резервы распознавания ученика в эту минуту."""
    state = AIUsageQuotaState.objects.filter(user_email=EMAIL).first()
    reservations = state.reservations if state is not None else {}
    return [
        claim
        for claim in reservations.values()
        if claim.get("feature") == "curriculum_ocr"
    ]


class BudgetOcr:
    """OCR без сети, который платит как настоящий.

    Страница стоит 900 токенов, но не меньше счёта картинки: в журнал уходит
    `max(900, 4000)`. Вызов идёт под своей бронью, как у `VisionOcrProvider`,
    поэтому видно, резервирует ли страница сверх резерва всех сканов.
    «Падает» значит возвращает неуспех, а не бросает исключение.
    """

    name = "budget-ocr"

    def __init__(self, fail_on_call: int | None = None):
        self.fail_on_call = fail_on_call
        self.calls = 0
        # Резервы распознавания в разгар каждого вызова и время вызова.
        self.reserves: list[list[dict]] = []
        self.called_at: list[float] = []

    def page_token_bound(self) -> int:
        return 4000

    def transcribe_page(self, png_bytes: bytes) -> OcrResult:
        self.calls += 1
        self.called_at.append(time.time())
        if self.calls == self.fail_on_call:
            self.reserves.append(_ocr_reserves())
            return OcrResult(text="", model="m", succeeded=False, error="boom")
        with usage_scope(feature="curriculum_ocr"), provider_call_reservation(
            input_payload={
                "system_prompt": OCR_SYSTEM_PROMPT,
                "user_prompt": OCR_USER_PROMPT,
            },
            max_output_tokens=3500,
            image_count=1,
            feature="curriculum_ocr",
        ):
            self.reserves.append(_ocr_reserves())
            record_model_usage(
                SimpleNamespace(usage={"total_tokens": 900}, id="o", model="m"),
                model="m",
                provider="p",
                image_count=1,
            )
        return OcrResult(
            text=f"Problem {self.calls}. Scanned page.\nSolution. x = {self.calls}.",
            model="m",
            succeeded=True,
        )


class _ScannedBookBase(TestCase):
    def setUp(self):
        storage_module.set_storage(
            storage_module.LocalFileStorage(tempfile.mkdtemp())
        )

    def _make_document(self, pdf: bytes, **kwargs) -> Document:
        document = Document.objects.create(
            user_email=EMAIL, title="Учебник", **kwargs
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

    def _reservations(self) -> dict:
        return AIUsageQuotaState.objects.get(user_email=EMAIL).reservations


@override_settings(AI_USAGE_ENFORCE_LIMITS=True, AI_PLAN_LIMITS=ROOMY_LIMITS)
class ScanReserveTests(_ScannedBookBase):
    def test_scans_are_recognized_when_the_reserve_fits(self):
        document = self._make_document(build_text_pdf([TEXTBOOK_PAGE_ONE, SCAN, SCAN]))
        provider = BudgetOcr()

        outcome = ingest_document(document, ocr_provider=provider)

        self.assertTrue(outcome.succeeded)
        self.assertEqual(provider.calls, 2)
        document.refresh_from_db()
        self.assertEqual(
            document.ocr_summary,
            {"scanned": 2, "attempted": 2, "recognized": 2, "skipped": ""},
        )
        self.assertEqual(outcome.ocr_summary, document.ocr_summary)
        recognized = DocumentPage.objects.filter(
            document=document, ocr_applied=True
        ).order_by("page_number")
        self.assertEqual(list(recognized.values_list("page_number", flat=True)), [2, 3])
        # Расход страниц записан ученику по счёту картинки, резервов не осталось.
        events = AIUsageEvent.objects.filter(user_email=EMAIL, metered=True)
        self.assertEqual(
            sorted(events.values_list("billable_tokens", flat=True)), [4000, 4000]
        )
        self.assertEqual(
            set(events.values_list("feature", flat=True)), {"curriculum_ocr"}
        )
        self.assertEqual(self._reservations(), {})

    @override_settings(AI_PLAN_LIMITS=TIGHT_LIMITS)
    def test_mixed_book_without_limit_is_ready_by_text_pages(self):
        # Review Focus 1: сканы вперемешку с текстом, а лимита на сканы нет.
        AIUsageEvent.objects.create(
            user_email=EMAIL,
            model_name="m",
            total_tokens=8000,
            billable_tokens=8000,
        )
        document = self._make_document(build_text_pdf([TEXTBOOK_PAGE_ONE, SCAN]))
        provider = BudgetOcr()

        outcome = ingest_document(document, ocr_provider=provider)

        # Книга готова по странице с текстом, скан не распознан.
        self.assertTrue(outcome.succeeded)
        self.assertEqual(provider.calls, 0)
        document.refresh_from_db()
        self.assertEqual(document.ingestion_status, Document.Status.READY)
        self.assertTrue(
            KnowledgeChunk.objects.filter(document_id=document.pk).exists()
        )
        self.assertFalse(
            DocumentPage.objects.get(document=document, page_number=2).ocr_applied
        )
        summary = document.ocr_summary
        self.assertEqual(
            (summary["scanned"], summary["attempted"], summary["recognized"]),
            (1, 0, 0),
        )
        self.assertEqual(summary["skipped"], "quota")
        self.assertEqual(summary["plan"], "free")
        # Время восстановления лимита: строка ISO в будущем.
        self.assertTrue(summary["reset_at"])
        reset_at = datetime.fromisoformat(summary["reset_at"].replace("Z", "+00:00"))
        self.assertGreater(reset_at, timezone.now())
        # Отказ ничего не держит и ничего не тратит.
        self.assertEqual(self._reservations(), {})
        self.assertEqual(AIUsageEvent.objects.filter(user_email=EMAIL).count(), 1)

    @override_settings(AI_PLAN_LIMITS=TIGHT_LIMITS)
    def test_all_or_nothing(self):
        # Три скана по 4000 = 12 000 не помещаются в окно 10 000 тарифа.
        document = self._make_document(
            build_text_pdf([TEXTBOOK_PAGE_ONE, SCAN, SCAN, SCAN])
        )
        provider = BudgetOcr()

        outcome = ingest_document(document, ocr_provider=provider)

        self.assertTrue(outcome.succeeded)
        self.assertEqual(provider.calls, 0)
        document.refresh_from_db()
        self.assertEqual(
            document.ocr_summary,
            {
                "scanned": 3,
                "attempted": 0,
                "recognized": 0,
                "skipped": "window",
                "plan": "free",
            },
        )
        self.assertFalse(AIUsageEvent.objects.filter(user_email=EMAIL).exists())

    @override_settings(AI_PLAN_LIMITS=TIGHT_LIMITS)
    def test_scan_only_book_without_limit_fails_with_ocr_quota(self):
        document = self._make_document(build_text_pdf([SCAN, SCAN, SCAN]))
        provider = BudgetOcr()

        with self.assertLogs("curriculum.services.ingestion", level="WARNING"):
            outcome = ingest_document(document, ocr_provider=provider)

        self.assertFalse(outcome.succeeded)
        self.assertEqual(provider.calls, 0)
        job = IngestionJob.objects.get(document=document)
        self.assertEqual(job.status, Document.Status.FAILED)
        self.assertEqual(job.error_code, "ocr_quota")
        self.assertEqual(
            job.error_message,
            "В книге одни сканы, а лимита на их распознавание не хватило. "
            "Файл сохранён.",
        )
        document.refresh_from_db()
        self.assertEqual(document.ingestion_status, Document.Status.FAILED)
        self.assertEqual(document.ocr_summary["skipped"], "window")
        # Файл на месте: книгу можно обработать заново, когда лимита хватит.
        self.assertTrue(
            storage_module.get_storage().exists(document.file.storage_key)
        )

    def test_more_scans_than_one_run_reports_the_cap(self):
        document = self._make_document(build_text_pdf([TEXTBOOK_PAGE_ONE, SCAN, SCAN]))
        provider = BudgetOcr()

        outcome = ingest_document(document, ocr_provider=provider, max_ocr_pages=1)

        self.assertEqual(provider.calls, 1)
        # Резерв только на то, что уходит в распознавание.
        self.assertEqual([claim["tokens"] for claim in provider.reserves[0]], [4000])
        document.refresh_from_db()
        self.assertEqual(document.ocr_summary["scanned"], 2)
        self.assertEqual(document.ocr_summary["attempted"], 1)
        self.assertEqual(document.ocr_summary["recognized"], 1)
        # Потолок — не остановка по времени: повтор тут не поможет и не нужен.
        self.assertNotIn("stopped", document.ocr_summary)
        # Потолок виден в сводке, прежнего предупреждения больше нет.
        self.assertFalse(
            [code for code in outcome.warnings if code.startswith("ocr_limited")]
        )

    def test_a_failed_page_keeps_the_recognized_ones(self):
        document = self._make_document(
            build_text_pdf([TEXTBOOK_PAGE_ONE, SCAN, SCAN, SCAN])
        )
        provider = BudgetOcr(fail_on_call=2)

        outcome = ingest_document(document, ocr_provider=provider)

        self.assertTrue(outcome.succeeded)
        self.assertEqual(provider.calls, 3)
        document.refresh_from_db()
        self.assertEqual(document.ocr_summary["scanned"], 3)
        self.assertEqual(document.ocr_summary["attempted"], 3)
        self.assertEqual(document.ocr_summary["recognized"], 2)
        self.assertEqual(document.ocr_summary["skipped"], "")
        # Недорасход резерва (12 000 − 8000) снят вместе с резервом.
        self.assertEqual(self._reservations(), {})

    @override_settings(AI_PLAN_LIMITS=TIGHT_LIMITS)
    def test_parallel_chat_cannot_eat_the_ocr_reserve(self):
        chat_denied = []

        class ChatDuringOcr(BudgetOcr):
            def transcribe_page(self, png_bytes):
                if self.calls == 0:
                    # Параллельный запрос ученика посреди распознавания.
                    try:
                        reserve_usage_capacity(EMAIL, reserved_tokens=3000)
                    except AIUsageLimitExceeded:
                        chat_denied.append(True)
                return super().transcribe_page(png_bytes)

        document = self._make_document(build_text_pdf([TEXTBOOK_PAGE_ONE, SCAN, SCAN]))
        provider = ChatDuringOcr()

        outcome = ingest_document(document, ocr_provider=provider)

        self.assertEqual(chat_denied, [True])
        self.assertTrue(outcome.succeeded)
        document.refresh_from_db()
        self.assertEqual(document.ocr_summary["recognized"], 2)
        self.assertEqual(self._reservations(), {})

    def test_pages_draw_down_the_ocr_reserve(self):
        document = self._make_document(build_text_pdf([TEXTBOOK_PAGE_ONE, SCAN, SCAN]))
        provider = BudgetOcr()

        ingest_document(document, ocr_provider=provider)

        self.assertEqual(provider.calls, 2)
        first, second = (
            [claim["tokens"] for claim in seen] for seen in provider.reserves
        )
        self.assertEqual(first, [8000])
        # Первая страница списала свои 4000, вторая брони сверх резерва не взяла.
        self.assertEqual(second, [4000])

    @override_settings(CELERY_TASK_SOFT_TIME_LIMIT=1000)
    def test_the_ocr_reserve_expires_soon_after_the_last_possible_page(self):
        document = self._make_document(build_text_pdf([TEXTBOOK_PAGE_ONE, SCAN]))
        provider = BudgetOcr()

        before = time.time()
        with mock.patch.dict(os.environ, {"OCR_MODEL": "m", "OCR_TIMEOUT": "90"}):
            ingest_document(document, ocr_provider=provider)

        # Новых страниц нет после 1000 / 2 = 500 с, последняя идёт не дольше
        # таймаута страницы (90 с), и ещё 120 с запаса. Резерв взят между
        # `before` и первой страницей; секунда допуска — на округление часов.
        ttl = 500 + 90 + 120
        (reserve,) = provider.reserves[0]
        self.assertGreaterEqual(reserve["expires_at"], before + ttl - 1)
        self.assertLessEqual(reserve["expires_at"], provider.called_at[0] + ttl + 1)

    def test_ocr_stops_starting_pages_when_its_time_is_up(self):
        document = self._make_document(
            build_text_pdf([TEXTBOOK_PAGE_ONE, SCAN, SCAN, SCAN])
        )
        provider = BudgetOcr()

        with mock.patch(
            "curriculum.services.ingestion._ocr_time_is_up",
            side_effect=[False, True],
        ), self.assertLogs("curriculum.services.ingestion", level="WARNING") as logs:
            outcome = ingest_document(document, ocr_provider=provider)

        self.assertTrue(outcome.succeeded)
        self.assertEqual(provider.calls, 1)
        document.refresh_from_db()
        self.assertEqual(document.ingestion_status, Document.Status.READY)
        self.assertEqual(document.ocr_summary["scanned"], 3)
        self.assertEqual(document.ocr_summary["attempted"], 3)
        self.assertEqual(document.ocr_summary["recognized"], 1)
        self.assertEqual(document.ocr_summary["skipped"], "")
        # Признак для фронта: повтор оборвался бы на той же странице.
        self.assertEqual(document.ocr_summary["stopped"], "time")
        self.assertEqual(self._reservations(), {})
        self.assertIn(str(document.pk), "\n".join(logs.output))

    def test_time_limit_mid_ocr_releases_the_reserve(self):
        class TimeLimitedOcr(BudgetOcr):
            def transcribe_page(self, png_bytes):
                if self.calls == 1:
                    self.calls += 1
                    raise SoftTimeLimitExceeded()
                return super().transcribe_page(png_bytes)

        document = self._make_document(
            build_text_pdf([TEXTBOOK_PAGE_ONE, SCAN, SCAN, SCAN])
        )
        provider = TimeLimitedOcr()

        with self.assertLogs("curriculum.services.ingestion", level="WARNING"):
            outcome = ingest_document(document, ocr_provider=provider)

        self.assertFalse(outcome.succeeded)
        self.assertEqual(provider.calls, 2)
        self.assertEqual(outcome.job.error_code, "timed_out")
        # Предел ушёл наверх, а остаток резерва (12 000 − 4000) снят.
        self.assertEqual(self._reservations(), {})

    def test_text_poor_pages_without_a_scan_image_cost_nothing(self):
        # Решение 12: пустой оборот и титул главы бедны текстом, но это не сканы.
        document = self._make_document(
            build_text_pdf([TEXTBOOK_PAGE_ONE, "", "Chapter 2. Dynamics", SCAN])
        )
        provider = BudgetOcr()

        ingest_document(document, ocr_provider=provider)

        self.assertEqual(provider.calls, 1)
        self.assertEqual([claim["tokens"] for claim in provider.reserves[0]], [4000])
        document.refresh_from_db()
        self.assertEqual(document.ocr_summary["scanned"], 1)
        self.assertEqual(document.ocr_summary["recognized"], 1)
        scans = DocumentPage.objects.filter(document=document, needs_ocr=True)
        self.assertEqual(list(scans.values_list("page_number", flat=True)), [4])

    @override_settings(
        AI_PLAN_LIMITS={"free": {"five_hour": 150_000, "weekly": 500_000}}
    )
    def test_when_only_a_live_claim_blocks_the_wait_ends_with_it(self):
        # Окно пустое, а вызов чата держит бронь 5000 на 10 минут. 37 сканов
        # (148 000) рядом с ней не помещаются, без неё поместились бы.
        claim = reserve_usage_capacity(
            EMAIL, reserved_tokens=5000, feature="chat", ttl_seconds=600
        )
        claim_expires_at = self._reservations()[claim.key]["expires_at"]
        document = self._make_document(
            build_text_pdf([TEXTBOOK_PAGE_ONE] + [SCAN] * 37)
        )
        provider = BudgetOcr()

        ingest_document(document, ocr_provider=provider)

        self.assertEqual(provider.calls, 0)
        document.refresh_from_db()
        self.assertEqual(document.ocr_summary["skipped"], "quota")
        reset_at = datetime.fromisoformat(
            document.ocr_summary["reset_at"].replace("Z", "+00:00")
        )
        # Лимит освободится вместе с бронью, а не со сбросом окна через 5 часов.
        self.assertAlmostEqual(reset_at.timestamp(), claim_expires_at, delta=1)

    @override_settings(AI_PLAN_LIMITS={"free": {"five_hour": 8000, "weekly": 8000}})
    def test_a_book_that_exactly_fills_the_window_waits_for_quota(self):
        # Два скана — ровно окно тарифа: «window» только для суммы больше окна.
        AIUsageEvent.objects.create(
            user_email=EMAIL, model_name="m", total_tokens=1, billable_tokens=1
        )
        document = self._make_document(
            build_text_pdf([TEXTBOOK_PAGE_ONE, SCAN, SCAN])
        )
        provider = BudgetOcr()

        ingest_document(document, ocr_provider=provider)

        self.assertEqual(provider.calls, 0)
        document.refresh_from_db()
        self.assertEqual(document.ocr_summary["skipped"], "quota")
        # Мешает расход, а не бронь: время — сброс окна.
        windows = build_usage_summary(EMAIL)["windows"]
        self.assertIn(
            document.ocr_summary["reset_at"],
            {windows["five_hour"]["reset_at"], windows["weekly"]["reset_at"]},
        )

    def test_scan_book_whose_pages_all_failed_reports_ocr_failed(self):
        class DeadOcr(BudgetOcr):
            def transcribe_page(self, png_bytes):
                self.calls += 1
                return OcrResult(text="", model="m", succeeded=False, error="timeout")

        document = self._make_document(build_text_pdf([SCAN, SCAN]))
        provider = DeadOcr()

        with self.assertLogs("curriculum.services.ingestion", level="WARNING"):
            outcome = ingest_document(document, ocr_provider=provider)

        self.assertFalse(outcome.succeeded)
        self.assertEqual(provider.calls, 2)
        job = IngestionJob.objects.get(document=document)
        self.assertEqual(job.status, Document.Status.FAILED)
        self.assertEqual(job.error_code, "ocr_failed")
        self.assertEqual(
            job.error_message,
            "Сканы не распознались: сервис распознавания не ответил. "
            "Попробуй ещё раз позже.",
        )
        document.refresh_from_db()
        self.assertEqual(document.ocr_summary["attempted"], 2)
        self.assertEqual(document.ocr_summary["recognized"], 0)
        # Сам воркер обработку не повторяет: повтор снова оплатил бы страницы.
        self.assertNotIn("ocr_failed", TRANSIENT_ERROR_CODES)

    @override_settings(CURRICULUM_OCR_PAGE_IMAGE_TOKENS=2500)
    def test_a_page_call_outside_the_book_reserve_claims_the_page_bound(self):
        with mock.patch.dict(os.environ, {"OCR_MODEL": "m"}):
            provider = get_ocr_provider()
        claimed = []

        def call(**kwargs):
            claimed.extend(claim["tokens"] for claim in _ocr_reserves())
            return "text"

        with usage_scope(user_email=EMAIL), mock.patch(
            "ai_engine.glm_client.glm_chat_image", side_effect=call
        ):
            provider.transcribe_page(b"png")

        self.assertEqual(claimed, [provider.page_token_bound()])

    def test_superseded_run_does_not_write_the_ocr_summary(self):
        document = self._make_document(
            textbook_pdf(), ingestion_status=Document.Status.QUEUED
        )
        job = IngestionJob.objects.create(
            document=document,
            user_email=EMAIL,
            status=Document.Status.QUEUED,
            celery_task_id="old-run",
        )

        def pipeline(document, job, recorder, outcome, **kwargs):
            outcome.ocr_summary = {
                "scanned": 1,
                "attempted": 0,
                "recognized": 0,
                "skipped": "quota",
                "reset_at": "2026-11-10T18:40:00Z",
                "plan": "free",
            }
            IngestionJob.objects.filter(pk=job.pk).update(celery_task_id="new-run")

        with mock.patch(
            "curriculum.services.ingestion._run_pipeline", side_effect=pipeline
        ):
            outcome = ingest_document(
                document, run_token="old-run", ocr_provider=NullOcrProvider()
            )

        self.assertIs(outcome.claimed, False)
        document.refresh_from_db()
        self.assertEqual(document.ocr_summary, {})


class PageBoundTests(SimpleTestCase):
    def test_book_page_bound_is_4000(self):
        with mock.patch.dict(os.environ, {"OCR_MODEL": "m"}):
            provider = get_ocr_provider()

        self.assertIsInstance(provider, VisionOcrProvider)
        self.assertEqual(provider.max_tokens, 3500)
        self.assertEqual(provider.page_token_bound(), 4000)

    @override_settings(CURRICULUM_OCR_PAGE_IMAGE_TOKENS=2500)
    def test_page_image_allowance_raises_the_bound(self):
        with mock.patch.dict(os.environ, {"OCR_MODEL": "m"}):
            provider = get_ocr_provider()

        # Вход 485 (два промпта: 183 токена × 1,25 с округлением вверх и 256
        # запаса), картинка 2500, потолок ответа 3500.
        self.assertEqual(provider.page_token_bound(), 485 + 2500 + 3500)
        self.assertGreater(provider.page_token_bound(), 4000)

    def test_unconfigured_ocr_has_nothing_to_reserve(self):
        self.assertEqual(NullOcrProvider().page_token_bound(), 0)


class OcrDeadlineTests(SimpleTestCase):
    @override_settings(CELERY_TASK_SOFT_TIME_LIMIT=3540)
    def test_no_new_page_after_half_of_the_soft_limit(self):
        with mock.patch(
            "curriculum.services.ingestion.time.monotonic", return_value=1769.0
        ):
            self.assertFalse(_ocr_time_is_up(0.0))
        with mock.patch(
            "curriculum.services.ingestion.time.monotonic", return_value=1770.0
        ):
            self.assertTrue(_ocr_time_is_up(0.0))


@skipUnless(connection.vendor == "postgresql", "нужен Postgres")
class OcrSummaryColumnDefaultTests(TestCase):
    """Миграцию применяет новый веб-контейнер, пока старый ещё создаёт книги."""

    def test_old_code_insert_without_ocr_summary_gets_an_empty_summary(self):
        # Ровно те колонки, что пишет ORM старого кода: о сводке он не знает.
        document_id = uuid.uuid4()
        table = connection.ops.quote_name(Document._meta.db_table)
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                INSERT INTO {table} (
                    id, created_at, updated_at, user_email, title, authors,
                    language, document_type, source_type, page_count,
                    ingestion_status, processing_version, visibility,
                    copyright_declaration
                ) VALUES (
                    %s, now(), now(), %s, 'Учебник', '[]',
                    'ru', 'textbook', 'upload', 0,
                    'uploaded', '1.4.0', 'private', ''
                )
                """,
                [str(document_id), EMAIL],
            )

        document = Document.objects.get(pk=document_id)
        self.assertEqual(document.ocr_summary, {})
