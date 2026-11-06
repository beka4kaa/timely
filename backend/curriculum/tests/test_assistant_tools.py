"""Что тьютор видит и предлагает в делах ученика.

Главное здесь две границы: чужие данные недоступны даже по точному идентификатору, а модель
ничего не записывает сама: только предложение, которое потом применит ученик.
"""

from __future__ import annotations

import datetime as dt

from django.test import TestCase
from django.utils import timezone

from curriculum.assistant_tools import (
    MAX_PROPOSALS,
    OPEN_ALL_TOOL,
    OWN_TOOLS,
    AssistantTools,
    choose_tools,
    tool_label,
)
from diary.models import DiaryWeek
from habits.models import Habit, HabitLog
from mind.models import Subject, Topic
from planner.models import Goal
from pomodoro.models import FocusSession

OWNER = "owner@example.com"
INTRUDER = "intruder@example.com"


def _tools(email: str = OWNER) -> AssistantTools:
    return AssistantTools(email, "Asia/Almaty")


class ReadToolsTests(TestCase):
    def test_habits_show_today_and_the_week(self):
        tools = _tools()
        today = tools.context.today
        habit = Habit.objects.create(user_email=OWNER, name="Зарядка")
        HabitLog.objects.create(habit=habit, date=today)
        HabitLog.objects.create(habit=habit, date=today - dt.timedelta(days=1))
        HabitLog.objects.create(habit=habit, date=today - dt.timedelta(days=30))
        Habit.objects.create(user_email=INTRUDER, name="Чужая")

        rows = tools.run("list_habits", {})["habits"]

        self.assertEqual([row["name"] for row in rows], ["Зарядка"])
        self.assertTrue(rows[0]["done_today"])
        self.assertEqual(rows[0]["done_last_7_days"], 2)
        self.assertEqual(rows[0]["streak_days"], 2)

    def test_goals_leave_out_archived_and_foreign(self):
        tools = _tools()
        Goal.objects.create(
            user_email=OWNER, title="Сдать физику", type="goal", status="active", progress=30,
            due_date=tools.context.today + dt.timedelta(days=10),
        )
        Goal.objects.create(user_email=OWNER, title="Старая", type="goal", status="archived")
        Goal.objects.create(user_email=INTRUDER, title="Чужая", type="goal", status="active")

        rows = tools.run("list_goals", {})["goals"]

        self.assertEqual([row["title"] for row in rows], ["Сдать физику"])
        self.assertEqual(rows[0]["progress"], 30)
        self.assertEqual(rows[0]["days_left"], 10)

    def test_topics_say_what_is_due(self):
        tools = _tools()
        subject = Subject.objects.create(user_email=OWNER, name="Физика")
        now = timezone.now()
        Topic.objects.create(subject=subject, name="Импульс", next_review_at=now - dt.timedelta(days=2))
        Topic.objects.create(subject=subject, name="Работа", next_review_at=now + dt.timedelta(days=5))
        foreign = Subject.objects.create(user_email=INTRUDER, name="Физика")
        Topic.objects.create(subject=foreign, name="Чужая", next_review_at=now)

        answer = tools.run("list_review_topics", {"only_due": True})

        self.assertEqual(answer["due_now"], 1)
        self.assertEqual([row["name"] for row in answer["topics"]], ["Импульс"])
        self.assertEqual(answer["topics"][0]["overdue_days"], 2)

    def test_diary_shows_lessons_of_the_period(self):
        tools = _tools()
        today = tools.context.today
        monday = today - dt.timedelta(days=today.weekday())
        DiaryWeek.objects.create(
            id="w1",
            user_email=OWNER,
            week_start=monday.isoformat(),
            week_end=(monday + dt.timedelta(days=6)).isoformat(),
            days=[
                {
                    "id": "d1",
                    "date": today.isoformat(),
                    "lessons": [{"id": "l1", "subjectName": "Алгебра", "startTime": "08:00", "homework": "№ 12", "grades": {"test": 5, "exercises": None}}],
                },
                {"id": "d0", "date": "2000-01-01", "lessons": [{"id": "old", "subjectName": "Старое"}]},
            ],
        )

        days = tools.run("get_diary", {})["days"]

        self.assertEqual(len(days), 1)
        lesson = days[0]["lessons"][0]
        self.assertEqual(lesson["subject"], "Алгебра")
        self.assertEqual(lesson["homework"], "№ 12")
        self.assertEqual(lesson["grades"], {"test": 5})

    def test_empty_diary_says_where_to_fill_it(self):
        answer = _tools().run("get_diary", {})
        self.assertEqual(answer["days"], [])
        self.assertIn("Дневник", answer["note"])

    def test_focus_counts_only_focus_minutes_of_this_student(self):
        tools = _tools()
        now = timezone.now()
        common = {"planned_seconds": 1500, "preset_focus_min": 25, "preset_break_min": 5, "started_at": now}
        FocusSession.objects.create(user_email=OWNER, kind=FocusSession.FOCUS, seconds=1500, **common)
        FocusSession.objects.create(user_email=OWNER, kind=FocusSession.BREAK, seconds=300, **common)
        FocusSession.objects.create(user_email=INTRUDER, kind=FocusSession.FOCUS, seconds=999, **common)

        answer = tools.run("get_focus_stats", {"days": 3})

        self.assertEqual(answer["total_minutes"], 25)
        self.assertEqual(answer["sessions"], 1)

    def test_no_schedule_is_said_plainly(self):
        answer = _tools().run("get_schedule", {})
        self.assertFalse(answer["ok"])
        self.assertEqual(answer["error"], "no_schedule")


