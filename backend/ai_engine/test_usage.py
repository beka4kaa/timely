import queue
import threading
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.db import close_old_connections
from django.http import JsonResponse
from django.test import (
    RequestFactory,
    SimpleTestCase,
    TestCase,
    TransactionTestCase,
    override_settings,
    skipUnlessDBFeature,
)

from .middleware import AIUsageContextMiddleware, _is_metered_request
from .models import AIUsageEvent, AIUsageQuotaState

from .usage import (
    AIUsageLimitExceeded,
    empty_usage_summary,
    ensure_usage_available,
    estimate_tokens,
    extract_usage,
    provider_call_reservation,
    provider_call_token_upper_bound,
    provider_from_base_url,
    record_model_usage,
    release_usage_reservation,
    reserve_usage_capacity,
    resolve_usage_plan,
    usage_reservation,
    usage_scope,
)


TINY_PLAN_LIMITS = {
    "free": {
        "context": 100,
        "five_hour": 10,
        "weekly": 10,
    }
}


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
    @patch("ai_engine.usage.build_usage_summary")
    def test_limit_enforcement_returns_machine_readable_window(self, build) -> None:
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


class CurriculumUsageMiddlewareTests(SimpleTestCase):
    def test_only_ai_backed_curriculum_actions_are_quota_guarded(self) -> None:
        metered = (
            "/api/curriculum/search/",
            "/api/curriculum/plans/generate/",
            "/api/curriculum/goals/abc/normalize/",
            "/api/curriculum/documents/abc/ingest/",
        )
        free = (
            "/api/curriculum/documents/upload/",
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
