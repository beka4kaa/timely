"""Программа → части урока."""

from __future__ import annotations

from datetime import time

from django.test import SimpleTestCase

from studyplan.scheduling.contracts import MIN_PART_MINUTES
from studyplan.scheduling.pacing import (
    TopicInput,
    build_lesson_parts,
    default_template,
    weekly_pattern_from_template,
    workspace_for,
)

from .factories import slot, template, topic


class LessonPartTests(SimpleTestCase):
    def test_small_topic_gives_three_parts_in_pedagogical_order(self):
        parts = build_lesson_parts(topic("t1", theory=25, practice=20, assessment=15))
        self.assertEqual(
            [part.activity_type for part in parts],
            ["theory", "independent_practice", "assessment"],
        )
        self.assertEqual([part.duration_minutes for part in parts], [25, 20, 15])

    def test_assessment_is_always_last(self):
        parts = build_lesson_parts(topic("t1", theory=60, practice=90, assessment=15))
        self.assertEqual(parts[-1].activity_type, "assessment")
        self.assertEqual(
            [part.activity_type for part in parts].count("assessment"), 1
        )

    def test_large_theory_splits_into_explanation_and_example(self):
        parts = build_lesson_parts(topic("t1", theory=50, practice=0, assessment=0))
        self.assertEqual(
            [part.activity_type for part in parts], ["theory", "guided_example"]
        )
        self.assertEqual(sum(part.duration_minutes for part in parts), 50)

    def test_large_practice_starts_guided_and_ends_independent(self):
        parts = build_lesson_parts(topic("t1", theory=0, practice=60, assessment=0))
        self.assertEqual(
            [part.activity_type for part in parts],
            ["guided_practice", "independent_practice"],
        )
        self.assertEqual(sum(part.duration_minutes for part in parts), 60)

    def test_part_longer_than_session_is_chunked(self):
        parts = build_lesson_parts(
            topic("t1", theory=0, practice=150, assessment=0), max_part_minutes=45
        )
        practice = [p for p in parts if p.activity_type == "independent_practice"]
        self.assertTrue(all(p.duration_minutes <= 45 for p in practice))
        self.assertEqual(sum(part.duration_minutes for part in parts), 150)

    def test_chunking_never_leaves_a_stub(self):
        # 95 минут при занятии 45 дали бы 45 + 45 + 5; пятиминутка доливается.
        parts = build_lesson_parts(
            topic("t1", theory=0, practice=95, assessment=0), max_part_minutes=45
        )
        self.assertTrue(
            all(part.duration_minutes >= MIN_PART_MINUTES for part in parts)
        )
        self.assertEqual(sum(part.duration_minutes for part in parts), 95)

    def test_missing_breakdown_falls_back_to_course_split(self):
        # План, построенный до появления duration_breakdown: словарь пуст, но
        # части обязаны получиться, а не обнулиться.
        legacy = TopicInput(
            topic_id="id-legacy",
            external_id="legacy",
            module_external_id="m1",
            title="Старая тема",
            estimated_minutes=60,
            duration_breakdown={},
        )
        parts = build_lesson_parts(legacy)
        self.assertTrue(parts)
        self.assertEqual(sum(part.duration_minutes for part in parts), 60)

    def test_topic_without_any_minutes_still_gets_a_block(self):
        empty = TopicInput(
            topic_id="id-x",
            external_id="x",
            module_external_id="m1",
            title="Без времени",
            estimated_minutes=0,
            duration_breakdown={},
        )
        parts = build_lesson_parts(empty)
        self.assertEqual(len(parts), 1)
        self.assertEqual(parts[0].duration_minutes, MIN_PART_MINUTES)

    def test_mastery_criteria_lands_on_the_assessment_part(self):
        parts = build_lesson_parts(topic("t1"))
        criteria = {p.activity_type: p.mastery_criteria for p in parts}
        self.assertEqual(criteria["assessment"], "Решает задачи без подсказок")
        self.assertEqual(criteria["theory"], "")


class DefaultTemplateTests(SimpleTestCase):
    def test_three_sessions_spread_across_the_week(self):
        spec = default_template(
            sessions_per_week=3, session_minutes=45, timezone_name="UTC"
        )
        self.assertEqual([s.weekday for s in spec.slots], [0, 2, 4])

    def test_pace_is_clamped_to_a_real_week(self):
        spec = default_template(
            sessions_per_week=99, session_minutes=45, timezone_name="UTC"
        )
        self.assertEqual(len(spec.slots), 7)

    def test_start_time_is_respected(self):
        spec = default_template(
            sessions_per_week=1,
            session_minutes=30,
            timezone_name="UTC",
            start_time=time(9, 30),
        )
        self.assertEqual(spec.slots[0].start_time, time(9, 30))
        self.assertEqual(spec.slots[0].duration_minutes, 30)


class WeeklyPatternTests(SimpleTestCase):
    def test_pattern_describes_the_template(self):
        spec = template(slot(0, allowed=("theory",)), slot(2, allowed=("review",)))
        pattern = weekly_pattern_from_template(spec)
        self.assertEqual([day.weekday for day in pattern], [0, 2])
        self.assertEqual(pattern[0].activity_types, ("theory",))


class WorkspaceTests(SimpleTestCase):
    def test_activity_selects_the_environment(self):
        self.assertEqual(workspace_for("theory"), "tutor_chat")
        self.assertEqual(workspace_for("assessment"), "quiz")
        self.assertEqual(workspace_for("coding"), "built_in_code_editor")

    def test_unknown_activity_falls_back_to_tutor(self):
        self.assertEqual(workspace_for("nonsense"), "tutor_chat")
