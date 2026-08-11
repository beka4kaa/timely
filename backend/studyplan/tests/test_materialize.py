"""Запись календаря в базу: полный горизонт, разная детализация, изоляция."""

from __future__ import annotations

from datetime import date, timedelta

from django.test import TestCase

from curriculum.models import (
    CourseDependency,
    CourseModule,
    CoursePlan,
    CourseTopic,
    LearningGoal,
)
from studyplan.models import (
    FixedCommitment,
    LearningBlock,
    StudySchedule,
    TemplateSlot,
    WeeklyScheduleTemplate,
)
from studyplan.services import ScheduleGenerationError, generate_schedule

OWNER = "student@example.com"
MONDAY = date(2026, 8, 17)


class SchedulePlanFixture(TestCase):
    """Общая программа: два модуля по три темы, с зависимостями."""

    topic_count = 6

    def setUp(self):
        self.goal = LearningGoal.objects.create(
            user_email=OWNER,
            original_text="Хочу разобраться в механике",
            current_level="school_basic",
            target_level="school_confident",
        )
        self.plan = CoursePlan.objects.create(
            user_email=OWNER,
            goal=self.goal,
            title="Механика, 10 класс",
            recommended_sessions_per_week=3,
            recommended_session_minutes=45,
            status=CoursePlan.Status.ACTIVE,
        )
        self.topics = []
        for module_index in range(1, 3):
            module = CourseModule.objects.create(
                plan=self.plan,
                external_id=f"m{module_index}",
                title=f"Модуль {module_index}",
                order_index=module_index,
            )
            for topic_index in range(1, 4):
                external_id = f"t{module_index}.{topic_index}"
                self.topics.append(
                    CourseTopic.objects.create(
                        module=module,
                        external_id=external_id,
                        title=f"Тема {external_id}",
                        objective=f"Цель {external_id}",
                        mastery_criteria="Решает задачи без подсказок",
                        order_index=topic_index,
                        estimated_minutes=60,
                        duration_breakdown={
                            "theory_minutes": 25,
                            "practice_minutes": 20,
                            "assessment_minutes": 15,
                            "total_minutes": 60,
                        },
                    )
                )

    def make_template(self, *, weekdays=(0, 2, 4), minutes=45, timezone_name="UTC"):
        template = WeeklyScheduleTemplate.objects.create(
            user_email=OWNER, title="Ритм", timezone=timezone_name, active=True
        )
        for weekday in weekdays:
            TemplateSlot.objects.create(
                template=template,
                weekday=weekday,
                start_time="17:00",
                duration_minutes=minutes,
            )
        return template


