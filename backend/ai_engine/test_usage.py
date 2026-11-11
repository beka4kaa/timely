import contextvars
import importlib
import queue
import threading
import json
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone as dt_timezone
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import patch

from celery.exceptions import SoftTimeLimitExceeded
from django.apps import apps as django_apps
from django.db import (
    InterfaceError,
    OperationalError,
    close_old_connections,
    connection,
    migrations,
)
from django.http import JsonResponse
from django.test import (
    RequestFactory,
    SimpleTestCase,
    TestCase,
    TransactionTestCase,
    override_settings,
    skipUnlessDBFeature,
)

from django.conf import settings
from django.utils import timezone

from . import usage as usage_module
from .middleware import AIUsageContextMiddleware, _is_metered_request
from .models import AIUsageEvent, AIUsageQuotaState

from .usage import (
    AIUsageLimitExceeded,
    UsageReservation,
    available_usage_tokens,
    build_usage_summary,
    empty_usage_summary,
    ensure_usage_available,
    estimate_tokens,
    extract_usage,
    prepaid_usage,
    provider_call_reservation,
    provider_call_token_estimate,
    provider_call_token_upper_bound,
    provider_from_base_url,
    record_model_usage,
    release_usage_reservation,
    reservations_block_until,
    reserve_usage_capacity,
    resolve_usage_plan,
    usage_reservation,
    usage_scope,
    usage_window_limit,
    _plan_profile,
)


TINY_PLAN_LIMITS = {
    "free": {
        "context": 100,
        "five_hour": 10,
        "weekly": 10,
    }
}
EMAIL = "student@example.com"


class UsageExtractionTests(SimpleTestCase):
    def test_extracts_openai_compatible_usage_details(self) -> None:
        response = SimpleNamespace(
            usage=SimpleNamespace(
                prompt_tokens=120,
                completion_tokens=30,
                total_tokens=150,
                cost=0.0042,
                prompt_tokens_details=SimpleNamespace(cached_tokens=40),
                completion_tokens_details=SimpleNamespace(reasoning_tokens=12),
            ),
            choices=[],
        )

        usage = extract_usage(response)

        self.assertEqual(usage.input_tokens, 120)
        self.assertEqual(usage.cached_input_tokens, 40)
        self.assertEqual(usage.output_tokens, 30)
        self.assertEqual(usage.reasoning_tokens, 12)
        self.assertEqual(usage.total_tokens, 150)
        self.assertFalse(usage.estimated)

    def test_estimate_does_not_count_base64_image_data(self) -> None:
        payload = {
            "messages": [
                {
                    "content": [
                        {"type": "text", "text": "Explain the diagram"},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": "data:image/png;base64," + ("A" * 100_000)
                            },
                        },
                    ]
                }
            ]
        }

        self.assertLess(estimate_tokens(payload), 30)

    def test_missing_provider_usage_uses_stable_estimate(self) -> None:
        response = {
            "choices": [{"message": {"content": "Short answer"}}],
        }

        usage = extract_usage(response, input_payload="Short question")

        self.assertGreater(usage.input_tokens, 0)
        self.assertGreater(usage.output_tokens, 0)
        self.assertEqual(
            usage.total_tokens,
            usage.input_tokens + usage.output_tokens,
        )
        self.assertTrue(usage.estimated)

    @override_settings(AI_IMAGE_TOKEN_CHARGE=4000)
    def test_provider_call_upper_bound_matches_image_billing_formula(self) -> None:
        bound = provider_call_token_upper_bound(
            {"prompt": "Привет"},
            max_output_tokens=700,
            image_count=1,
        )

        self.assertEqual(bound, 4000)

    @override_settings(AI_IMAGE_TOKEN_CHARGE=4000)
    def test_image_input_tokens_add_to_the_input_under_the_image_floor(self) -> None:
        text = provider_call_token_upper_bound({"prompt": "Привет"})
        # Ниже счёта картинки граница по-прежнему равна ему.
        self.assertEqual(
            provider_call_token_upper_bound(
                {"prompt": "Привет"},
                max_output_tokens=700,
                image_count=1,
                image_input_tokens=1000,
            ),
            4000,
        )
        # Выше — вход текста, токены каждой картинки и потолок ответа.
        self.assertEqual(
            provider_call_token_upper_bound(
                {"prompt": "Привет"},
                max_output_tokens=700,
                image_count=2,
                image_input_tokens=4000,
            ),
            text + 2 * 4000 + 700,
        )

    def test_call_estimate_caps_the_output_at_3000(self) -> None:
        bound = provider_call_token_upper_bound("x")
        self.assertEqual(provider_call_token_estimate("x", max_output_tokens=8000), bound + 3000)
        self.assertEqual(provider_call_token_estimate("x", max_output_tokens=500), bound + 500)

    def test_normal_cyrillic_embedding_batch_does_not_get_false_free_denial(
        self,
    ) -> None:
        chunk = "Это обычный фрагмент русского учебника по механике. " * 6
        bound = provider_call_token_upper_bound([chunk] * 64)

        self.assertGreater(bound, 1)
        self.assertLess(bound, 25_000)


