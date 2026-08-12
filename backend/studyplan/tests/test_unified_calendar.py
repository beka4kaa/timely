"""Общий календарь: единая лента курсов, занятость и глобальные конфликты."""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone

from django.test import SimpleTestCase

from curriculum.models import CoursePlan, LearningGoal
from studyplan.models import FixedCommitment, LearningBlock, StudySchedule
from studyplan.revisions import (
    BlockMove,
    RevisionRejected,
    confirm_revision,
    propose_moves,
)
from studyplan.scheduling.engine import build_schedule
from studyplan.services import (
    ScheduleNotConfirmable,
    _study_minutes_by_local_day,
    confirm_schedule,
    generate_schedule,
)

from .factories import request, slot, template, topic
from .test_api import headers
from .test_materialize import MONDAY, OWNER, SchedulePlanFixture

UTC = timezone.utc


class UnifiedCalendarFixture(SchedulePlanFixture):
    def setUp(self):
        super().setUp()
        self.template = self.make_template()

    def make_plan(self, *, title: str = "Алгебра", email: str = OWNER) -> CoursePlan:
        goal = self.goal
        if email != OWNER:
            goal = LearningGoal.objects.create(
                user_email=email,
                original_text=f"Изучить {title}",
                current_level="beginner",
                target_level="confident",
            )
        return CoursePlan.objects.create(
            user_email=email,
            goal=goal,
            title=title,
            status=CoursePlan.Status.ACTIVE,
        )

    def make_schedule(
        self,
        plan: CoursePlan | None = None,
        *,
        status: str = StudySchedule.Status.ACTIVE,
        conflict_report: dict | None = None,
    ) -> StudySchedule:
        plan = plan or self.plan
        return StudySchedule.objects.create(
            user_email=plan.user_email,
            course_plan=plan,
            template=self.template,
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=90),
            timezone=self.template.timezone,
            status=status,
            conflict_report=conflict_report or {},
        )

    def make_block(
        self,
        schedule: StudySchedule,
        *,
        start_at: datetime,
        minutes: int = 45,
        title: str = "Урок",
        status: str = LearningBlock.Status.SCHEDULED,
    ) -> LearningBlock:
        return LearningBlock.objects.create(
            user_email=schedule.user_email,
            schedule=schedule,
            course_plan=schedule.course_plan,
            title=title,
            start_at=start_at,
            end_at=start_at + timedelta(minutes=minutes),
            duration_minutes=minutes,
            status=status,
        )


