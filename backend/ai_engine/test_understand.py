"""Разбор записи ученика: проверка ответа модели и честный отказ без неё."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase, override_settings

from config.testing import auth_headers

from .understand import validate


class ValidateTests(SimpleTestCase):
    def test_keeps_only_known_fields(self):
        self.assertEqual(
            validate({"kind": "habit", "name": "  Читать\n20 минут ", "icon": "<script>"}),
            {"kind": "habit", "name": "Читать 20 минут"},
        )

    def test_rejects_unknown_kind_and_empty_values(self):
        self.assertIsNone(validate({"kind": "delete_everything"}))
        self.assertIsNone(validate({"kind": "habit", "name": "   "}))
        self.assertIsNone(validate({"kind": "topics", "topics": [{"title": ""}]}))
        self.assertIsNone(validate("question"))

    def test_topics_are_capped_and_subject_is_optional(self):
        result = validate({"kind": "topics", "topics": [{"title": f"Тема {i}"} for i in range(20)]})
        self.assertEqual(len(result["topics"]), 8)
        self.assertEqual(result["topics"][0], {"title": "Тема 0", "subject": ""})

    def test_goal_drops_a_bad_deadline_and_defaults_to_study(self):
        result = validate({"kind": "goal", "title": "Сдать физику", "deadline": "к декабрю"})
        self.assertEqual(result["deadline"], None)
        self.assertEqual(result["scope"], "study")
        self.assertEqual(result["habits"], [])

    def test_goal_keeps_a_real_deadline_and_general_scope(self):
        result = validate(
            {"kind": "goal", "title": "Пробежать 5 км", "scope": "general", "deadline": "2027-05-01", "habits": ["Бегать"]}
        )
        self.assertEqual(result["deadline"], "2027-05-01")
        self.assertEqual(result["scope"], "general")
        self.assertEqual(result["habits"], ["Бегать"])


class BoardGateTests(SimpleTestCase):
    @override_settings(BOARD_ENABLED=False)
    def test_require_board_raises_when_disabled(self):
        from .board_gate import BoardDisabled, require_board

        with self.assertRaises(BoardDisabled):
            require_board()

    @override_settings(BOARD_ENABLED=True)
    def test_require_board_passes_when_enabled(self):
        from .board_gate import require_board

        require_board()


class UnderstandApiTests(TestCase):
    url = "/api/ai/understand"

    def post(self, body):
        return self.client.post(self.url, body, content_type="application/json", **auth_headers("pupil@example.com"))

    def test_requires_sign_in(self):
        response = self.client.post(self.url, {"text": "x"}, content_type="application/json")
        self.assertEqual(response.status_code, 401)

    def test_empty_text_is_rejected(self):
        self.assertEqual(self.post({"text": "   "}).status_code, 400)

    def test_without_a_key_it_says_so_and_the_client_uses_rules(self):
        with patch("ai_engine.understand.text_llm.is_configured", return_value=False):
            self.assertEqual(self.post({"text": "Хочу читать"}).status_code, 503)

    def test_returns_the_validated_answer_and_passes_text_as_data(self):
        answer = SimpleNamespace(text='{"kind":"habit","name":"Читать 20 минут","extra":"нет"}')
        with (
            patch("ai_engine.understand.text_llm.is_configured", return_value=True),
            patch("ai_engine.understand.text_llm.TextModel.generate_json_content", return_value=answer) as call,
        ):
            response = self.post({"text": "Хочу читать 20 минут каждый день", "expect": "habit"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"kind": "habit", "name": "Читать 20 минут"})
        self.assertEqual(call.call_args.kwargs["payload"]["text"], "Хочу читать 20 минут каждый день")
        self.assertFalse(call.call_args.kwargs["reasoning_enabled"])

    def test_a_broken_model_answer_falls_back_to_rules(self):
        with (
            patch("ai_engine.understand.text_llm.is_configured", return_value=True),
            patch(
                "ai_engine.understand.text_llm.TextModel.generate_json_content",
                return_value=SimpleNamespace(text="не JSON"),
            ),
        ):
            self.assertEqual(self.post({"text": "Хочу читать"}).status_code, 503)


class BoardRoutesTests(TestCase):
    def post(self, url, body=None):
        return self.client.post(url, body or {"message": "x"}, content_type="application/json", **auth_headers("pupil@example.com"))

    @override_settings(BOARD_ENABLED=False)
    def test_expensive_board_routes_are_closed(self):
        for url in (
            "/api/ai/chat/stream",
            "/api/ai/chat",
            "/api/ai/illustration",
            "/api/ai/draw",
            "/api/ai/analyze-canvas",
            "/api/ai/solve",
            "/api/ai/ocr",
        ):
            response = self.post(url)
            self.assertEqual(response.status_code, 404, url)

    @override_settings(BOARD_ENABLED=False)
    def test_plan_intake_lives_without_the_board(self):
        response = self.post("/api/ai/chat", {"type": "planning_intake"})
        self.assertNotEqual(response.status_code, 404)
