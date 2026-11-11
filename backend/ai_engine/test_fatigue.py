"""Тесты сигнала усталости (fatigue.py, PRODUCT.md §9.4)."""

from __future__ import annotations

from django.apps import apps
from django.test import SimpleTestCase, TestCase

from ai_engine.fatigue import (
    FATIGUE_LINE,
    FATIGUE_THRESHOLD,
    build_fatigue_note,
    consecutive_wrong_attempts,
    fatigue_context_line,
    fatigue_score,
)
from ai_engine.learning_events import record_learning_event
from ai_engine.skills.router import build_router_messages
from ai_engine.tutor_modes import get_mode

EMAIL = "tired@example.com"


class FatigueScoreTests(SimpleTestCase):
    def test_calm_message_scores_zero(self) -> None:
        self.assertEqual(fatigue_score(["Объясни, что такое производная"]), 0.0)

    def test_russian_patterns_raise_the_score(self) -> None:
        for text in (
            "не могу",
            "бесит",
            "опять неправильно",
            "не понимаю ничего",
            "надоело",
            "я устал",
            "Ёлки, ничего не получается",
            "меня бесят эти дроби",
            "ты бесишь",
            "уже достало",
            "достали эти задачи",
            "меня достал этот параграф",
        ):
            with self.subTest(text=text):
                self.assertGreater(fatigue_score([text]), 0.0)

    def test_strong_complaint_passes_threshold_alone(self) -> None:
        self.assertGreaterEqual(fatigue_score(["всё, надоело"]), FATIGUE_THRESHOLD)

    def test_weak_complaint_alone_stays_below_threshold(self) -> None:
        self.assertLess(fatigue_score(["не могу"]), FATIGUE_THRESHOLD)

    def test_consecutive_wrong_attempts_raise_the_score(self) -> None:
        scores = [fatigue_score([], wrong) for wrong in range(0, 5)]
        self.assertEqual(scores[0], 0.0)
        self.assertEqual(scores[1], 0.0)  # одна ошибка — норма
        self.assertEqual(scores, sorted(scores))
        self.assertGreaterEqual(scores[4], FATIGUE_THRESHOLD)

    def test_thanks_and_understood_lower_the_score(self) -> None:
        tired = fatigue_score(["не могу", "опять неправильно"], 2)
        relieved = fatigue_score(["не могу", "опять неправильно", "спасибо, понял"], 2)
        self.assertLess(relieved, tired)
        self.assertLess(fatigue_score(["спасибо, понял"], 3), fatigue_score([], 3))

    def test_relief_word_inside_negation_does_not_count(self) -> None:
        self.assertGreaterEqual(fatigue_score(["ничего не понял, бесит"]), FATIGUE_THRESHOLD)
        self.assertGreaterEqual(fatigue_score(["не ясно"], 3), fatigue_score([], 3))
        self.assertGreaterEqual(fatigue_score(["ни разу не понял"], 3), fatigue_score([], 3))
        self.assertLess(fatigue_score(["спасибо, понял"], 3), fatigue_score([], 3))

    def test_bare_khvatit_in_a_question_is_not_fatigue(self) -> None:
        self.assertEqual(fatigue_context_line(fatigue_score(["хватит ли данных?"])), "")
        self.assertEqual(fatigue_context_line(fatigue_score(["Хватит ли времени до контрольной?"])), "")
        self.assertGreaterEqual(fatigue_score(["с меня хватит"]), FATIGUE_THRESHOLD)
        self.assertGreaterEqual(fatigue_score(["хватит уже"]), FATIGUE_THRESHOLD)

    def test_old_complaints_fade(self) -> None:
        fresh = fatigue_score(["надоело"])
        old = fatigue_score(["надоело", "ок", "ладно", "дальше"])
        self.assertLess(old, fresh)

    def test_score_is_clamped(self) -> None:
        self.assertEqual(fatigue_score(["надоело"] * 5, 20), 1.0)

    def test_consecutive_wrong_counts_only_the_tail(self) -> None:
        self.assertEqual(consecutive_wrong_attempts(["incorrect", "correct", "incorrect", "incorrect"]), 2)
        self.assertEqual(consecutive_wrong_attempts(["incorrect", "incorrect", "correct"]), 0)
        self.assertEqual(consecutive_wrong_attempts([]), 0)


class FatigueContextLineTests(SimpleTestCase):
    def test_below_threshold_no_line(self) -> None:
        self.assertEqual(fatigue_context_line(FATIGUE_THRESHOLD - 0.01), "")

    def test_above_threshold_one_line_leaving_decision_to_student(self) -> None:
        line = fatigue_context_line(0.9)
        self.assertEqual(line, FATIGUE_LINE)
        self.assertNotIn("\n", line)
        self.assertIn("решение остаётся за учеником", line)

    def test_router_adds_exactly_one_line_only_when_given(self) -> None:
        mode = get_mode(None)
        quiet = build_router_messages(user_message="Привет", history=[], mode=mode)[0]["content"]
        loud = build_router_messages(
            user_message="Привет", history=[], mode=mode, fatigue_note=FATIGUE_LINE
        )[0]["content"]
        self.assertNotIn(FATIGUE_LINE, quiet)
        self.assertEqual(loud.count(FATIGUE_LINE), 1)


class BuildFatigueNoteTests(TestCase):
    def _attempt(self, result: str) -> None:
        record_learning_event(
            user_email=EMAIL, activity="task_attempt", result=result, skill_ref="Дроби"
        )

    def test_calm_student_gets_no_note(self) -> None:
        self._attempt("correct")
        self.assertEqual(build_fatigue_note(EMAIL, ["Привет"]), "")

    def test_journal_streak_alone_triggers_note(self) -> None:
        for _ in range(4):
            self._attempt("incorrect")
        self.assertEqual(build_fatigue_note(EMAIL, ["давай дальше"]), FATIGUE_LINE)

    def test_correct_answer_breaks_streak(self) -> None:
        for _ in range(4):
            self._attempt("incorrect")
        self._attempt("correct")
        self.assertEqual(build_fatigue_note(EMAIL, ["давай дальше"]), "")

    def test_message_text_is_never_persisted(self) -> None:
        secret = "бесит, надоело, устал"
        before = {m: m.objects.count() for m in apps.get_app_config("ai_engine").get_models()}
        self.assertEqual(build_fatigue_note(EMAIL, [secret]), FATIGUE_LINE)
        after = {m: m.objects.count() for m in before}
        self.assertEqual(before, after)