class UsageLedgerTests(SimpleTestCase):
    @override_settings(AI_IMAGE_TOKEN_CHARGE=4000)
    @patch("ai_engine.usage.AIUsageEvent.objects.create")
    def test_image_call_gets_internal_token_charge(self, create) -> None:
        create.return_value = object()
        with usage_scope(user_email="student@example.com", feature="illustration"):
            record_model_usage(
                {"id": "request-1", "usage": {}},
                model="bytedance-seed/seedream-4.5",
                provider="openrouter",
                feature="image_generation",
                input_payload="Draw one block",
                image_count=1,
            )

        fields = create.call_args.kwargs
        self.assertEqual(fields["user_email"], "student@example.com")
        self.assertEqual(fields["image_count"], 1)
        self.assertEqual(fields["billable_tokens"], 4000)
        self.assertEqual(fields["feature"], "image_generation")

    def test_fail_open_accounting_does_not_swallow_the_time_limit(self) -> None:
        # Запись расхода не роняет ответ модели, но предел часа воркера —
        # не сбой учёта: его глушить нельзя, ни прямой, ни обёрнутый базой.
        wrapped = OperationalError("connection lost")
        wrapped.__cause__ = SoftTimeLimitExceeded()
        for error in (SoftTimeLimitExceeded(), wrapped):
            with self.subTest(error=type(error).__name__):
                with usage_scope(user_email=EMAIL), patch(
                    "ai_engine.usage.AIUsageEvent.objects.create",
                    side_effect=error,
                ), self.assertRaises(SoftTimeLimitExceeded):
                    record_model_usage(
                        SimpleNamespace(usage={"total_tokens": 300}, id="r", model="m"),
                        model="m",
                        provider="p",
                    )

    @patch("ai_engine.usage.AIUsageEvent.objects.create")
    def test_anonymous_calls_are_not_persisted_by_default(self, create) -> None:
        record_model_usage(
            {"usage": {"total_tokens": 10}},
            model="model",
            provider="local",
        )
        create.assert_not_called()

    def test_empty_summary_has_all_three_limits(self) -> None:
        summary = empty_usage_summary(user_email="student@example.com")

        self.assertIn("context", summary)
        self.assertIn("five_hour", summary["windows"])
        self.assertIn("weekly", summary["windows"])
        self.assertEqual(summary["plan"]["id"], "free")
        self.assertEqual(len(summary["daily"]), 7)

    @patch("accounts.models.CustomUser.objects.filter")
    def test_admin_is_granted_bounded_max_plan(self, filter_users) -> None:
        filter_users.return_value.only.return_value.first.return_value = (
            SimpleNamespace(ai_plan="free", is_staff=True, is_superuser=False)
        )

        plan = resolve_usage_plan("admin@example.com")

        self.assertEqual(plan["id"], "max")
        self.assertTrue(plan["is_admin_grant"])
        self.assertGreater(plan["limits"]["weekly"], 0)

    @patch("accounts.models.CustomUser.objects.filter")
    def test_non_admin_uses_stored_plan(self, filter_users) -> None:
        filter_users.return_value.only.return_value.first.return_value = (
            SimpleNamespace(ai_plan="pro", is_staff=False, is_superuser=False)
        )

        plan = resolve_usage_plan("student@example.com")

        self.assertEqual(plan["id"], "pro")
        self.assertFalse(plan["is_admin_grant"])

    @override_settings(AI_USAGE_ENFORCE_LIMITS=True)
    @patch("ai_engine.usage._read_live_reservations", return_value={})
    @patch("ai_engine.usage.build_usage_summary")
    def test_limit_enforcement_returns_machine_readable_window(
        self, build, _reservations
    ) -> None:
        build.return_value = {
            "windows": {
                "five_hour": {
                    "used": 10,
                    "limit": 10,
                    "reset_at": "2026-07-27T12:00:00Z",
                },
                "weekly": {
                    "used": 10,
                    "limit": 100,
                    "reset_at": "2026-08-03T00:00:00Z",
                },
            }
        }

        with self.assertRaises(AIUsageLimitExceeded) as raised:
            ensure_usage_available("student@example.com")

        self.assertEqual(raised.exception.window, "five_hour")
        self.assertEqual(
            raised.exception.as_payload()["code"],
            "ai_usage_limit_exceeded",
        )

    @override_settings(AI_USAGE_ENFORCE_LIMITS=True)
    @patch("ai_engine.usage._read_live_reservations", return_value={})
    @patch("ai_engine.usage.build_usage_summary")
    def test_precheck_names_the_window_that_frees_up_last(
        self, build, _reservations
    ) -> None:
        # Исчерпаны оба окна: ученик ждёт того, что освободится позже.
        cases = (
            # Обычно дольше держит неделя.
            ("2026-08-02T20:00:00Z", "2026-08-03T00:00:00Z", "weekly"),
            # В ночь на понедельник неделя освобождается раньше.
            ("2026-08-03T02:00:00Z", "2026-08-03T00:00:00Z", "five_hour"),
        )
        for five_reset, weekly_reset, expected in cases:
            with self.subTest(expected=expected):
                build.return_value = {
                    "windows": {
                        "five_hour": {"used": 10, "limit": 10, "reset_at": five_reset},
                        "weekly": {"used": 100, "limit": 100, "reset_at": weekly_reset},
                    }
                }

                with self.assertRaises(AIUsageLimitExceeded) as raised:
                    ensure_usage_available("student@example.com")

                resets = {"five_hour": five_reset, "weekly": weekly_reset}
                self.assertEqual(raised.exception.window, expected)
                self.assertEqual(raised.exception.reset_at, resets[expected])

    def test_provider_is_derived_without_exposing_credentials(self) -> None:
        self.assertEqual(
            provider_from_base_url("https://openrouter.ai/api/v1"),
            "openrouter",
        )
        self.assertEqual(provider_from_base_url("http://localhost:8080/v1"), "local")


