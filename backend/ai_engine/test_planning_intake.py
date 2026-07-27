from __future__ import annotations

from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIRequestFactory

from .planning_intake import (
    PlanningIntakeValidationError,
    PlanningModelOutputError,
    _validate_question,
    confirm_planning_intake,
    handle_planning_intake,
)


BASE_ANSWERS = {
    "topic": "Второй закон Ньютона",
    "goal": "solve",
    "result_type": "solve_problem",
}
FULL_ANSWERS = {
    **BASE_ANSWERS,
    "solution_focus": "Построить модель",
    "level": "school",
    "duration_minutes": 35,
}


def valid_model_question() -> dict:
    return {
        "status": "question",
        "question": {
            "id": "solution_focus",
            "text": "На каком этапе нужна помощь?",
            "options": [
                {
                    "id": "build_model",
                    "label": "Построить модель",
                    "description": "Разметим силы и связи.",
                },
                {
                    "id": "choose_method",
                    "label": "Выбрать способ",
                    "description": "Найдём подходящий алгоритм.",
                },
                {
                    "id": "check_answer",
                    "label": "Проверить ответ",
                    "description": "Найдём ошибку в решении.",
                },
            ],
        },
    }


class PlanningQuestionValidationTests(SimpleTestCase):
    def test_valid_question_keeps_three_semantic_options(self) -> None:
        result = _validate_question(
            valid_model_question(),
            answers=BASE_ANSWERS,
            asked_ids=[],
        )
        self.assertIsNotNone(result)
        self.assertEqual(len(result["options"]), 3)

    def test_model_supplied_other_is_removed(self) -> None:
        payload = valid_model_question()
        payload["question"]["options"].append(
            {"id": "custom_answer", "label": "Другое — напишу сам"}
        )
        result = _validate_question(payload, answers=BASE_ANSWERS, asked_ids=[])
        self.assertEqual(len(result["options"]), 3)
        self.assertNotIn(
            "Другое",
            [option["label"] for option in result["options"]],
        )

    def test_more_than_three_real_options_is_rejected(self) -> None:
        payload = valid_model_question()
        payload["question"]["options"].append(
            {"id": "fourth_option", "label": "Начать сначала"}
        )
        with self.assertRaises(PlanningModelOutputError):
            _validate_question(payload, answers=BASE_ANSWERS, asked_ids=[])

    def test_duplicate_or_near_duplicate_labels_are_rejected(self) -> None:
        payload = valid_model_question()
        payload["question"]["options"][1]["label"] = "Построить модель"
        with self.assertRaises(PlanningModelOutputError):
            _validate_question(payload, answers=BASE_ANSWERS, asked_ids=[])

    def test_question_cannot_repeat_known_answer(self) -> None:
        with self.assertRaises(PlanningModelOutputError):
            _validate_question(
                valid_model_question(),
                answers=BASE_ANSWERS,
                asked_ids=["solution_focus"],
            )

    def test_style_question_is_rejected(self) -> None:
        payload = valid_model_question()
        payload["question"]["text"] = "Какой цвет выбрать?"
        with self.assertRaises(PlanningModelOutputError):
            _validate_question(payload, answers=BASE_ANSWERS, asked_ids=[])

    def test_raw_svg_or_unknown_fields_are_rejected(self) -> None:
        payload = valid_model_question()
        payload["raw_svg"] = "<svg/>"
        with self.assertRaises(PlanningModelOutputError):
            _validate_question(payload, answers=BASE_ANSWERS, asked_ids=[])