class ProposalTests(TestCase):
    def test_new_habit_only_proposes(self):
        tools = _tools()
        goal = Goal.objects.create(user_email=OWNER, title="Форма", type="goal", status="active")

        answer = tools.run("propose_new_habit", {"name": "  Зарядка  ", "goal_id": str(goal.pk)})

        self.assertTrue(answer["ok"])
        self.assertFalse(Habit.objects.filter(user_email=OWNER).exists())
        proposal = tools.proposals[0]
        self.assertEqual(proposal["kind"], "new_habit")
        self.assertEqual(proposal["name"], "Зарядка")
        self.assertEqual(proposal["goal_title"], "Форма")
        self.assertTrue(proposal["id"])

    def test_foreign_goal_is_not_found(self):
        tools = _tools()
        goal = Goal.objects.create(user_email=INTRUDER, title="Чужая", type="goal", status="active")
        self.assertEqual(tools.run("propose_new_habit", {"name": "Бег", "goal_id": str(goal.pk)})["error"], "not_found")
        self.assertEqual(tools.run("propose_goal_progress", {"goal_id": str(goal.pk), "progress": 50})["error"], "not_found")
        self.assertEqual(tools.proposals, [])

    def test_existing_habit_is_not_proposed_again(self):
        Habit.objects.create(user_email=OWNER, name="Зарядка")
        self.assertEqual(_tools().run("propose_new_habit", {"name": "зарядка"})["error"], "exists")

    def test_mark_habit_checks_owner_and_state(self):
        tools = _tools()
        mine = Habit.objects.create(user_email=OWNER, name="Зарядка")
        foreign = Habit.objects.create(user_email=INTRUDER, name="Чужая")

        self.assertEqual(tools.run("propose_mark_habit", {"habit_id": foreign.pk})["error"], "not_found")
        self.assertEqual(tools.run("propose_mark_habit", {"habit_id": "мусор"})["error"], "not_found")
        self.assertTrue(tools.run("propose_mark_habit", {"habit_id": mine.pk})["ok"])
        self.assertFalse(mine.logs.exists())
        self.assertEqual(tools.proposals[0]["done"], True)

        HabitLog.objects.create(habit=mine, date=tools.context.today)
        self.assertEqual(tools.run("propose_mark_habit", {"habit_id": mine.pk, "done": True})["error"], "already")

    def test_new_goal_checks_the_deadline(self):
        tools = _tools()
        past = (tools.context.today - dt.timedelta(days=1)).isoformat()
        self.assertFalse(tools.run("propose_new_goal", {"title": "Сдать", "deadline": past})["ok"])
        self.assertFalse(tools.run("propose_new_goal", {"title": "Сдать", "deadline": "завтра"})["ok"])

        ok = tools.run(
            "propose_new_goal",
            {"title": "Сдать физику", "scope": "study", "habits": ["Задачи", "", "Повтор", "Ещё", "Лишняя"]},
        )

        self.assertTrue(ok["ok"])
        self.assertFalse(Goal.objects.filter(user_email=OWNER).exists())
        self.assertEqual(tools.proposals[0]["habits"], ["Задачи", "Повтор", "Ещё"])

    def test_goal_progress_keeps_the_range(self):
        tools = _tools()
        goal = Goal.objects.create(user_email=OWNER, title="Цель", type="goal", status="active", progress=20)
        self.assertFalse(tools.run("propose_goal_progress", {"goal_id": str(goal.pk), "progress": 140})["ok"])
        self.assertFalse(tools.run("propose_goal_progress", {"goal_id": str(goal.pk), "progress": True})["ok"])
        self.assertTrue(tools.run("propose_goal_progress", {"goal_id": str(goal.pk), "progress": 60})["ok"])
        goal.refresh_from_db()
        self.assertEqual(goal.progress, 20)
        self.assertEqual(tools.proposals[0]["before"], 20)
        self.assertEqual(tools.proposals[0]["progress"], 60)

    def test_known_topics_are_left_out(self):
        subject = Subject.objects.create(user_email=OWNER, name="Физика")
        Topic.objects.create(subject=subject, name="Импульс")
        tools = _tools()

        answer = tools.run(
            "propose_new_topics",
            {"topics": [{"title": "импульс", "subject": "физика"}, {"title": "Работа", "subject": "Физика"}, {"title": "Без предмета"}]},
        )

        self.assertTrue(answer["ok"])
        self.assertEqual(tools.proposals[0]["topics"], [{"title": "Работа", "subject": "Физика"}])
        self.assertEqual(Topic.objects.filter(subject=subject).count(), 1)
        self.assertFalse(tools.run("propose_new_topics", {"topics": [{"title": "Импульс", "subject": "Физика"}]})["ok"])

    def test_homework_mark_points_at_the_real_lesson(self):
        tools = _tools()
        today = tools.context.today
        monday = today - dt.timedelta(days=today.weekday())
        week = DiaryWeek.objects.create(
            id="w1",
            user_email=OWNER,
            week_start=monday.isoformat(),
            week_end=(monday + dt.timedelta(days=6)).isoformat(),
            days=[
                {
                    "id": "d1",
                    "date": today.isoformat(),
                    "dayOfWeek": "monday",
                    "lessons": [
                        {"id": "l1", "lessonNumber": 1, "startTime": "08:00", "subjectName": "Алгебра", "homework": "№ 12"},
                        {"id": "l2", "lessonNumber": 2, "startTime": "09:00", "subjectName": "Физика", "homework": ""},
                    ],
                }
            ],
        )

        self.assertTrue(tools.run("propose_mark_homework", {"date": today.isoformat(), "lesson_id": "l1"})["ok"])
        self.assertEqual(tools.run("propose_mark_homework", {"date": today.isoformat(), "lesson_id": "l2"})["error"], "nothing_to_mark")
        self.assertEqual(tools.run("propose_mark_homework", {"date": today.isoformat(), "lesson_id": "нет"})["error"], "not_found")
        proposal = tools.proposals[0]
        self.assertEqual(proposal["week_start"], monday.isoformat())
        self.assertEqual(proposal["slot"]["lessonNumber"], 1)
        week.refresh_from_db()
        self.assertNotIn("homeworkDone", week.days[0]["lessons"][0])

        # Чужой ученик этот урок не видит.
        self.assertEqual(
            _tools(INTRUDER).run("propose_mark_homework", {"date": today.isoformat(), "lesson_id": "l1"})["error"],
            "not_found",
        )

    def test_commitments_become_a_card(self):
        tools = _tools()
        answer = tools.run(
            "propose_fixed_commitments",
            {"items": [{"title": "Репетитор", "kind": "tutor", "weekday": 1, "start_time": "16:00", "duration_minutes": 60}]},
        )
        self.assertTrue(answer["ok"], answer)
        self.assertEqual(tools.proposals[0]["kind"], "commitments")
        self.assertEqual(tools.proposals[0]["items"][0]["title"], "Репетитор")

    def test_too_many_proposals_are_refused(self):
        tools = _tools()
        for index in range(MAX_PROPOSALS):
            self.assertTrue(tools.run("propose_new_habit", {"name": f"Привычка {index}"})["ok"])
        self.assertEqual(tools.run("propose_new_habit", {"name": "Ещё одна"})["error"], "too_many")
        self.assertEqual(len(tools.proposals), MAX_PROPOSALS)