@override_settings(
    AI_USAGE_ENFORCE_LIMITS=True,
    AI_PLAN_LIMITS=TINY_PLAN_LIMITS,
)
class UsageReservationTests(TestCase):
    @override_settings(AI_USAGE_ENFORCE_LIMITS=False)
    @patch("ai_engine.usage.AIUsageQuotaState.objects.get_or_create")
    def test_disabled_enforcement_does_not_touch_reservation_storage(
        self,
        create,
    ) -> None:
        reservation = reserve_usage_capacity(
            "student@example.com",
            reserved_tokens=6,
            feature="curriculum_ingestion",
        )

        self.assertFalse(reservation.active)
        create.assert_not_called()

    def test_competing_reservations_cannot_overbook_and_release_restores_capacity(
        self,
    ) -> None:
        first = reserve_usage_capacity(
            "student@example.com",
            reserved_tokens=6,
            feature="curriculum_ingestion",
        )

        with self.assertRaises(AIUsageLimitExceeded):
            reserve_usage_capacity(
                "student@example.com",
                reserved_tokens=5,
                feature="curriculum_ingestion",
            )

        release_usage_reservation(first)
        second = reserve_usage_capacity(
            "student@example.com",
            reserved_tokens=5,
            feature="curriculum_ingestion",
        )
        release_usage_reservation(second)

        state = AIUsageQuotaState.objects.get(user_email="student@example.com")
        self.assertEqual(state.reservations, {})

    def test_actual_usage_and_live_reservations_share_the_same_limit(self) -> None:
        AIUsageEvent.objects.create(
            user_email="student@example.com",
            provider="openrouter",
            model_name="test-model",
            feature="curriculum_ingestion",
            total_tokens=5,
            billable_tokens=5,
        )

        with self.assertRaises(AIUsageLimitExceeded):
            reserve_usage_capacity(
                "student@example.com",
                reserved_tokens=6,
                feature="curriculum_ingestion",
            )

    def test_admission_gate_does_not_double_count_its_provider_call_budget(
        self,
    ) -> None:
        admission = reserve_usage_capacity(
            "student@example.com",
            reserved_tokens=6,
            feature="curriculum_ingestion",
            reservation_kind="admission",
        )
        capacity = reserve_usage_capacity(
            "student@example.com",
            reserved_tokens=10,
            feature="curriculum_embedding",
        )

        with self.assertRaises(AIUsageLimitExceeded):
            reserve_usage_capacity(
                "student@example.com",
                reserved_tokens=1,
                feature="curriculum_ingestion",
                reservation_kind="admission",
            )

        release_usage_reservation(capacity)
        release_usage_reservation(admission)

    def test_provider_call_reservation_uses_scope_and_releases_after_recording(
        self,
    ) -> None:
        with usage_scope(user_email="student@example.com"):
            with provider_call_reservation(
                input_payload="",
                max_output_tokens=1,
                feature="curriculum_embedding",
            ) as reservation:
                state = AIUsageQuotaState.objects.get(
                    user_email="student@example.com"
                )
                self.assertIn(reservation.key, state.reservations)
                self.assertEqual(
                    state.reservations[reservation.key]["kind"],
                    "capacity",
                )

        state.refresh_from_db()
        self.assertEqual(state.reservations, {})

    def test_a_call_claim_expires_with_the_call_ttl(self) -> None:
        def claim_lifetime() -> float:
            started = timezone.now().timestamp()
            with usage_scope(user_email="student@example.com"):
                with provider_call_reservation(input_payload="", max_output_tokens=1) as call:
                    claim = AIUsageQuotaState.objects.get(
                        user_email="student@example.com"
                    ).reservations[call.key]
            return claim["expires_at"] - started

        # Бронь вызова, оборванного выкладкой или таймаутом gunicorn (360 с),
        # держит окно ученика, а с ним и чат, 10 минут, а не 65.
        self.assertAlmostEqual(claim_lifetime(), 600, delta=5)
        # 120, а не меньше: reserve_usage_capacity не даёт сроку быть короче 60 с.
        with self.settings(AI_USAGE_CALL_RESERVATION_TTL_SECONDS=120):
            self.assertAlmostEqual(claim_lifetime(), 120, delta=5)

        # Резервы работ (сканы, программа) живут по своему сроку, как раньше.
        started = timezone.now().timestamp()
        job = reserve_usage_capacity("student@example.com", reserved_tokens=1)
        expires_at = AIUsageQuotaState.objects.get(
            user_email="student@example.com"
        ).reservations[job.key]["expires_at"]
        self.assertAlmostEqual(
            expires_at - started, settings.AI_USAGE_RESERVATION_TTL_SECONDS, delta=5
        )

    def test_expired_worker_claim_is_pruned(self) -> None:
        AIUsageQuotaState.objects.create(
            user_email="student@example.com",
            reservations={
                "dead-worker": {
                    "tokens": 10,
                    "expires_at": 1,
                    "feature": "curriculum_ingestion",
                }
            },
        )

        reservation = reserve_usage_capacity(
            "student@example.com",
            reserved_tokens=10,
            feature="curriculum_ingestion",
        )
        state = AIUsageQuotaState.objects.get(user_email="student@example.com")

        self.assertEqual(set(state.reservations), {reservation.key})
        release_usage_reservation(reservation)

    def test_context_manager_releases_after_error(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "boom"):
            with usage_reservation(
                "student@example.com",
                reserved_tokens=6,
                feature="curriculum_ingestion",
            ):
                raise RuntimeError("boom")

        state = AIUsageQuotaState.objects.get(user_email="student@example.com")
        self.assertEqual(state.reservations, {})

    @override_settings(
        AI_PLAN_LIMITS={"free": {"context": 100, "five_hour": 150_000, "weekly": 500_000}},
    )
    def test_a_refusal_names_the_short_window_that_frees_up_last(self) -> None:
        now = datetime(2026, 11, 11, 12, 0, tzinfo=dt_timezone.utc)  # среда
        for tokens, hours_ago in ((100_000, 1), (300_000, 6)):
            event = AIUsageEvent.objects.create(
                user_email=EMAIL, model_name="m", total_tokens=tokens, billable_tokens=tokens
            )
            AIUsageEvent.objects.filter(pk=event.pk).update(
                created_at=now - timedelta(hours=hours_ago)
            )
        # Потрачено: за 5 часов 100 000 из 150 000, за неделю 400 000 из 500 000.

        # Не хватает обоих окон: через 5 часов работу всё ещё держит неделя.
        with self.assertRaises(AIUsageLimitExceeded) as both:
            reserve_usage_capacity(EMAIL, reserved_tokens=120_000, now=now)
        self.assertEqual(both.exception.window, "weekly")
        self.assertEqual(both.exception.reset_at, "2026-11-16T00:00:00Z")

        # Не хватает только 5 часов: показываем его время.
        with self.assertRaises(AIUsageLimitExceeded) as five:
            reserve_usage_capacity(EMAIL, reserved_tokens=60_000, now=now)
        self.assertEqual(five.exception.window, "five_hour")
        self.assertEqual(five.exception.reset_at, "2026-11-11T16:00:00Z")


