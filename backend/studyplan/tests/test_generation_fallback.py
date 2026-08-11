"""Что происходит с календарём, когда модель ритма врёт, падает или молчит."""

from __future__ import annotations

from datetime import timedelta
from unittest import mock

from studyplan.scheduling.contracts import LessonPart, PacingPlan, TopicPacing
from studyplan.scheduling.pacing import build_lesson_parts
from studyplan.services import generate_schedule

from .test_materialize import MONDAY, SchedulePlanFixture


class _FakeProvider:
    """Провайдер, чьё поведение задаёт тест."""

    name = "fake"

    def __init__(self, builder):
        self._builder = builder

    def generate_pacing(self, request):
        return self._builder(request)


def _sane_plan(request) -> PacingPlan:
    """Корректный ритм с узнаваемой разбивкой: 30 минут теории и 15 проверки."""
    pacing = []
    for topic in request.topics:
        pacing.append(
            TopicPacing(
                topic_id=topic.topic_id,
                topic_external_id=topic.external_id,
                lesson_parts=build_lesson_parts(
                    topic,
                    max_part_minutes=request.session_minutes,
                    part_plan=[("theory", 30), ("assessment", 15)],
                ),
                title=topic.title,
                module_external_id=topic.module_external_id,
            )
        )
    return PacingPlan(
        weekly_pattern=(),
        topic_pacing=tuple(pacing),
        buffer_percentage=0.1,
        rationale="Фальшивый, но корректный ритм.",
    )


def _plan_missing_a_topic(request) -> PacingPlan:
    plan = _sane_plan(request)
    return PacingPlan(
        weekly_pattern=plan.weekly_pattern,
        topic_pacing=plan.topic_pacing[1:],
        buffer_percentage=plan.buffer_percentage,
    )


def _plan_with_invented_topic(request) -> PacingPlan:
    invented = TopicPacing(
        topic_id="выдуманная-тема",
        topic_external_id="ghost",
        lesson_parts=(
            LessonPart(
                topic_id="выдуманная-тема",
                topic_external_id="ghost",
                module_external_id="m1",
                part_index=0,
                activity_type="theory",
                duration_minutes=30,
                title="Призрак",
            ),
        ),
    )
    plan = _sane_plan(request)
    return PacingPlan(
        weekly_pattern=plan.weekly_pattern,
        topic_pacing=plan.topic_pacing + (invented,),
        buffer_percentage=plan.buffer_percentage,
    )


class PacingFallbackTests(SchedulePlanFixture):
    def _generate(self, builder=None, *, raises=False):
        if raises:
            provider = _FakeProvider(
                lambda request: (_ for _ in ()).throw(RuntimeError("провайдер лёг"))
            )
        else:
            provider = _FakeProvider(builder)

        with mock.patch(
            "studyplan.services.get_pacing_provider", return_value=provider
        ):
            return generate_schedule(
                plan=self.plan,
                start_date=MONDAY,
                end_date=MONDAY + timedelta(days=41),
                template=self.make_template(),
            )

    def test_valid_pacing_from_the_model_is_used(self):
        outcome = self._generate(_sane_plan)
        durations = {
            block.duration_minutes
            for block in outcome.schedule.blocks.filter(activity_type="theory")
        }
        self.assertEqual(durations, {30})
        self.assertEqual(outcome.schedule.generation_source, "fake")
        self.assertTrue(outcome.schedule.pacing_snapshot["validation"]["approved"])
        self.assertNotIn("pacing_model_rejected", outcome.warnings)

    def test_provider_failure_falls_back_without_losing_the_calendar(self):
        outcome = self._generate(raises=True)
        self.assertIn("pacing_provider_failed", outcome.warnings)
        self.assertTrue(outcome.schedule.blocks.exists())
        # Разбивка снова из программы: 25 минут теории, а не 30.
        durations = {
            block.duration_minutes
            for block in outcome.schedule.blocks.filter(activity_type="theory")
        }
        self.assertEqual(durations, {25})

    def test_missing_topic_is_rejected_and_the_course_stays_whole(self):
        outcome = self._generate(_plan_missing_a_topic)
        self.assertIn("pacing_model_rejected", outcome.warnings)
        scheduled_topics = set(
            outcome.schedule.blocks.exclude(topic=None).values_list(
                "topic_id", flat=True
            )
        )
        self.assertEqual(len(scheduled_topics), self.topic_count)

    def test_invented_topic_is_rejected(self):
        outcome = self._generate(_plan_with_invented_topic)
        self.assertIn("pacing_model_rejected", outcome.warnings)
        issues = outcome.schedule.pacing_snapshot["validation"]["issues"]
        self.assertIn("unknown_topic", {issue["kind"] for issue in issues})
        self.assertFalse(
            outcome.schedule.blocks.filter(title__icontains="Призрак").exists()
        )

    def test_model_weekly_pattern_stays_a_proposal(self):
        """Построение календаря не переписывает ритм, настроенный руками."""

        def with_pattern(request):
            from studyplan.scheduling.contracts import WeeklyPatternDay

            plan = _sane_plan(request)
            return PacingPlan(
                weekly_pattern=(
                    WeeklyPatternDay(
                        weekday=6, activity_types=("theory",), preferred_duration_minutes=90
                    ),
                ),
                topic_pacing=plan.topic_pacing,
                buffer_percentage=plan.buffer_percentage,
            )

        outcome = self._generate(with_pattern)
        snapshot = outcome.schedule.pacing_snapshot
        self.assertEqual(snapshot["proposed_weekly_pattern"][0]["weekday"], 6)
        # А календарь всё равно построен по шаблону: пн/ср/пт, не воскресенье.
        weekdays = {
            block.start_at.weekday() for block in outcome.schedule.blocks.all()
        }
        self.assertEqual(weekdays - {0, 2, 4}, set())