class UnifiedFeedTests(UnifiedCalendarFixture):
    def test_feed_uses_newest_feasible_schedule_and_returns_move_metadata(self):
        active = self.make_schedule(status=StudySchedule.Status.ACTIVE)
        self.make_block(
            active,
            start_at=datetime(2026, 8, 17, 17, tzinfo=UTC),
            title="Старый урок",
        )
        proposed = self.make_schedule(status=StudySchedule.Status.PROPOSED)
        expected = self.make_block(
            proposed,
            start_at=datetime(2026, 8, 19, 17, tzinfo=UTC),
            title="Новый урок",
        )

        response = self.client.get("/api/learning-blocks/", **headers())

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual([item["id"] for item in response.json()], [str(expected.id)])
        payload = response.json()[0]
        self.assertEqual(payload["schedule_version"], proposed.version)
        self.assertEqual(payload["schedule_status"], proposed.status)
        self.assertEqual(payload["schedule_timezone"], proposed.timezone)
        self.assertEqual(payload["course_plan_title"], self.plan.title)

        listed = self.client.get("/api/study-schedules/", **headers()).json()
        proposal_payload = next(
            item for item in listed if item["id"] == str(proposed.id)
        )
        self.assertTrue(
            {"template", "conflict_report", "warnings", "updated_at"}
            <= proposal_payload.keys()
        )

    def test_infeasible_proposal_does_not_hide_existing_active_schedule(self):
        active = self.make_schedule(status=StudySchedule.Status.ACTIVE)
        expected = self.make_block(
            active,
            start_at=datetime(2026, 8, 17, 17, tzinfo=UTC),
            title="Рабочий урок",
        )
        proposed = self.make_schedule(
            status=StudySchedule.Status.PROPOSED,
            conflict_report={"feasible": False, "unplaced": [{"reason": "full"}]},
        )
        self.make_block(
            proposed,
            start_at=datetime(2026, 8, 19, 17, tzinfo=UTC),
            title="Неполный preview",
        )

        body = self.client.get("/api/learning-blocks/", **headers()).json()
        self.assertEqual([item["id"] for item in body], [str(expected.id)])

    def test_partial_preview_is_visible_when_course_has_no_feasible_schedule(self):
        older = self.make_schedule(
            status=StudySchedule.Status.PROPOSED,
            conflict_report={"feasible": False, "unplaced": [1]},
        )
        self.make_block(
            older,
            start_at=datetime(2026, 8, 17, 17, tzinfo=UTC),
            title="Старый preview",
        )
        newer = self.make_schedule(
            status=StudySchedule.Status.PROPOSED,
            conflict_report={"feasible": False, "unplaced": [2]},
        )
        expected = self.make_block(
            newer,
            start_at=datetime(2026, 8, 19, 17, tzinfo=UTC),
            title="Новый preview",
        )

        body = self.client.get("/api/learning-blocks/", **headers()).json()
        self.assertEqual([item["id"] for item in body], [str(expected.id)])

    def test_newer_active_wins_over_stale_proposal(self):
        stale = self.make_schedule(status=StudySchedule.Status.PROPOSED)
        self.make_block(
            stale,
            start_at=datetime(2026, 8, 17, 17, tzinfo=UTC),
            title="Старое предложение",
        )
        active = self.make_schedule(status=StudySchedule.Status.ACTIVE)
        expected = self.make_block(
            active,
            start_at=datetime(2026, 8, 19, 17, tzinfo=UTC),
            title="Подтверждённый урок",
        )

        body = self.client.get("/api/learning-blocks/", **headers()).json()
        self.assertEqual([item["id"] for item in body], [str(expected.id)])

    def test_equal_timestamp_uses_same_status_priority_as_frontend(self):
        draft = self.make_schedule(status=StudySchedule.Status.DRAFT)
        self.make_block(
            draft,
            start_at=datetime(2026, 8, 17, 17, tzinfo=UTC),
            title="Черновик",
        )
        proposed = self.make_schedule(status=StudySchedule.Status.PROPOSED)
        expected = self.make_block(
            proposed,
            start_at=datetime(2026, 8, 19, 17, tzinfo=UTC),
            title="Предложение",
        )
        same_created_at = datetime(2026, 8, 11, 12, tzinfo=UTC)
        StudySchedule.objects.filter(id__in=[draft.id, proposed.id]).update(
            created_at=same_created_at
        )

        body = self.client.get("/api/learning-blocks/", **headers()).json()
        self.assertEqual([item["id"] for item in body], [str(expected.id)])

    def test_archived_completed_and_other_users_are_not_in_the_feed(self):
        for schedule_status in (
            StudySchedule.Status.ARCHIVED,
            StudySchedule.Status.COMPLETED,
        ):
            schedule = self.make_schedule(status=schedule_status)
            self.make_block(
                schedule,
                start_at=datetime(2026, 8, 17, 17, tzinfo=UTC),
            )
        foreign_plan = self.make_plan(title="Чужой курс", email="other@example.com")
        foreign = self.make_schedule(foreign_plan)
        self.make_block(
            foreign,
            start_at=datetime(2026, 8, 17, 18, tzinfo=UTC),
        )

        self.assertEqual(
            self.client.get("/api/learning-blocks/", **headers()).json(), []
        )

    def test_range_is_half_open_and_uses_interval_overlap(self):
        schedule = self.make_schedule()
        boundary = datetime(2026, 8, 17, 10, tzinfo=UTC)
        self.make_block(
            schedule,
            start_at=boundary - timedelta(minutes=45),
            title="Закончился на from",
        )
        overlapping = self.make_block(
            schedule,
            start_at=boundary - timedelta(minutes=15),
            minutes=60,
            title="Пересекает from",
        )
        inside = self.make_block(
            schedule,
            start_at=boundary + timedelta(hours=1),
            title="Внутри",
        )
        self.make_block(
            schedule,
            start_at=boundary + timedelta(hours=2),
            title="Начался на to",
        )

        response = self.client.get(
            "/api/learning-blocks/",
            {
                "from": boundary.isoformat(),
                "to": (boundary + timedelta(hours=2)).isoformat(),
            },
            **headers(),
        )

        self.assertEqual(
            [item["id"] for item in response.json()],
            [str(overlapping.id), str(inside.id)],
        )

    def test_bare_date_range_uses_requested_timezone_across_dst(self):
        schedule = self.make_schedule()
        included = self.make_block(
            schedule,
            start_at=datetime(2026, 3, 9, 3, 30, tzinfo=UTC),
            minutes=15,
            title="23:30 по Нью-Йорку",
        )
        self.make_block(
            schedule,
            start_at=datetime(2026, 3, 9, 4, 0, tzinfo=UTC),
            minutes=15,
            title="Ровно следующий день",
        )

        response = self.client.get(
            "/api/learning-blocks/",
            {
                "from": "2026-03-08",
                "to": "2026-03-09",
                "timezone": "America/New_York",
            },
            **headers(),
        )

        self.assertEqual([item["id"] for item in response.json()], [str(included.id)])

    def test_bad_or_reversed_range_returns_structured_error(self):
        for params in (
            {"from": "yesterday"},
            {"from": "2026-08-18", "to": "2026-08-17"},
        ):
            with self.subTest(params=params):
                response = self.client.get(
                    "/api/learning-blocks/", params, **headers()
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["code"], "bad_range")