class CatalogTests(TestCase):
    def test_made_up_schedule_id_means_the_main_one(self):
        tools = _tools()
        self.assertIsNone(tools.context.schedule_for("не-идентификатор"))

    def test_every_tool_has_a_plain_label(self):
        for schema in _tools().schemas():
            label = tool_label(schema["function"]["name"])
            self.assertRegex(label, r"^[А-ЯЁ][а-яё ]+$")

    def test_writing_tools_are_not_offered(self):
        names = {schema["function"]["name"] for schema in _tools().schemas()}
        self.assertNotIn("add_course_to_schedule", names)
        self.assertTrue(set(OWN_TOOLS) <= names)
        self.assertIn("get_schedule", names)
        self.assertIn("propose_move_blocks", names)

    def test_unknown_tool_does_not_raise(self):
        self.assertEqual(_tools().run("delete_everything", {})["error"], "unknown_tool")
        self.assertEqual(_tools().run("add_course_to_schedule", {})["error"], "unknown_tool")

    def test_a_failing_tool_does_not_break_the_answer(self):
        tools = _tools()
        original = OWN_TOOLS["list_habits"]
        try:
            OWN_TOOLS["list_habits"] = type(original)(
                original.name, original.label, original.description, original.parameters, lambda args, ctx: 1 / 0
            )
            self.assertEqual(tools.run("list_habits", {})["error"], "tool_failed")
        finally:
            OWN_TOOLS["list_habits"] = original

    def test_rules_know_today(self):
        tools = _tools()
        note = tools.system_note()
        self.assertIn(tools.context.today.isoformat(), note)
        self.assertIn("«Применить»", note)