@override_settings(
    AI_USAGE_ENFORCE_LIMITS=True,
    AI_PLAN_LIMITS={"free": {"context": 1000, "five_hour": 1000, "weekly": 1000}},
)
class UnmeteredUsageTests(TestCase):
    """Немеренный расход записан, но в лимит ученика не входит (решение 12)."""

    def test_unmetered_calls_stay_out_of_the_windows(self) -> None:
        AIUsageEvent.objects.create(
            user_email=EMAIL,
            model_name="emb",
            feature="curriculum_embedding",
            total_tokens=90_000,
            billable_tokens=90_000,
            metered=False,
        )
        AIUsageEvent.objects.create(
            user_email=EMAIL,
            model_name="m",
            feature="chat",
            total_tokens=300,
            billable_tokens=300,
        )

        summary = build_usage_summary(EMAIL)

        self.assertEqual(summary["windows"]["five_hour"]["used"], 300)
        self.assertEqual(summary["totals"]["billable_tokens"], 300)
        reserve_usage_capacity(EMAIL, reserved_tokens=600)  # не бросает

    def test_unmetered_only_account_summary_is_empty(self) -> None:
        AIUsageEvent.objects.create(
            user_email=EMAIL,
            model_name="emb",
            feature="curriculum_embedding",
            input_tokens=90_000,
            total_tokens=90_000,
            billable_tokens=90_000,
            metered=False,
        )
        now = timezone.now()

        summary = build_usage_summary(EMAIL, now=now)

        # Ни окон, ни итогов, ни моделей, ни функций, ни дней, ни контекста.
        self.assertEqual(
            summary,
            empty_usage_summary(
                user_email=EMAIL,
                now=now,
                plan=resolve_usage_plan(EMAIL),
            ),
        )