class GlobalConflictTests(UnifiedCalendarFixture):
    def setUp(self):
        super().setUp()
        self.schedule = self.make_schedule(status=StudySchedule.Status.ACTIVE)
        self.block = self.make_block(
            self.schedule,
            start_at=datetime(2026, 8, 17, 17, tzinfo=UTC),
            title="Механика",
        )
        self.target = datetime(2026, 8, 25, 17, tzinfo=UTC)

    def other_block(
        self,
        *,
        schedule_status: str = StudySchedule.Status.ACTIVE,
        block_status: str = LearningBlock.Status.SCHEDULED,
        same_course: bool = False,
        email: str = OWNER,
        start_at: datetime | None = None,
        minutes: int = 45,
    ) -> LearningBlock:
        plan = (
            self.plan
            if same_course
            else self.make_plan(title="Алгебра", email=email)
        )
        schedule = self.make_schedule(plan, status=schedule_status)
        return self.make_block(
            schedule,
            start_at=start_at or self.target,
            minutes=minutes,
            title="Алгебра",
            status=block_status,
        )

    def propose_target(self, start_at: datetime | None = None):
        return propose_moves(
            self.schedule,
            moves=[
                BlockMove(
                    block_id=str(self.block.id), start_at=start_at or self.target
                )
            ],
        )

    def test_active_and_proposed_other_courses_block_a_move(self):
        for schedule_status in (
            StudySchedule.Status.ACTIVE,
            StudySchedule.Status.PROPOSED,
        ):
            with self.subTest(schedule_status=schedule_status):
                other = self.other_block(schedule_status=schedule_status)
                with self.assertRaises(RevisionRejected):
                    self.propose_target()
                other.schedule.delete()

    def test_non_occupying_versions_blocks_and_users_are_ignored(self):
        cases = (
            {"schedule_status": StudySchedule.Status.ARCHIVED},
            {"schedule_status": StudySchedule.Status.COMPLETED},
            {"block_status": LearningBlock.Status.CANCELLED},
            {"block_status": LearningBlock.Status.RESCHEDULED},
            {"same_course": True},
            {"email": "other@example.com"},
        )
        for kwargs in cases:
            with self.subTest(kwargs=kwargs):
                other = self.other_block(**kwargs)
                revision = self.propose_target()
                revision.delete()
                other.schedule.delete()

    def test_adjacent_other_course_block_is_allowed(self):
        other = self.other_block(
            start_at=self.target - timedelta(minutes=45), minutes=45
        )
        revision = self.propose_target()
        self.assertIsNotNone(revision.pk)
        other.schedule.delete()

    def test_move_respects_global_daily_load_limit(self):
        self.template.max_minutes_per_day = 60
        self.template.save(update_fields=["max_minutes_per_day", "updated_at"])
        self.other_block(start_at=self.target.replace(hour=15))

        with self.assertRaises(RevisionRejected):
            self.propose_target()

    def test_move_respects_global_weekly_load_limit(self):
        self.template.max_minutes_per_week = 60
        self.template.save(update_fields=["max_minutes_per_week", "updated_at"])
        self.other_block(
            start_at=(self.target - timedelta(days=1)).replace(hour=15)
        )

        with self.assertRaises(RevisionRejected):
            self.propose_target()

    def test_confirmation_rechecks_other_courses_after_proposal(self):
        revision = self.propose_target()
        self.other_block()

        with self.assertRaises(RevisionRejected):
            confirm_revision(revision)
        self.block.refresh_from_db()
        self.assertNotEqual(self.block.start_at, self.target)

    def test_schedule_confirmation_rechecks_new_fixed_commitments(self):
        self.schedule.status = StudySchedule.Status.PROPOSED
        self.schedule.save(update_fields=["status", "updated_at"])
        FixedCommitment.objects.create(
            user_email=OWNER,
            title="Школа",
            start_at=self.block.start_at,
            end_at=self.block.end_at,
        )

        with self.assertRaises(ScheduleNotConfirmable):
            confirm_schedule(self.schedule)

    def test_confirmation_archives_same_course_draft_alternative(self):
        self.schedule.status = StudySchedule.Status.PROPOSED
        self.schedule.save(update_fields=["status", "updated_at"])
        draft = self.make_schedule(status=StudySchedule.Status.DRAFT)

        confirm_schedule(self.schedule)

        draft.refresh_from_db()
        self.assertEqual(draft.status, StudySchedule.Status.ARCHIVED)