@override_settings(
    PLANNING_ENABLED=True,
    PLANNING_MAX_QUESTIONS=4,
    PLANNING_MODEL="deepseek/deepseek-v4-flash",
)
class PlanningIntakeServiceTests(SimpleTestCase):
    def test_valid_model_question_uses_signed_session(self) -> None:
        with patch(
            "ai_engine.planning_intake._ask_model",
            return_value=(
                _validate_question(
                    valid_model_question(),
                    answers=BASE_ANSWERS,
                    asked_ids=[],
                ),
                "deepseek/deepseek-v4-flash",
            ),
        ):
            result = handle_planning_intake(
                {"type": "planning_intake", "answers": BASE_ANSWERS, "step": 3}
            )

        self.assertEqual(result["status"], "question")
        self.assertEqual(result["question"]["id"], "solution_focus")
        self.assertTrue(result["session_id"])
        self.assertFalse(result["fallback"])

    def test_timeout_activates_deterministic_fallback(self) -> None:
        with patch(
            "ai_engine.planning_intake._ask_model",
            side_effect=TimeoutError("provider timed out"),
        ):
            result = handle_planning_intake(
                {"type": "planning_intake", "answers": BASE_ANSWERS}
            )

        self.assertEqual(result["status"], "question")
        self.assertTrue(result["fallback"])
        self.assertEqual(
            result["notice"],
            "Продолжим с базовыми настройками.",
        )
        self.assertEqual(result["question"]["id"], "solution_focus")

    @override_settings(PLANNING_ENABLED=False)
    def test_disabled_planner_never_calls_model(self) -> None:
        with patch("ai_engine.planning_intake._ask_model") as model_call:
            result = handle_planning_intake(
                {"type": "planning_intake", "answers": BASE_ANSWERS}
            )
        model_call.assert_not_called()
        self.assertTrue(result["fallback"])

    def test_complete_answers_skip_model_and_return_summary(self) -> None:
        with patch("ai_engine.planning_intake._ask_model") as model_call:
            result = handle_planning_intake(
                {"type": "planning_intake", "answers": FULL_ANSWERS, "step": 5}
            )
        model_call.assert_not_called()
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["summary"]["duration_minutes"], 35)
        self.assertIn("Построить модель", result["summary"]["focus"])

    def test_confirm_builds_extended_lesson_plan(self) -> None:
        start = handle_planning_intake(
            {"type": "planning_intake", "answers": FULL_ANSWERS}
        )
        result = confirm_planning_intake(
            {
                "type": "confirm_planning_intake",
                "session_id": start["session_id"],
                "answers": FULL_ANSWERS,
            }
        )
        plan = result["plan"]
        self.assertEqual(plan["topic"], FULL_ANSWERS["topic"])
        self.assertEqual(plan["resultType"], "solve_problem")
        self.assertTrue(plan["difficulties"])
        self.assertEqual(len(plan["successCriteria"]), 2)
        self.assertGreaterEqual(len(plan["tasks"]), 5)

    def test_tampered_session_is_rejected(self) -> None:
        with self.assertRaises(PlanningIntakeValidationError):
            confirm_planning_intake(
                {
                    "type": "confirm_planning_intake",
                    "session_id": "tampered-session",
                    "answers": FULL_ANSWERS,
                }
            )

    def test_incomplete_base_answers_are_rejected(self) -> None:
        with self.assertRaises(PlanningIntakeValidationError):
            handle_planning_intake(
                {"type": "planning_intake", "answers": {"topic": "Оптика"}}
            )

    def test_completed_fallback_question_is_not_repeated(self) -> None:
        with patch(
            "ai_engine.planning_intake._ask_model",
            side_effect=TimeoutError("timeout"),
        ):
            first = handle_planning_intake(
                {"type": "planning_intake", "answers": BASE_ANSWERS}
            )
            second = handle_planning_intake(
                {
                    "type": "planning_intake",
                    "session_id": first["session_id"],
                    "answers": {
                        **BASE_ANSWERS,
                        "solution_focus": "Построить модель",
                    },
                    "asked_question_ids": ["solution_focus"],
                }
            )
        self.assertEqual(second["status"], "complete")

    def test_chat_endpoint_dispatches_intake_without_message(self) -> None:
        from .chat_views import BoardChatView

        request = APIRequestFactory().post(
            "/api/ai/chat",
            {
                "type": "planning_intake",
                "answers": BASE_ANSWERS,
            },
            format="json",
        )
        with patch(
            "ai_engine.planning_intake._ask_model",
            side_effect=TimeoutError("timeout"),
        ):
            response = BoardChatView.as_view()(request)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["type"], "planning_intake")