class ChooseToolsTests(TestCase):
    """Модель получает только то, о чём речь: описания инструментов это токены на каждом круге."""

    def test_plain_study_question_needs_nothing(self):
        for question in ("Что такое производная?", "Объясни теорему Пифагора", "Реши уравнение x^2 = 4"):
            self.assertEqual(choose_tools(question), (), question)

    def test_area_words_open_only_that_area(self):
        self.assertEqual(set(choose_tools("Какие у меня привычки")) & set(OWN_TOOLS) >= {"list_habits", "propose_mark_habit"}, True)
        goals = choose_tools("Подними прогресс цели")
        self.assertIn("propose_goal_progress", goals)
        self.assertNotIn("propose_mark_habit", goals)
        self.assertNotIn("get_schedule", goals)
        self.assertIn("get_diary", choose_tools("Что задали по физике"))
        self.assertIn("propose_move_blocks", choose_tools("Перенеси физику"))
        self.assertIn("get_focus_stats", choose_tools("Сколько я занимался по таймеру"))

    def test_his_day_opens_reading_but_not_changes(self):
        names = choose_tools("Что у меня завтра?")
        self.assertIn("get_schedule", names)
        self.assertIn("get_diary", names)
        self.assertFalse([name for name in names if name.startswith("propose_")])

    def test_unclear_request_gets_everything(self):
        names = choose_tools("Запиши это")
        self.assertIn("propose_new_goal", names)
        self.assertIn("propose_move_blocks", names)

    def test_page_says_what_it_is_about(self):
        self.assertIn("propose_new_habit", choose_tools("Читать двадцать минут", page="habits"))
        self.assertEqual(choose_tools("Читать двадцать минут", page="now"), ())

    def test_strange_page_does_not_break_the_question(self):
        self.assertEqual(choose_tools("Что такое производная?", page=["habits"]), ())

    def test_follow_up_keeps_the_subject(self):
        self.assertIn("get_schedule", choose_tools("а завтра?", previous="Что в расписании сегодня"))

    def test_planning_mode_sees_goals_and_schedule(self):
        names = choose_tools("Сдать химию", mode="plan")
        self.assertIn("list_goals", names)
        self.assertIn("get_schedule", names)

    def test_nothing_chosen_still_leaves_a_way_in(self):
        tools = _tools()
        tools.choose("Что такое производная?")
        self.assertEqual([row["function"]["name"] for row in tools.schemas()], [OPEN_ALL_TOOL])
        self.assertLess(len(tools.system_note()), 300)

        answer = tools.run(OPEN_ALL_TOOL, {})

        self.assertTrue(answer["ok"])
        self.assertIn("«Применить»", answer["rules"])
        names = {row["function"]["name"] for row in tools.schemas()}
        self.assertIn("get_schedule", names)
        self.assertIn("propose_new_goal", names)
        self.assertNotIn(OPEN_ALL_TOOL, names)
