"""Правила контестов: тиры, сравнение ответов, публикация и таблица. Без базы."""

from datetime import datetime, timedelta, timezone as dt_timezone
from types import SimpleNamespace

from django.test import SimpleTestCase

from .contest_rules import (
    ARTS,
    TIER_CAPS,
    TIER_NAMES,
    Attempt,
    allowed_tiers,
    answers_match,
    contest_state,
    first_variant,
    publish_problems,
    standings,
)

START = datetime(2026, 11, 12, 10, 0, tzinfo=dt_timezone.utc)
END = START + timedelta(hours=3)
BEFORE = START - timedelta(days=1)


def person(staff=False, superuser=False, moderator=False):
    return SimpleNamespace(is_staff=staff, is_superuser=superuser, is_moderator=moderator)


def task(answer="1", points=10, statement_file=7):
    return {"answer": answer, "points": points, "statement_file": statement_file}


def problems(**overrides):
    fields = {
        "title": "Кубок",
        "start": START,
        "end": END,
        "tier": 5,
        "art": "rings",
        "tasks": [task()],
        "actor": person(staff=True),
        "now": BEFORE,
    }
    fields.update(overrides)
    return publish_problems(**fields)


def codes(found):
    return [problem["code"] for problem in found]


class TierTests(SimpleTestCase):
    def test_tier_caps_match_the_spec(self):
        self.assertEqual(TIER_CAPS, {1: 800, 2: 400, 3: 200, 4: 100, 5: 50})
        self.assertEqual(TIER_NAMES[1], "Аметист")
        self.assertEqual(TIER_NAMES[2], "Алмаз")
        self.assertEqual(TIER_NAMES[5], "Бронза")
        self.assertEqual(len(ARTS), 12)
        self.assertEqual(len(set(ARTS)), 12)

    def test_only_staff_set_top_tiers(self):
        self.assertEqual(allowed_tiers(person(staff=True)), frozenset({1, 2, 3, 4, 5}))
        self.assertEqual(allowed_tiers(person(superuser=True)), frozenset({1, 2, 3, 4, 5}))
        self.assertEqual(allowed_tiers(person(moderator=True)), frozenset({3, 4, 5}))
        self.assertEqual(allowed_tiers(person()), frozenset())
        self.assertEqual(allowed_tiers(None), frozenset())


class AnswerTests(SimpleTestCase):
    def test_numbers_compare_as_numbers(self):
        for given, expected in [
            ("0,75", "3/4"),
            (".75", "0.75"),
            ("1 000", "1000"),
            ("−2", "-2"),
            ("60°", "60"),
            ("15.", "15"),
            ("+4", "4"),
            ("10000", "10 000"),
        ]:
            with self.subTest(given=given, expected=expected):
                self.assertTrue(answers_match(given, expected))
        self.assertFalse(answers_match("0,76", "3/4"))
        # Деление на ноль не число: такие строки сравниваются как текст и не падают.
        self.assertTrue(answers_match("1/0", "1/0"))
        self.assertFalse(answers_match("1/0", "2/0"))

    def test_text_ignores_case_spaces_and_yo(self):
        self.assertTrue(answers_match("  Ёж  ", "еж"))
        self.assertTrue(answers_match("x  =  2", "X = 2"))
        self.assertFalse(answers_match("ёж", "уж"))

    def test_any_variant_counts(self):
        self.assertTrue(answers_match("0,75", "1/2; 0.75"))
        self.assertTrue(answers_match("π/2", "π/6; π/2"))
        self.assertFalse(answers_match("", "1"))
        self.assertFalse(answers_match("   ", "1"))
        self.assertFalse(answers_match("1", ""))
        self.assertFalse(answers_match("1", " ; "))

    def test_first_variant(self):
        self.assertEqual(first_variant(" 60 ; 60° "), "60")
        self.assertEqual(first_variant(""), "")


class StateTests(SimpleTestCase):
    def test_state_boundaries(self):
        self.assertEqual(contest_state(START, END, START - timedelta(seconds=1)), "upcoming")
        self.assertEqual(contest_state(START, END, START), "running")
        self.assertEqual(contest_state(START, END, END - timedelta(seconds=1)), "running")
        self.assertEqual(contest_state(START, END, END), "ended")


class PublishTests(SimpleTestCase):
    def test_publish_problems_lists_every_gap(self):
        found = problems(
            title="  ",
            tasks=[task(answer="", points=40, statement_file=None), task(answer="1", points=20)],
        )
        self.assertEqual(codes(found), ["title", "no_statement", "no_answer", "over_cap"])
        self.assertEqual(found[-1]["message"], "Сумма 60 больше потолка тира: 50.")
        self.assertEqual(found[1]["message"], "У задачи 1 нет PDF условия.")
        self.assertEqual(found[1]["field"], "tasks.1")
        self.assertEqual(found[2]["message"], "У задачи 1 нет ответа.")

    def test_publish_problems_for_dates_and_tier(self):
        self.assertEqual(codes(problems(end=START - timedelta(minutes=1))), ["dates_order"])
        self.assertEqual(codes(problems(now=END + timedelta(minutes=1))), ["ended"])
        self.assertEqual(codes(problems(tier=1, actor=person(moderator=True))), ["tier_forbidden"])
        self.assertEqual(codes(problems(art="x")), ["art"])
        self.assertEqual(codes(problems(tasks=[task(points=1)] * 21)), ["too_many_tasks"])
        self.assertEqual(codes(problems(tasks=[])), ["no_tasks"])
        self.assertEqual(codes(problems(tasks=[task(points=0)])), ["bad_points"])

    def test_a_clean_contest_has_no_problems(self):
        self.assertEqual(problems(tier=2, tasks=[task(points=150), task(points=250)]), [])


class StandingsTests(SimpleTestCase):
    def at(self, minutes):
        return START + timedelta(minutes=minutes)

    def test_standings_order_and_penalty(self):
        attempts = [
            # A: задача 1 в 10:20 с одной ошибкой: 20 + 5 = 25.
            Attempt(1, 1, False, self.at(15)),
            Attempt(1, 1, True, self.at(20)),
            # B: задача 1 в 10:10 с тремя ошибками: 10 + 15 = 25.
            Attempt(2, 1, False, self.at(2)),
            Attempt(2, 1, False, self.at(4)),
            Attempt(2, 1, False, self.at(6)),
            Attempt(2, 1, True, self.at(10)),
            # C: задача 2 в 10:05.
            Attempt(3, 2, True, self.at(5)),
            # D: только ошибки.
            Attempt(4, 1, False, self.at(30)),
        ]
        rows = standings([1, 2], {1: 100, 2: 50}, attempts, START)

        self.assertEqual([row.student_id for row in rows], [1, 2, 3, 4])
        self.assertEqual([row.place for row in rows], [1, 1, 3, 4])
        self.assertEqual([row.points for row in rows], [100, 100, 50, 0])
        self.assertEqual([row.penalty for row in rows], [25, 25, 5, 0])
        self.assertEqual([row.solved for row in rows], [1, 1, 1, 0])
        self.assertEqual(rows[2].marks, ["none", "solved"])
        self.assertEqual(rows[3].marks, ["tried", "none"])

    def test_attempts_after_the_first_correct_do_not_count(self):
        attempts = [
            Attempt(1, 1, True, self.at(10)),
            Attempt(1, 1, False, self.at(11)),
            Attempt(1, 1, True, self.at(40)),
        ]
        [row] = standings([1], {1: 100}, attempts, START)
        self.assertEqual((row.points, row.penalty, row.solved), (100, 10, 1))