@override_settings(
    AI_USAGE_ENFORCE_LIMITS=True,
    AI_PLAN_LIMITS={"free": {"context": 2000, "five_hour": 2000, "weekly": 2000}},
)
class PrepaidUsageTests(TestCase):
    """Резерв, оплаченный заранее за всю обработку (решения 13, 14).

    Вызовы его ученика внутри блока тратят его и сверх него не резервируют.
    Чужие запросы его не тратят, а их предпроверка его учитывает.
    """

    def test_calls_inside_a_prepaid_scope_do_not_reserve_again(self):
        prepaid = reserve_usage_capacity(EMAIL, reserved_tokens=1000)
        with usage_scope(user_email=EMAIL), prepaid_usage(prepaid):
            # Как настоящий провайдер: свой usage_scope(feature=...) внутри предоплаты.
            with usage_scope(feature="curriculum_ocr"):
                with provider_call_reservation(input_payload="x", max_output_tokens=500) as call:
                    self.assertEqual(call, prepaid)
                    self.assertEqual(
                        list(AIUsageQuotaState.objects.get(user_email=EMAIL).reservations),
                        [prepaid.key],
                    )
        self.assertEqual(
            list(AIUsageQuotaState.objects.get(user_email=EMAIL).reservations),
            [prepaid.key],
        )

    def test_recorded_calls_draw_down_the_prepaid_reserve(self):
        prepaid = reserve_usage_capacity(EMAIL, reserved_tokens=1000)
        with usage_scope(user_email=EMAIL), prepaid_usage(prepaid):
            record_model_usage(
                SimpleNamespace(usage={"total_tokens": 300}, id="r", model="m"),
                model="m",
                provider="p",
            )
        self.assertEqual(
            AIUsageQuotaState.objects.get(user_email=EMAIL).reservations[prepaid.key]["tokens"],
            700,
        )

    def test_overrun_does_not_stop_prepaid_calls(self):
        prepaid = reserve_usage_capacity(EMAIL, reserved_tokens=100)
        with usage_scope(user_email=EMAIL), prepaid_usage(prepaid):
            record_model_usage(
                SimpleNamespace(usage={"total_tokens": 1900}, id="r", model="m"),
                model="m",
                provider="p",
            )
            with provider_call_reservation(input_payload="x", max_output_tokens=500):
                pass  # окно почти выбрано, но вызов внутри предоплаты не отказывает
        self.assertNotIn(
            prepaid.key,
            AIUsageQuotaState.objects.get(user_email=EMAIL).reservations,
        )

    def test_parallel_chat_cannot_eat_a_prepaid_reserve(self):
        prepaid = reserve_usage_capacity(EMAIL, reserved_tokens=1500)

        def chat():
            with usage_scope(user_email=EMAIL):
                with provider_call_reservation(input_payload="x", max_output_tokens=600):
                    pass

        with usage_scope(user_email=EMAIL), prepaid_usage(prepaid):
            with self.assertRaises(AIUsageLimitExceeded):
                contextvars.Context().run(chat)  # чужой запрос: свой контекст, предоплаты в нём нет
        with self.assertRaises(AIUsageLimitExceeded):
            chat()  # после выхода из prepaid_usage льготы нет и здесь

    def test_available_tokens_subtract_used_and_reserved(self):
        AIUsageEvent.objects.create(
            user_email=EMAIL, model_name="m", total_tokens=500, billable_tokens=500
        )
        reserve_usage_capacity(EMAIL, reserved_tokens=300)
        self.assertEqual(available_usage_tokens(EMAIL), 1200)
        self.assertEqual(usage_window_limit(EMAIL), 2000)

    @override_settings(AI_USAGE_ENFORCE_LIMITS=False)
    def test_without_limits_there_is_no_ceiling(self):
        self.assertIsNone(available_usage_tokens(EMAIL))
        self.assertIsNone(usage_window_limit(EMAIL))

    def test_available_tokens_are_what_a_capacity_reserve_can_still_take(self) -> None:
        # Резерв допуска с резервами вызовов не конкурирует, истёкший не живёт.
        reserve_usage_capacity(EMAIL, reserved_tokens=400, reservation_kind="admission")
        reserve_usage_capacity(EMAIL, reserved_tokens=300, ttl_seconds=60)
        self.assertEqual(available_usage_tokens(EMAIL), 1700)
        later = timezone.now() + timedelta(minutes=2)
        self.assertEqual(available_usage_tokens(EMAIL, now=later), 2000)

        with self.assertRaises(AIUsageLimitExceeded):
            reserve_usage_capacity(EMAIL, reserved_tokens=1701)
        reserve_usage_capacity(EMAIL, reserved_tokens=1700)
        self.assertEqual(available_usage_tokens(EMAIL), 0)

        # Перерасход окна не уводит остаток в минус.
        AIUsageEvent.objects.create(
            user_email=EMAIL, model_name="m", total_tokens=500, billable_tokens=500
        )
        self.assertEqual(available_usage_tokens(EMAIL), 0)
        self.assertIsNone(available_usage_tokens(""))
        self.assertIsNone(usage_window_limit(None))

    @override_settings(
        AI_PLAN_LIMITS={"free": {"context": 2000, "five_hour": 2000, "weekly": 3000}},
    )
    def test_the_tighter_window_decides(self) -> None:
        now = datetime(2026, 11, 11, 12, 0, tzinfo=dt_timezone.utc)  # среда, середина недели

        def spent(tokens: int, hours_ago: int) -> None:
            event = AIUsageEvent.objects.create(
                user_email=EMAIL, model_name="m", total_tokens=tokens, billable_tokens=tokens
            )
            AIUsageEvent.objects.filter(pk=event.pk).update(
                created_at=now - timedelta(hours=hours_ago)
            )

        spent(500, hours_ago=1)
        self.assertEqual(available_usage_tokens(EMAIL, now=now), 1500)  # 5 часов: 2000 - 500
        spent(2000, hours_ago=6)  # вне окна 5 часов, но в этой неделе
        self.assertEqual(available_usage_tokens(EMAIL, now=now), 500)  # неделя: 3000 - 2500

        self.assertEqual(usage_window_limit(EMAIL), 2000)
        with self.settings(
            AI_PLAN_LIMITS={"free": {"context": 2000, "five_hour": 2000, "weekly": 1500}},
        ):
            self.assertEqual(usage_window_limit(EMAIL), 1500)

    def test_only_metered_calls_draw_down_and_the_reserve_keeps_its_expiry(self) -> None:
        prepaid = reserve_usage_capacity(EMAIL, reserved_tokens=1000)
        before = AIUsageQuotaState.objects.get(user_email=EMAIL).reservations[prepaid.key]
        with usage_scope(user_email=EMAIL), prepaid_usage(prepaid):
            # Немеренный расход в окна не входит, поэтому и резерв не тратит.
            record_model_usage(
                SimpleNamespace(usage={"total_tokens": 300}, id="r", model="m"),
                model="m",
                provider="p",
                metered=False,
            )
            record_model_usage(
                SimpleNamespace(usage={"total_tokens": 300}, id="r", model="m"),
                model="m",
                provider="p",
            )

        after = AIUsageQuotaState.objects.get(user_email=EMAIL).reservations[prepaid.key]
        # Меняется только остаток. Срок тот же: резерв упавшего воркера всё так же
        # уходит по TTL.
        self.assertEqual(after, {**before, "tokens": 700})

    def test_an_inner_prepaid_scope_wins_and_the_outer_one_comes_back(self) -> None:
        outer = reserve_usage_capacity(EMAIL, reserved_tokens=500)
        inner = reserve_usage_capacity(EMAIL, reserved_tokens=500)
        with usage_scope(user_email=EMAIL), prepaid_usage(outer):
            with prepaid_usage(inner):
                record_model_usage(
                    SimpleNamespace(usage={"total_tokens": 200}, id="r", model="m"),
                    model="m",
                    provider="p",
                )
            # Неактивный резерв ничего не меняет: действует внешний.
            with prepaid_usage(UsageReservation()):
                with provider_call_reservation(input_payload="x") as call:
                    self.assertEqual(call, outer)
            record_model_usage(
                SimpleNamespace(usage={"total_tokens": 100}, id="r", model="m"),
                model="m",
                provider="p",
            )

        reservations = AIUsageQuotaState.objects.get(user_email=EMAIL).reservations
        self.assertEqual(reservations[inner.key]["tokens"], 300)
        self.assertEqual(reservations[outer.key]["tokens"], 400)

    def test_an_error_inside_ends_the_scope_and_keeps_the_reserve(self) -> None:
        prepaid = reserve_usage_capacity(EMAIL, reserved_tokens=1500)
        with usage_scope(user_email=EMAIL):
            with self.assertRaisesRegex(RuntimeError, "boom"), prepaid_usage(prepaid):
                raise RuntimeError("boom")
            # Льготы больше нет: 0 + 1500 + 858 > 2000.
            with self.assertRaises(AIUsageLimitExceeded):
                with provider_call_reservation(input_payload="x", max_output_tokens=600):
                    pass

        # Резерв снимает тот, кто его взял, а не prepaid_usage.
        self.assertEqual(
            AIUsageQuotaState.objects.get(user_email=EMAIL).reservations[prepaid.key]["tokens"],
            1500,
        )

    def test_threads_get_the_reserve_through_a_copied_context(self) -> None:
        prepaid = reserve_usage_capacity(EMAIL, reserved_tokens=1000)

        def call() -> UsageReservation:
            with provider_call_reservation(input_payload="x", max_output_tokens=500) as reservation:
                return reservation

        # Как пул разбора глав: снимок контекста делает вызывающий поток, по одному на задачу.
        with usage_scope(user_email=EMAIL), prepaid_usage(prepaid):
            with ThreadPoolExecutor(max_workers=1) as pool:
                seen = pool.submit(contextvars.copy_context().run, call).result()

        self.assertEqual(seen, prepaid)

    def test_a_failed_draw_down_does_not_break_the_call(self) -> None:
        prepaid = reserve_usage_capacity(EMAIL, reserved_tokens=1000)
        # InterfaceError не наследует DatabaseError: гасить нужно всю django.db.Error.
        errors = (
            OperationalError("database is locked"),
            InterfaceError("connection already closed"),
        )
        for error in errors:
            with self.subTest(error=type(error).__name__):
                with usage_scope(user_email=EMAIL), prepaid_usage(prepaid):
                    with patch(
                        "ai_engine.usage.AIUsageQuotaState.objects.select_for_update",
                        side_effect=error,
                    ), self.assertLogs("ai_engine.usage", "WARNING") as logs:
                        event = record_model_usage(
                            SimpleNamespace(usage={"total_tokens": 300}, id="r", model="m"),
                            model="m",
                            provider="p",
                        )

                self.assertIn("draw-down unavailable", "\n".join(logs.output))
                # Расход записан, а резерв держится, пока его не снимут или не истечёт TTL.
                self.assertTrue(
                    AIUsageEvent.objects.filter(pk=event.pk, billable_tokens=300).exists()
                )
                self.assertEqual(
                    AIUsageQuotaState.objects.get(user_email=EMAIL)
                    .reservations[prepaid.key]["tokens"],
                    1000,
                )

    def test_an_unreadable_quota_row_counts_no_reserves(self) -> None:
        reserve_usage_capacity(EMAIL, reserved_tokens=300)
        with patch(
            "ai_engine.usage.AIUsageQuotaState.objects.filter",
            side_effect=OperationalError("database is locked"),
        ), self.assertLogs("ai_engine.usage", "WARNING") as logs:
            available = available_usage_tokens(EMAIL)

        # Как сам резерв: при такой ошибке он пропускает работу.
        self.assertEqual(available, 2000)
        self.assertIn("counting none", "\n".join(logs.output))

    def test_the_precheck_counts_live_reserves(self) -> None:
        # Чат во время обработки книги: обработка держит 1500 из окна 2000.
        reservation = reserve_usage_capacity(EMAIL, reserved_tokens=1500)
        AIUsageEvent.objects.create(
            user_email=EMAIL, model_name="m", total_tokens=600, billable_tokens=600
        )
        with self.assertRaises(AIUsageLimitExceeded):
            ensure_usage_available(EMAIL)  # 600 + 1500 >= 2000

        release_usage_reservation(reservation)
        # Окно держит только живой резерв вида capacity. Аренда допуска
        # (admission) и истёкший резерв вызова его не держат, хотя каждый
        # по отдельности дотянул бы до 2000.
        reserve_usage_capacity(EMAIL, reserved_tokens=1400, reservation_kind="admission")
        state = AIUsageQuotaState.objects.get(user_email=EMAIL)
        state.reservations["dead-call"] = {
            "tokens": 1400,
            "expires_at": timezone.now().timestamp() - 60,
            "feature": "chat",
            "kind": "capacity",
        }
        state.save(update_fields=["reservations"])
        ensure_usage_available(EMAIL)  # резерв снят: 600 < 2000

    def test_an_operation_is_not_refused_by_its_own_reserve(self) -> None:
        prepaid = reserve_usage_capacity(EMAIL, reserved_tokens=1500)
        AIUsageEvent.objects.create(
            user_email=EMAIL, model_name="m", total_tokens=600, billable_tokens=600
        )
        with usage_scope(user_email=EMAIL), prepaid_usage(prepaid):
            ensure_usage_available(EMAIL)  # свой резерв не в счёт: 600 < 2000
            record_model_usage(
                SimpleNamespace(usage={"total_tokens": 400}, id="r", model="m"),
                model="m",
                provider="p",
            )
            ensure_usage_available(EMAIL)  # потрачено 1000, остаток резерва 1100 свой

        with self.assertRaises(AIUsageLimitExceeded):
            ensure_usage_available(EMAIL)  # чужому запросу: 1000 + 1100 >= 2000

    def test_a_prepayment_covers_only_its_own_student(self) -> None:
        other = "other@example.com"
        prepaid = reserve_usage_capacity(EMAIL, reserved_tokens=1000)
        with usage_scope(user_email=EMAIL), prepaid_usage(prepaid):
            # Тот же ученик, почта в другом регистре: та же предоплата.
            with usage_scope(user_email=EMAIL.upper()):
                with provider_call_reservation(input_payload="x") as call:
                    self.assertEqual(call, prepaid)
            # Чужой вызов внутри блока резервирует сам и тратит не этот резерв.
            with usage_scope(user_email=other):
                with provider_call_reservation(input_payload="x", max_output_tokens=500) as call:
                    self.assertNotEqual(call, prepaid)
                    self.assertEqual(
                        list(AIUsageQuotaState.objects.get(user_email=other).reservations),
                        [call.key],
                    )
                    record_model_usage(
                        SimpleNamespace(usage={"total_tokens": 600}, id="r", model="m"),
                        model="m",
                        provider="p",
                    )

        self.assertEqual(
            AIUsageQuotaState.objects.get(user_email=EMAIL).reservations[prepaid.key]["tokens"],
            1000,
        )
        self.assertEqual(AIUsageEvent.objects.get(user_email=other).billable_tokens, 600)


    def test_a_reserve_shrinks_to_what_calls_still_running_need(self) -> None:
        reservation = reserve_usage_capacity(EMAIL, reserved_tokens=1000, ttl_seconds=600)

        def claim():
            state = AIUsageQuotaState.objects.get(user_email=EMAIL)
            return state.reservations.get(reservation.key)

        expires_at = claim()["expires_at"]

        usage_module.shrink_usage_reservation(reservation, 300)
        self.assertEqual((claim()["tokens"], claim()["expires_at"]), (300, expires_at))

        # Обратно не растёт: вызовы могли списать больше своей оценки.
        usage_module.shrink_usage_reservation(reservation, 500)
        self.assertEqual(claim()["tokens"], 300)

        usage_module.shrink_usage_reservation(reservation, 0)
        self.assertIsNone(claim())