class GenerationTests(SchedulePlanFixture):
    def test_generates_dated_calendar_for_the_whole_horizon(self):
        outcome = generate_schedule(
            plan=self.plan,
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=90),
            template=self.make_template(),
        )
        self.assertTrue(outcome.feasible)
        blocks = list(outcome.schedule.blocks.all())
        self.assertTrue(blocks)

        for block in blocks:
            self.assertTrue(block.title)
            self.assertTrue(block.activity_type)
            self.assertGreater(block.duration_minutes, 0)
            self.assertEqual(block.user_email, OWNER)
            self.assertEqual(
                block.duration_minutes,
                int((block.end_at - block.start_at).total_seconds() // 60),
            )

    def test_every_lesson_block_knows_its_topic_and_workspace(self):
        outcome = generate_schedule(
            plan=self.plan, start_date=MONDAY, template=self.make_template()
        )
        lessons = outcome.schedule.blocks.filter(source=LearningBlock.Source.SCHEDULER)
        self.assertTrue(lessons.exists())
        for block in lessons:
            self.assertIsNotNone(block.topic_id)
            self.assertIsNotNone(block.module_id)
            self.assertTrue(block.workspace_type)
            self.assertTrue(block.objective)

    def test_near_term_blocks_are_detailed_and_far_ones_are_not(self):
        outcome = generate_schedule(
            plan=self.plan,
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=90),
            template=self.make_template(weekdays=(0,)),
            detailed_horizon_days=14,
        )
        blocks = list(outcome.schedule.blocks.order_by("start_at"))
        boundary = MONDAY + timedelta(days=14)
        detailed = [b for b in blocks if b.start_at.date() < boundary]
        outlined = [b for b in blocks if b.start_at.date() >= boundary]

        self.assertTrue(detailed)
        self.assertTrue(outlined)
        for block in detailed:
            self.assertEqual(block.detail_level, LearningBlock.DetailLevel.DETAILED)
            self.assertIn("completion", block.lesson_payload)
            self.assertEqual(
                block.lesson_payload["expected_minutes"], block.duration_minutes
            )
        for block in outlined:
            self.assertEqual(block.detail_level, LearningBlock.DetailLevel.OUTLINE)
            self.assertEqual(block.lesson_payload, {})

    def test_review_blocks_are_marked_and_linked(self):
        outcome = generate_schedule(
            plan=self.plan,
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=90),
            template=self.make_template(weekdays=(0, 1, 2, 3, 4)),
        )
        reviews = outcome.schedule.blocks.filter(source=LearningBlock.Source.REVIEW)
        self.assertTrue(reviews.exists())
        for block in reviews:
            self.assertEqual(block.activity_type, "review")
            self.assertIsNotNone(block.review_of_topic_id)
            self.assertIn(block.review_step, {0, 1, 2})
            # Повторение не выдаёт себя за прохождение новой темы.
            self.assertIsNone(block.topic_id)

    def test_prerequisite_block_ids_point_at_real_blocks(self):
        first, second = self.topics[0], self.topics[1]
        CourseDependency.objects.create(
            plan=self.plan, topic=second, depends_on=first
        )
        outcome = generate_schedule(
            plan=self.plan, start_date=MONDAY, template=self.make_template()
        )
        dependent = outcome.schedule.blocks.filter(topic=second).order_by("start_at")
        self.assertTrue(dependent.exists())
        referenced = {
            block_id
            for block in dependent
            for block_id in block.prerequisite_block_ids
        }
        self.assertTrue(referenced)
        existing = set(
            str(value)
            for value in LearningBlock.objects.filter(
                id__in=referenced
            ).values_list("id", flat=True)
        )
        self.assertEqual(referenced, existing)

    def test_fixed_commitment_is_never_covered(self):
        FixedCommitment.objects.create(
            user_email=OWNER,
            kind=FixedCommitment.Kind.SCHOOL,
            title="Школа",
            weekday=0,
            start_time="16:00",
            duration_minutes=180,
        )
        outcome = generate_schedule(
            plan=self.plan,
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=27),
            template=self.make_template(),
        )
        for block in outcome.schedule.blocks.all():
            self.assertNotEqual(
                block.start_at.weekday(), 0, "занятие попало на школьный понедельник"
            )

    def test_regeneration_replaces_blocks_of_its_own_schedule_only(self):
        first = generate_schedule(
            plan=self.plan, start_date=MONDAY, template=self.make_template()
        )
        first_ids = set(first.schedule.blocks.values_list("id", flat=True))

        second = generate_schedule(
            plan=self.plan, start_date=MONDAY, template=first.schedule.template
        )
        self.assertNotEqual(first.schedule.id, second.schedule.id)
        # Прежнее расписание не тронуто: его блоки на месте.
        self.assertEqual(
            set(first.schedule.blocks.values_list("id", flat=True)), first_ids
        )

    def test_conflict_report_is_persisted_when_plan_does_not_fit(self):
        outcome = generate_schedule(
            plan=self.plan,
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=6),
            template=self.make_template(weekdays=(0,)),
        )
        self.assertFalse(outcome.feasible)
        schedule = StudySchedule.objects.get(pk=outcome.schedule.pk)
        self.assertFalse(schedule.feasible)
        self.assertFalse(schedule.conflict_report["feasible"])
        self.assertTrue(schedule.conflict_report["unplaced"])
        self.assertTrue(schedule.conflict_report["suggestions"])

    def test_schedule_starts_as_a_proposal(self):
        outcome = generate_schedule(
            plan=self.plan, start_date=MONDAY, template=self.make_template()
        )
        self.assertEqual(outcome.schedule.status, StudySchedule.Status.PROPOSED)
        self.assertEqual(outcome.schedule.version, 1)
        self.assertTrue(outcome.schedule.pacing_snapshot["weekly_pattern"])


class TemplateFallbackTests(SchedulePlanFixture):
    def test_missing_template_is_built_from_the_course_pace(self):
        self.assertFalse(WeeklyScheduleTemplate.objects.exists())
        outcome = generate_schedule(plan=self.plan, start_date=MONDAY)
        template = outcome.schedule.template
        self.assertEqual(template.slots.count(), 3)
        self.assertEqual(
            sorted(template.slots.values_list("weekday", flat=True)), [0, 2, 4]
        )
        self.assertTrue(outcome.schedule.blocks.exists())

    def test_plan_without_topics_is_rejected_loudly(self):
        CourseTopic.objects.all().delete()
        with self.assertRaises(ScheduleGenerationError):
            generate_schedule(plan=self.plan, start_date=MONDAY)


class TimezoneTests(SchedulePlanFixture):
    def test_local_rhythm_is_preserved_in_stored_utc(self):
        outcome = generate_schedule(
            plan=self.plan,
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=27),
            timezone_name="Europe/Moscow",
            template=self.make_template(timezone_name="Europe/Moscow"),
        )
        # 17:00 в Москве — это 14:00 UTC, и в базе обязано лежать именно UTC.
        starts = {block.start_at.hour for block in outcome.schedule.blocks.all()}
        self.assertTrue(starts)
        self.assertTrue(min(starts) >= 14)
        self.assertEqual(outcome.schedule.timezone, "Europe/Moscow")