class GlobalGenerationTests(UnifiedCalendarFixture):
    def test_generation_avoids_visible_blocks_of_other_courses(self):
        other_plan = self.make_plan()
        other_schedule = self.make_schedule(other_plan)
        occupied = self.make_block(
            other_schedule,
            start_at=datetime(2026, 8, 17, 17, tzinfo=UTC),
            title="Алгебра",
        )

        outcome = generate_schedule(
            plan=self.plan,
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=41),
            template=self.template,
        )

        for block in outcome.blocks:
            self.assertFalse(
                block.start_at < occupied.end_at and occupied.start_at < block.end_at
            )

    def test_same_course_schedule_is_an_alternative_not_an_obstacle(self):
        first = generate_schedule(
            plan=self.plan,
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=41),
            template=self.template,
        )
        second = generate_schedule(
            plan=self.plan,
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=41),
            template=self.template,
        )
        self.assertEqual(
            [block.start_at for block in first.blocks],
            [block.start_at for block in second.blocks],
        )

    def test_existing_template_timezone_is_canonical(self):
        bishkek = self.make_template(timezone_name="Asia/Bishkek")
        outcome = generate_schedule(
            plan=self.plan,
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=14),
            timezone_name="America/New_York",
            template=bishkek,
        )
        first = min(outcome.blocks, key=lambda item: item.start_at)
        self.assertEqual(outcome.schedule.timezone, "Asia/Bishkek")
        self.assertEqual(first.start_at.astimezone(timezone.utc).hour, 11)

    def test_cross_midnight_load_is_split_between_calendar_days(self):
        other_plan = self.make_plan()
        schedule = self.make_schedule(other_plan)
        block = self.make_block(
            schedule,
            start_at=datetime(2026, 8, 17, 23, 30, tzinfo=UTC),
            minutes=60,
        )
        self.assertEqual(
            _study_minutes_by_local_day([block], "UTC"),
            ((MONDAY, 30), (MONDAY + timedelta(days=1), 30)),
        )


class ExistingLoadEngineTests(SimpleTestCase):
    def test_daily_and_weekly_limits_include_other_course_minutes(self):
        spec = template(
            slot(0, hour=17),
            slot(2, hour=17),
            max_day=45,
            max_week=45,
        )
        base = request(
            topics=[topic("t1", theory=15, practice=0, assessment=0)],
            spec=spec,
            start=MONDAY,
            end=MONDAY + timedelta(days=6),
            buffer=0,
        )
        draft = build_schedule(
            replace(base, existing_study_minutes=((MONDAY, 30), (MONDAY, 15)))
        )
        self.assertEqual(draft.blocks, ())
        self.assertEqual(draft.conflict.available_minutes, 0)