@override_settings(
    AI_USAGE_ENFORCE_LIMITS=True,
    AI_PLAN_LIMITS={"free": {"context": 2000, "five_hour": 2000, "weekly": 2000}},
)
class ReservationsBlockUntilTests(TestCase):
    """Когда отказ держат только живые брони, ждать надо их, а не сброса окна."""

    now = datetime(2026, 11, 11, 12, 0, tzinfo=dt_timezone.utc)  # среда

    def _claim(self, tokens: int, ttl_seconds: int):
        return reserve_usage_capacity(
            EMAIL, reserved_tokens=tokens, ttl_seconds=ttl_seconds, now=self.now
        )

    def test_the_wait_ends_with_the_claim_whose_release_makes_room(self) -> None:
        self._claim(1000, ttl_seconds=60)
        self._claim(500, ttl_seconds=1800)

        # 1200 помещаются, как только кончится бронь на 1000, вторая не мешает.
        self.assertEqual(
            reservations_block_until(EMAIL, 1200, now=self.now),
            self.now + timedelta(seconds=60),
        )
        # 1600 помещаются, только когда кончатся обе.
        self.assertEqual(
            reservations_block_until(EMAIL, 1600, now=self.now),
            self.now + timedelta(seconds=1800),
        )

    def test_spent_tokens_block_by_themselves(self) -> None:
        event = AIUsageEvent.objects.create(
            user_email=EMAIL, model_name="m", total_tokens=900, billable_tokens=900
        )
        AIUsageEvent.objects.filter(pk=event.pk).update(
            created_at=self.now - timedelta(hours=1)
        )
        self._claim(500, ttl_seconds=60)

        # 900 + 1200 больше окна и без броней: ждать сброса окна.
        self.assertIsNone(reservations_block_until(EMAIL, 1200, now=self.now))

    def test_a_reserve_refused_only_by_live_claims_waits_for_them(self) -> None:
        self._claim(1000, ttl_seconds=60)
        self._claim(500, ttl_seconds=1800)

        # Расхода нет: 1200 мешают только брони. Место освободится с концом
        # брони на 1000, а не со сбросом окна.
        with self.assertRaises(AIUsageLimitExceeded) as refused:
            reserve_usage_capacity(EMAIL, reserved_tokens=1200, now=self.now)

        self.assertEqual(refused.exception.reset_at, "2026-11-11T12:01:00Z")
        self.assertEqual(
            set(refused.exception.as_payload()), {"error", "code", "window", "reset_at"}
        )

    def test_a_reserve_refused_by_spent_tokens_keeps_the_window_reset(self) -> None:
        event = AIUsageEvent.objects.create(
            user_email=EMAIL, model_name="m", total_tokens=900, billable_tokens=900
        )
        AIUsageEvent.objects.filter(pk=event.pk).update(
            created_at=self.now - timedelta(hours=1)
        )
        self._claim(500, ttl_seconds=60)

        # 900 + 1200 больше окна и без броней: ждать сброса окна.
        with self.assertRaises(AIUsageLimitExceeded) as refused:
            reserve_usage_capacity(EMAIL, reserved_tokens=1200, now=self.now)

        self.assertEqual(refused.exception.reset_at, "2026-11-16T00:00:00Z")

    def test_the_precheck_refused_only_by_live_claims_waits_for_them(self) -> None:
        # Остатки броней, например оборванного выкладкой запроса, держат всё окно.
        claim = reserve_usage_capacity(EMAIL, reserved_tokens=2000, ttl_seconds=600)
        expires_at = AIUsageQuotaState.objects.get(user_email=EMAIL).reservations[
            claim.key
        ]["expires_at"]

        with self.assertRaises(AIUsageLimitExceeded) as refused:
            ensure_usage_available(EMAIL)

        payload = refused.exception.as_payload()
        self.assertEqual(set(payload), {"error", "code", "window", "reset_at"})
        self.assertEqual(payload["code"], "ai_usage_limit_exceeded")
        self.assertTrue(payload["reset_at"].endswith("Z"), payload["reset_at"])
        self.assertAlmostEqual(
            datetime.fromisoformat(payload["reset_at"]).timestamp(), expires_at, delta=1
        )

    def test_nothing_blocks_without_claims_or_limits(self) -> None:
        self.assertIsNone(reservations_block_until(EMAIL, 1200, now=self.now))
        self._claim(1500, ttl_seconds=60)
        # 400 помещаются и рядом с бронью: ждать нечего.
        self.assertIsNone(reservations_block_until(EMAIL, 400, now=self.now))
        with self.settings(AI_USAGE_ENFORCE_LIMITS=False):
            self.assertIsNone(reservations_block_until(EMAIL, 1200, now=self.now))
        self.assertIsNone(reservations_block_until("", 1200, now=self.now))


