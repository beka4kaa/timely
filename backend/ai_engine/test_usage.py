from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from .usage import (
    AIUsageLimitExceeded,
    empty_usage_summary,
    ensure_usage_available,
    estimate_tokens,
    extract_usage,
    provider_from_base_url,
    record_model_usage,
    resolve_usage_plan,
    usage_scope,
)


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