@skipUnless(connection.vendor == "postgresql", "нужен Postgres")
class MeteredColumnDefaultTests(TestCase):
    """Миграцию применяет новый веб-контейнер, пока старый ещё пишет в базу."""

    def test_old_code_insert_without_metered_counts_as_metered(self) -> None:
        # Ровно те колонки, что пишет ORM старого кода: о `metered` он не знает.
        event_id = uuid.uuid4()
        table = connection.ops.quote_name(AIUsageEvent._meta.db_table)
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                INSERT INTO {table} (
                    id, user_email, provider, model_name, feature, request_id,
                    input_tokens, cached_input_tokens, output_tokens,
                    reasoning_tokens, total_tokens, image_count,
                    billable_tokens, cost_usd, is_estimated, metadata, created_at
                ) VALUES (
                    %s, %s, 'openrouter', 'm', 'chat', '',
                    10, 0, 20, 0, 30, 0, 30, NULL, false, '{{}}', now()
                )
                """,
                [str(event_id), EMAIL],
            )

        event = AIUsageEvent.objects.get(pk=event_id)
        self.assertIs(event.metered, True)


class MarkEmbeddingsUnmeteredTests(TestCase):
    """0010 выводит из окон и события эмбеддингов, записанные до выкладки."""

    migration = importlib.import_module(
        "ai_engine.migrations.0010_aiusageevent_metered"
    )

    def _event(self, feature: str) -> AIUsageEvent:
        return AIUsageEvent.objects.create(
            user_email=EMAIL,
            model_name="m",
            feature=feature,
            total_tokens=5_000,
            billable_tokens=5_000,
            metered=True,
        )

    def test_only_embedding_events_become_unmetered(self) -> None:
        recent = self._event("curriculum_embedding")
        old = self._event("curriculum_embedding")
        # Дата не важна: история и окна должны показывать одно и то же.
        AIUsageEvent.objects.filter(pk=old.pk).update(
            created_at=timezone.now() - timedelta(days=90)
        )
        chat = self._event("chat")

        self.migration.mark_embeddings_unmetered(django_apps, None)

        for event in (recent, old, chat):
            event.refresh_from_db()
        self.assertIs(recent.metered, False)
        self.assertIs(old.metered, False)
        self.assertIs(chat.metered, True)

    def test_backfill_runs_right_after_the_column_is_added(self) -> None:
        add_field, backfill = self.migration.Migration.operations

        self.assertIsInstance(add_field, migrations.AddField)
        self.assertEqual(add_field.name, "metered")
        self.assertIsInstance(backfill, migrations.RunPython)
        self.assertIs(backfill.code, self.migration.mark_embeddings_unmetered)
        self.assertIs(backfill.reverse_code, migrations.RunPython.noop)


@skipUnlessDBFeature("has_select_for_update")
@override_settings(
    AI_USAGE_ENFORCE_LIMITS=True,
    AI_PLAN_LIMITS=TINY_PLAN_LIMITS,
)
class UsageReservationConcurrencyTests(TransactionTestCase):
    """Runs on PostgreSQL; SQLite has no row-level ``SELECT FOR UPDATE``."""

    reset_sequences = True

    def test_two_workers_share_one_serialized_quota_snapshot(self) -> None:
        barrier = threading.Barrier(2)
        outcomes: queue.Queue[tuple[str, object]] = queue.Queue()

        def attempt() -> None:
            close_old_connections()
            try:
                barrier.wait(timeout=5)
                reservation = reserve_usage_capacity(
                    "student@example.com",
                    reserved_tokens=6,
                    feature="curriculum_ingestion",
                )
            except AIUsageLimitExceeded as exc:
                outcomes.put(("denied", exc))
            except Exception as exc:  # pragma: no cover - surfaced below
                outcomes.put(("error", exc))
            else:
                outcomes.put(("reserved", reservation))
            finally:
                close_old_connections()

        workers = [threading.Thread(target=attempt) for _ in range(2)]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join(timeout=10)

        results = [outcomes.get_nowait() for _ in range(outcomes.qsize())]
        self.assertEqual([kind for kind, _ in results].count("reserved"), 1)
        self.assertEqual([kind for kind, _ in results].count("denied"), 1)
        self.assertNotIn("error", [kind for kind, _ in results])
        for kind, value in results:
            if kind == "reserved":
                release_usage_reservation(value)


class FreePlanLimitsTests(SimpleTestCase):
    """Большая просьба к тьютору стоит 30–50 тысяч токенов: лимита должно хватать на несколько."""

    def test_free_plan_has_room_for_real_requests(self) -> None:
        self.assertEqual(settings.AI_PLAN_LIMITS["free"]["five_hour"], 150000)
        self.assertEqual(settings.AI_PLAN_LIMITS["free"]["weekly"], 500000)

    @override_settings(AI_PLAN_LIMITS={})
    def test_the_fallback_is_the_same_as_the_settings(self) -> None:
        limits = _plan_profile("free")["limits"]
        self.assertEqual((limits["five_hour"], limits["weekly"]), (150000, 500000))

    def test_a_paid_plan_stays_above_the_free_one(self) -> None:
        free, pro = settings.AI_PLAN_LIMITS["free"], settings.AI_PLAN_LIMITS["pro"]
        self.assertGreater(pro["five_hour"], free["five_hour"])
        self.assertGreater(pro["weekly"], free["weekly"])


class CurriculumUsageMiddlewareTests(SimpleTestCase):
    def test_only_ai_backed_curriculum_actions_are_quota_guarded(self) -> None:
        metered = (
            "/api/curriculum/search/",
            "/api/curriculum/plans/generate/",
            "/api/curriculum/goals/abc/normalize/",
            "/api/curriculum/ask/stream",
            "/api/curriculum/ask/stream/",
        )
        free = (
            "/api/curriculum/documents/upload/",
            # Книга с текстом лимит не тратит, сканы защищает резерв воркера.
            "/api/curriculum/documents/abc/ingest/",
            "/api/curriculum/goals/abc/confirm/",
            "/api/curriculum/plans/abc/approve/",
        )
        for path in metered:
            self.assertTrue(_is_metered_request("POST", path), path)
        for path in free:
            self.assertFalse(_is_metered_request("POST", path), path)
        self.assertFalse(_is_metered_request("GET", metered[0]))

    @patch("ai_engine.middleware.ensure_usage_available")
    def test_curriculum_search_checks_quota(self, ensure) -> None:
        request = RequestFactory().post("/api/curriculum/search/", data={})
        request.user_email = "student@example.com"
        middleware = AIUsageContextMiddleware(lambda _request: JsonResponse({"ok": True}))

        response = middleware(request)

        self.assertEqual(response.status_code, 200)
        ensure.assert_called_once_with("student@example.com")

    @patch("ai_engine.middleware.ensure_usage_available")
    def test_upload_does_not_consume_quota(self, ensure) -> None:
        request = RequestFactory().post("/api/curriculum/documents/upload/", data={})
        request.user_email = "student@example.com"
        middleware = AIUsageContextMiddleware(lambda _request: JsonResponse({"ok": True}))

        response = middleware(request)

        self.assertEqual(response.status_code, 200)
        ensure.assert_not_called()

    @patch("ai_engine.middleware.ensure_usage_available")
    def test_provider_call_denial_is_mapped_to_429(self, ensure) -> None:
        ensure.return_value = None
        request = RequestFactory().post(
            "/api/curriculum/goals/abc/normalize/",
            data={},
        )
        request.user_email = "student@example.com"

        def denied(_request):
            raise AIUsageLimitExceeded(
                window="five_hour",
                reset_at="2026-08-09T12:00:00Z",
            )

        response = AIUsageContextMiddleware(denied)(request)

        self.assertEqual(response.status_code, 429)
        self.assertEqual(
            json.loads(response.content)["code"],
            "ai_usage_limit_exceeded",
        )
