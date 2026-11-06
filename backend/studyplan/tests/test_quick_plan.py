"""Предмет и занятия одним действием: пути, занятое время, предпросмотр и отмена."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from datetime import timezone as dt_timezone
from unittest import mock

from django.test import TestCase

from curriculum.models import (
    CourseModule,
    CoursePlan,
    CourseTopic,
    Document,
    LearningGoal,
    StudyMaterial,
    SubjectChat,
)
from curriculum.services import plans as plans_service
from diary.models import TemplateLesson, WeeklyTemplate
from studyplan.models import (
    FixedCommitment,
    LearningBlock,
    StudySchedule,
    TemplateSlot,
    WeeklyScheduleTemplate,
)
from studyplan.quick_plan import (
    QuickPlanRejected,
    QuickPlanRequest,
    apply_quick_plan,
    preview_quick_plan,
    undo_quick_plan,
)
from studyplan.revisions import BlockMove, RevisionRejected, propose_moves
from studyplan.serializers import StudyScheduleListSerializer
from studyplan.services import generate_schedule

OWNER = "owner@example.com"
STRANGER = "stranger@example.com"
MONDAY = date(2026, 11, 9)
FRIDAY = date(2026, 11, 13)
TODAY = date(2026, 11, 6)
ZONE = "Asia/Almaty"


def request(**overrides) -> QuickPlanRequest:
    fields = {
        "user_email": OWNER,
        "subject": "Русский язык",
        "timezone": ZONE,
        "weekdays": (0, 1, 2, 3, 4),
        "start_time": time(16, 0),
        "minutes": 60,
        "from_date": MONDAY,
        "to_date": FRIDAY,
    }
    fields.update(overrides)
    return QuickPlanRequest(**fields)


def just_a_subject(**overrides) -> QuickPlanRequest:
    fields = {"user_email": OWNER, "subject": "Русский язык", "timezone": ZONE}
    fields.update(overrides)
    return QuickPlanRequest(**fields)


def blocks_of(schedule_id) -> list[LearningBlock]:
    return list(LearningBlock.objects.filter(schedule_id=schedule_id).order_by("start_at"))


def book_plan(*, topics: int = 30, status: str = CoursePlan.Status.ACTIVE, text: str = "Русский язык"):
    goal = LearningGoal.objects.create(
        user_email=OWNER,
        original_text=text,
        normalized_subject=text,
        normalization_confirmed=True,
        status=LearningGoal.Status.CONFIRMED,
    )
    document = Document.objects.create(user_email=OWNER, goal=goal, title="Учебник")
    plan = CoursePlan.objects.create(
        user_email=OWNER,
        goal=goal,
        document=document,
        title=text,
        recommended_sessions_per_week=3,
        recommended_session_minutes=45,
        status=status,
    )
    module = CourseModule.objects.create(plan=plan, external_id="m1", title="Модуль", order_index=1)
    for index in range(1, topics + 1):
        CourseTopic.objects.create(
            module=module,
            external_id=f"t{index}",
            title=f"Тема {index}",
            order_index=index,
            estimated_minutes=60,
            duration_breakdown={
                "theory_minutes": 25,
                "practice_minutes": 20,
                "assessment_minutes": 15,
                "total_minutes": 60,
            },
        )
    return goal, plan


class QuickPlanFixture(TestCase):
    def setUp(self):
        patcher = mock.patch("studyplan.quick_plan.today_in", return_value=TODAY)
        patcher.start()
        self.addCleanup(patcher.stop)


class NewSubjectTests(QuickPlanFixture):
    def test_new_subject_gets_one_block_per_day(self):
        result = apply_quick_plan(request())

        blocks = blocks_of(result.schedule_id)
        self.assertEqual((result.path, result.sessions, result.created_goal), ("new_sessions", 5, True))
        self.assertEqual([block.duration_minutes for block in blocks], [60] * 5)
        self.assertEqual(blocks[0].title, "Русский язык, занятие 1")
        self.assertEqual(blocks[-1].title, "Русский язык, занятие 5")
        self.assertEqual(StudySchedule.objects.get(pk=result.schedule_id).status, "active")
        self.assertEqual((result.first_date, result.last_date), (MONDAY, FRIDAY))

    def test_time_is_the_students(self):
        result = apply_quick_plan(request())

        # 16:00 в Алматы это 11:00 UTC.
        self.assertEqual(
            blocks_of(result.schedule_id)[0].start_at,
            datetime(2026, 11, 9, 11, 0, tzinfo=dt_timezone.utc),
        )

    def test_preview_leaves_nothing(self):
        result = preview_quick_plan(request())

        self.assertEqual(result.sessions, 5)
        self.assertEqual(result.path, "new_sessions")
        self.assertFalse(LearningGoal.objects.filter(user_email=OWNER).exists())
        self.assertFalse(StudySchedule.objects.filter(user_email=OWNER).exists())
        self.assertFalse(WeeklyScheduleTemplate.objects.filter(user_email=OWNER).exists())

    def test_a_subject_without_a_schedule(self):
        result = apply_quick_plan(just_a_subject())

        self.assertEqual((result.path, result.schedule_id, result.sessions), ("subject_only", None, 0))
        self.assertTrue(LearningGoal.objects.filter(pk=result.goal_id, user_email=OWNER).exists())
        self.assertFalse(StudySchedule.objects.filter(user_email=OWNER).exists())

    def test_the_same_subject_without_days_is_already_there(self):
        apply_quick_plan(just_a_subject())

        with self.assertRaises(QuickPlanRejected) as caught:
            apply_quick_plan(just_a_subject(subject="русский ЯЗЫК"))
        self.assertEqual(caught.exception.code, "already_exists")

    def test_one_day_needs_no_weekdays(self):
        result = apply_quick_plan(request(weekdays=(), from_date=MONDAY, to_date=MONDAY))

        self.assertEqual((result.sessions, result.first_date, result.last_date), (1, MONDAY, MONDAY))

    def test_today_counts_only_if_the_time_has_not_passed(self):
        with mock.patch(
            "studyplan.quick_plan.django_timezone.now",
            return_value=datetime(2026, 11, 6, 13, 0, tzinfo=dt_timezone.utc),  # 18:00 в Алматы
        ):
            evening = preview_quick_plan(request(from_date=TODAY, to_date=MONDAY, weekdays=(4, 0), start_time=time(19, 0)))
            passed = preview_quick_plan(request(from_date=TODAY, to_date=MONDAY, weekdays=(4, 0), start_time=time(16, 0)))

        self.assertEqual((evening.sessions, evening.first_date), (2, TODAY))
        self.assertEqual((passed.sessions, passed.first_date), (1, MONDAY))

    def test_a_subject_is_recognised_whatever_the_case(self):
        apply_quick_plan(just_a_subject())

        result = apply_quick_plan(request(subject="русский  ЯЗЫК"))

        self.assertFalse(result.created_goal)
        self.assertEqual(LearningGoal.objects.filter(user_email=OWNER).count(), 1)

    def test_a_block_without_a_book_has_a_topic_for_the_calendar(self):
        result = apply_quick_plan(request())

        block = blocks_of(result.schedule_id)[0]
        self.assertIsNotNone(block.topic_id)
        self.assertEqual(block.source, LearningBlock.Source.SCHEDULER)
        self.assertEqual(block.detail_level, LearningBlock.DetailLevel.OUTLINE)


class BusyTimeTests(QuickPlanFixture):
    def assert_busy(self, *, about: str):
        with self.assertRaises(QuickPlanRejected) as caught:
            preview_quick_plan(request())
        self.assertEqual(caught.exception.code, "busy")
        self.assertIn("11 ноября", str(caught.exception))
        self.assertIn(about, str(caught.exception))

    def test_a_commitment_blocks_the_card(self):
        FixedCommitment.objects.create(
            user_email=OWNER, title="Репетитор", weekday=2, start_time=time(15, 30), duration_minutes=90
        )
        self.assert_busy(about="Репетитор")

    def test_another_subject_blocks_the_card(self):
        apply_quick_plan(request(subject="Физика", weekdays=(2,), from_date=MONDAY, to_date=FRIDAY))
        self.assert_busy(about="Физика")

    def test_a_school_lesson_blocks_the_card(self):
        template = WeeklyTemplate.objects.create(id="t1", user_email=OWNER, name="Школа", is_active=True)
        TemplateLesson.objects.create(
            template=template,
            day_of_week="wednesday",
            lesson_number=7,
            start_time="16:30",
            end_time="17:15",
            block_type="lesson",
            label="Алгебра",
        )
        self.assert_busy(about="Алгебра")

    def test_a_break_in_the_school_day_does_not_block(self):
        template = WeeklyTemplate.objects.create(id="t1", user_email=OWNER, name="Школа", is_active=True)
        TemplateLesson.objects.create(
            template=template,
            day_of_week="wednesday",
            lesson_number=7,
            start_time="16:30",
            end_time="16:45",
            block_type="break",
        )

        self.assertEqual(preview_quick_plan(request()).sessions, 5)

    def test_someone_elses_calendar_does_not_block(self):
        FixedCommitment.objects.create(
            user_email=STRANGER, title="Чужое", weekday=2, start_time=time(15, 30), duration_minutes=90
        )

        self.assertEqual(preview_quick_plan(request()).sessions, 5)

    def test_calendar_changed_since_preview(self):
        preview_quick_plan(request())
        FixedCommitment.objects.create(
            user_email=OWNER, title="Репетитор", weekday=2, start_time=time(15, 30), duration_minutes=90
        )

        with self.assertRaises(QuickPlanRejected) as caught:
            apply_quick_plan(request())
        self.assertEqual(caught.exception.code, "busy")
        self.assertFalse(LearningGoal.objects.filter(user_email=OWNER).exists())


class BadPeriodTests(QuickPlanFixture):
    def assert_rejected(self, code: str, **overrides):
        with self.assertRaises(QuickPlanRejected) as caught:
            preview_quick_plan(request(**overrides))
        self.assertEqual(caught.exception.code, code)

    def test_the_end_before_the_start(self):
        self.assert_rejected("bad_request", to_date=MONDAY - timedelta(days=1))

    def test_days_without_a_time(self):
        self.assert_rejected("bad_request", start_time=None)

    def test_days_without_a_period(self):
        self.assert_rejected("bad_request", from_date=None)

    def test_an_empty_name(self):
        self.assert_rejected("bad_request", subject="   ")

    def test_too_short(self):
        self.assert_rejected("bad_request", minutes=5)

    def test_too_long_a_session(self):
        self.assert_rejected("bad_request", minutes=500)

    def test_a_past_date(self):
        self.assert_rejected("past_period", from_date=TODAY - timedelta(days=1))

    def test_no_day_fits(self):
        # Понедельник–пятница, а просили субботу.
        self.assert_rejected("empty_period", weekdays=(5,))

    def test_a_period_of_too_many_days(self):
        self.assert_rejected("too_long", to_date=MONDAY + timedelta(days=120))


class ExistingScheduleTests(QuickPlanFixture):
    def test_an_existing_schedule_gets_extra_sessions(self):
        first = apply_quick_plan(request())
        second = apply_quick_plan(
            request(from_date=MONDAY + timedelta(days=7), to_date=FRIDAY + timedelta(days=7))
        )

        self.assertEqual((second.path, second.schedule_id), ("extra_sessions", first.schedule_id))
        self.assertEqual(second.sessions, 5)
        blocks = blocks_of(first.schedule_id)
        self.assertEqual(len(blocks), 10)
        self.assertEqual(blocks[-1].title, "Русский язык, занятие 10")
        self.assertEqual(blocks[-1].source, LearningBlock.Source.MANUAL)
        self.assertIsNone(blocks[-1].topic_id)

        schedule = StudySchedule.objects.get(pk=first.schedule_id)
        self.assertEqual(schedule.end_date, FRIDAY + timedelta(days=7))
        self.assertEqual(schedule.version, 2)

    def test_one_day_is_a_single_extra_session(self):
        first = apply_quick_plan(request())
        day = MONDAY + timedelta(days=7)

        result = apply_quick_plan(request(from_date=day, to_date=day, weekdays=(day.weekday(),)))

        self.assertEqual((result.path, result.sessions), ("extra_sessions", 1))
        self.assertEqual(result.schedule_id, first.schedule_id)

    def test_extra_sessions_keep_the_numbering_without_cancelled_ones(self):
        first = apply_quick_plan(request())
        LearningBlock.objects.filter(pk=blocks_of(first.schedule_id)[4].pk).update(
            status=LearningBlock.Status.CANCELLED
        )
        day = MONDAY + timedelta(days=7)

        apply_quick_plan(request(from_date=day, to_date=day, weekdays=(day.weekday(),)))

        self.assertEqual(blocks_of(first.schedule_id)[-1].title, "Русский язык, занятие 5")

    def test_the_time_of_an_own_lesson_is_busy_too(self):
        apply_quick_plan(request())

        with self.assertRaises(QuickPlanRejected) as caught:
            preview_quick_plan(request())
        self.assertEqual(caught.exception.code, "busy")

    def test_preview_of_extra_sessions_leaves_nothing(self):
        first = apply_quick_plan(request())

        preview_quick_plan(request(from_date=MONDAY + timedelta(days=7), to_date=FRIDAY + timedelta(days=7)))

        self.assertEqual(len(blocks_of(first.schedule_id)), 5)
        self.assertEqual(StudySchedule.objects.get(pk=first.schedule_id).version, 1)


class BookTests(QuickPlanFixture):
    def test_a_book_takes_the_next_topics_for_the_period(self):
        book_plan()

        result = apply_quick_plan(request())

        self.assertEqual(result.path, "book_topics")
        self.assertEqual(result.left_topics, 25)
        self.assertEqual(result.sessions, 5)
        self.assertEqual((result.first_date, result.last_date), (MONDAY, FRIDAY))
        self.assertFalse(result.created_goal)
        schedule = StudySchedule.objects.get(pk=result.schedule_id)
        self.assertEqual(schedule.status, "active")
        self.assertTrue(schedule.feasible)
        self.assertTrue(schedule.pacing_snapshot["partial_by_period"])
        topics = list(dict.fromkeys(block.topic.title for block in blocks_of(result.schedule_id)))
        self.assertEqual(topics, ["Тема 1", "Тема 2", "Тема 3", "Тема 4", "Тема 5"])

    def test_the_list_says_the_schedule_covers_a_part_of_the_program(self):
        book_plan()

        result = apply_quick_plan(request())

        data = StudyScheduleListSerializer(StudySchedule.objects.get(pk=result.schedule_id)).data
        self.assertIs(data["partial_by_period"], True)

    def test_an_ordinary_schedule_covers_the_whole_program(self):
        result = apply_quick_plan(request())

        data = StudyScheduleListSerializer(StudySchedule.objects.get(pk=result.schedule_id)).data
        self.assertIs(data["partial_by_period"], False)

    def test_the_book_is_found_by_its_goal_id_too(self):
        goal, _ = book_plan(text="Математика")

        result = apply_quick_plan(request(subject="Что угодно", goal_id=str(goal.id)))

        self.assertEqual((result.path, result.goal_id), ("book_topics", str(goal.id)))

    def test_a_plan_awaiting_approval_is_approved_and_undo_takes_it_back(self):
        _, plan = book_plan(status=CoursePlan.Status.AWAITING_APPROVAL)
        plans_service._snapshot_version(plan, None, reason="test")

        result = apply_quick_plan(request())

        self.assertTrue(result.approves_plan)
        plan.refresh_from_db()
        self.assertEqual(plan.status, CoursePlan.Status.ACTIVE)

        undo_quick_plan(result.undo, user_email=OWNER)

        plan.refresh_from_db()
        self.assertEqual(plan.status, CoursePlan.Status.AWAITING_APPROVAL)
        self.assertEqual(StudySchedule.objects.get(pk=result.schedule_id).status, "archived")

    def test_an_active_plan_wins_over_a_newer_draft(self):
        goal, active = book_plan()
        CoursePlan.objects.create(user_email=OWNER, goal=goal, title="Новее", status=CoursePlan.Status.DRAFT)

        result = apply_quick_plan(request())

        self.assertEqual(StudySchedule.objects.get(pk=result.schedule_id).course_plan_id, active.id)

    def test_an_archived_plan_is_not_used(self):
        goal, plan = book_plan()
        plan.status = CoursePlan.Status.ARCHIVED
        plan.save(update_fields=["status"])

        result = apply_quick_plan(request())

        self.assertEqual(result.path, "new_sessions")
        self.assertEqual(result.goal_id, str(goal.id))
        self.assertFalse(result.created_goal)


class RhythmTests(QuickPlanFixture):
    def test_the_first_subject_sets_the_rhythm_and_undo_takes_it_back(self):
        result = apply_quick_plan(request())

        active = WeeklyScheduleTemplate.objects.filter(user_email=OWNER, active=True)
        self.assertEqual(active.count(), 1)
        self.assertEqual(active.get().created_by, "assistant")

        undo_quick_plan(result.undo, user_email=OWNER)

        self.assertFalse(WeeklyScheduleTemplate.objects.filter(user_email=OWNER, active=True).exists())

    def test_a_second_subject_keeps_the_active_rhythm(self):
        first = apply_quick_plan(request())
        rhythm = WeeklyScheduleTemplate.objects.get(user_email=OWNER, active=True)

        second = apply_quick_plan(request(subject="Физика", start_time=time(18, 0)))

        self.assertEqual(second.path, "new_sessions")
        self.assertEqual(WeeklyScheduleTemplate.objects.get(user_email=OWNER, active=True).pk, rhythm.pk)
        self.assertEqual(len(blocks_of(first.schedule_id)), 5)
        self.assertEqual(StudySchedule.objects.get(pk=first.schedule_id).status, "active")


class UndoTests(QuickPlanFixture):
    def test_undo_new_subject_removes_everything(self):
        result = apply_quick_plan(request())

        undo_quick_plan(result.undo, user_email=OWNER)

        self.assertFalse(LearningGoal.objects.filter(user_email=OWNER).exists())
        self.assertFalse(CoursePlan.objects.filter(user_email=OWNER).exists())
        self.assertFalse(StudySchedule.objects.filter(user_email=OWNER).exists())
        self.assertFalse(LearningBlock.objects.filter(user_email=OWNER).exists())
        self.assertFalse(StudyMaterial.objects.filter(user_email=OWNER).exists())
        self.assertFalse(WeeklyScheduleTemplate.objects.filter(user_email=OWNER).exists())

    def test_undo_subject_only_removes_it(self):
        result = apply_quick_plan(just_a_subject())

        undo_quick_plan(result.undo, user_email=OWNER)

        self.assertFalse(LearningGoal.objects.filter(user_email=OWNER).exists())

    def test_undo_extra_sessions_keeps_the_old_schedule(self):
        first = apply_quick_plan(request())
        extra = apply_quick_plan(
            request(from_date=MONDAY + timedelta(days=7), to_date=FRIDAY + timedelta(days=7))
        )

        undo_quick_plan(extra.undo, user_email=OWNER)

        self.assertEqual(len(blocks_of(first.schedule_id)), 5)
        schedule = StudySchedule.objects.get(pk=first.schedule_id)
        self.assertEqual(schedule.status, "active")
        self.assertEqual(schedule.end_date, FRIDAY)

    def test_undo_a_new_schedule_of_an_old_subject_keeps_the_subject(self):
        goal = LearningGoal.objects.create(
            user_email=OWNER,
            original_text="Русский язык",
            normalized_subject="Русский язык",
            normalization_confirmed=True,
            status=LearningGoal.Status.CONFIRMED,
        )
        result = apply_quick_plan(request())

        undo_quick_plan(result.undo, user_email=OWNER)

        self.assertTrue(LearningGoal.objects.filter(pk=goal.pk).exists())
        self.assertFalse(LearningBlock.objects.filter(user_email=OWNER).exists())

    def test_undo_keeps_a_subject_that_is_already_in_use(self):
        # Кнопка живёт в старой переписке: случайное нажатие не должно стереть прогресс.
        result = apply_quick_plan(request())
        LearningBlock.objects.filter(pk=blocks_of(result.schedule_id)[0].pk).update(
            status=LearningBlock.Status.COMPLETED
        )

        with self.assertRaises(QuickPlanRejected) as caught:
            undo_quick_plan(result.undo, user_email=OWNER)

        self.assertEqual(caught.exception.code, "undo_stale")
        self.assertTrue(LearningGoal.objects.filter(pk=result.goal_id).exists())
        self.assertEqual(len(blocks_of(result.schedule_id)), 5)

    def test_undo_keeps_a_subject_with_a_book(self):
        result = apply_quick_plan(request())
        goal = LearningGoal.objects.get(pk=result.goal_id)
        Document.objects.create(user_email=OWNER, goal=goal, title="Учебник")

        with self.assertRaises(QuickPlanRejected) as caught:
            undo_quick_plan(result.undo, user_email=OWNER)

        self.assertEqual(caught.exception.code, "undo_stale")
        self.assertTrue(LearningGoal.objects.filter(pk=result.goal_id).exists())

    def test_undo_extra_sessions_keeps_ones_already_started(self):
        apply_quick_plan(request())
        extra = apply_quick_plan(
            request(from_date=MONDAY + timedelta(days=7), to_date=FRIDAY + timedelta(days=7))
        )
        LearningBlock.objects.filter(pk=extra.undo["block_ids"][0]).update(status=LearningBlock.Status.IN_PROGRESS)

        with self.assertRaises(QuickPlanRejected):
            undo_quick_plan(extra.undo, user_email=OWNER)

        self.assertEqual(LearningBlock.objects.filter(pk__in=extra.undo["block_ids"]).count(), 5)

    def test_undo_survives_rubbish_from_the_client(self):
        result = apply_quick_plan(request())

        undo_quick_plan({"goal_id": "не номер", "plan_id": 5, "block_ids": "всё", "template_id": None}, user_email=OWNER)
        undo_quick_plan("мусор", user_email=OWNER)

        self.assertEqual(len(blocks_of(result.schedule_id)), 5)

    def test_undo_ignores_someone_elses_ids(self):
        result = apply_quick_plan(request())
        before = len(blocks_of(result.schedule_id))

        undo_quick_plan(result.undo, user_email=STRANGER)

        self.assertTrue(LearningGoal.objects.filter(user_email=OWNER).exists())
        self.assertEqual(len(blocks_of(result.schedule_id)), before)
        self.assertEqual(StudySchedule.objects.get(pk=result.schedule_id).status, "active")

    def test_someone_elses_goal_is_not_found(self):
        goal = LearningGoal.objects.create(user_email=STRANGER, original_text="Чужой предмет")

        with self.assertRaises(QuickPlanRejected) as caught:
            preview_quick_plan(request(goal_id=str(goal.id)))
        self.assertEqual(caught.exception.code, "goal_not_found")

    def test_a_goal_id_that_is_not_an_id_is_not_found(self):
        with self.assertRaises(QuickPlanRejected) as caught:
            preview_quick_plan(request(goal_id="не номер"))
        self.assertEqual(caught.exception.code, "goal_not_found")


class TwoSubjectsTests(QuickPlanFixture):
    """Занятия тьютора живут рядом с другими предметами и не мешают им двигаться."""

    def move_first(self, schedule_id, minutes=30):
        block = blocks_of(schedule_id)[0]
        return propose_moves(
            StudySchedule.objects.get(pk=schedule_id),
            moves=[BlockMove(block_id=str(block.id), start_at=block.start_at + timedelta(minutes=minutes))],
        )

    def test_a_lesson_can_move_on_a_day_with_two_subjects(self):
        first = apply_quick_plan(request())
        apply_quick_plan(request(subject="Физика", start_time=time(18, 0)))

        self.assertEqual(self.move_first(first.schedule_id).status, "proposed")

    def test_a_lesson_can_move_after_an_extra_saturday(self):
        first = apply_quick_plan(request())
        saturday = MONDAY + timedelta(days=5)
        apply_quick_plan(request(weekdays=(5,), from_date=saturday, to_date=saturday))

        self.assertEqual(self.move_first(first.schedule_id).status, "proposed")

    def test_an_old_schedule_with_its_own_limits_can_still_move(self):
        # Расписание из /start держит свои потолки, а новый предмет их уже превысил.
        first = apply_quick_plan(request(subject="Старый курс", start_time=time(10, 0), minutes=45))
        WeeklyScheduleTemplate.objects.filter(schedules__pk=first.schedule_id).update(
            max_minutes_per_day=45, max_minutes_per_week=225
        )
        apply_quick_plan(request(subject="Физика", start_time=time(18, 0)))

        self.assertEqual(self.move_first(first.schedule_id).status, "proposed")

    def test_a_move_that_adds_load_over_the_limit_is_still_refused(self):
        first = apply_quick_plan(request(subject="Старый курс", start_time=time(10, 0), minutes=45, weekdays=(0, 1)))
        WeeklyScheduleTemplate.objects.filter(schedules__pk=first.schedule_id).update(max_minutes_per_day=45)
        blocks = blocks_of(first.schedule_id)

        with self.assertRaises(RevisionRejected):
            propose_moves(
                StudySchedule.objects.get(pk=first.schedule_id),
                moves=[BlockMove(block_id=str(blocks[1].id), start_at=blocks[0].end_at + timedelta(hours=1))],
            )

    def test_a_book_fits_next_to_another_subject(self):
        apply_quick_plan(request(subject="Физика", start_time=time(18, 0)))
        book_plan()

        result = apply_quick_plan(request())

        self.assertEqual((result.path, result.sessions), ("book_topics", 5))

    def test_a_book_gets_every_day_next_to_a_rarer_subject(self):
        apply_quick_plan(request(subject="Физика", start_time=time(18, 0), weekdays=(0, 2)))
        book_plan()

        self.assertEqual(apply_quick_plan(request()).sessions, 5)

    def test_the_course_page_tells_the_same_pace_as_the_card(self):
        result = apply_quick_plan(request())

        plan = StudySchedule.objects.get(pk=result.schedule_id).course_plan
        self.assertEqual((plan.recommended_sessions_per_week, plan.recommended_session_minutes), (5, 60))
        self.assertLessEqual(plan.forecast_finish_date, FRIDAY + timedelta(days=7))


class CardHoldsTests(QuickPlanFixture):
    """На карточке одно, а записалось другое: этого быть не должно."""

    def test_a_card_that_no_longer_holds_is_refused(self):
        with self.assertRaises(QuickPlanRejected) as caught:
            apply_quick_plan(request(expected_sessions=4, expected_path="new_sessions"))

        self.assertEqual(caught.exception.code, "changed")
        self.assertIn("5", str(caught.exception))
        self.assertFalse(LearningGoal.objects.filter(user_email=OWNER).exists())

    def test_a_card_for_another_path_is_refused(self):
        _, plan = book_plan(status=CoursePlan.Status.AWAITING_APPROVAL)
        plans_service._snapshot_version(plan, None, reason="test")

        with self.assertRaises(QuickPlanRejected) as caught:
            apply_quick_plan(request(expected_sessions=5, expected_path="new_sessions"))

        self.assertEqual(caught.exception.code, "changed")

    def test_a_card_that_holds_passes(self):
        result = apply_quick_plan(request(expected_sessions=5, expected_path="new_sessions"))

        self.assertEqual(result.sessions, 5)

    def test_a_session_that_slipped_into_the_past_is_refused(self):
        late = datetime(2026, 11, 6, 13, 0, tzinfo=dt_timezone.utc)  # 18:00 в Алматы
        with mock.patch("studyplan.quick_plan.django_timezone.now", return_value=late):
            with self.assertRaises(QuickPlanRejected) as caught:
                apply_quick_plan(
                    request(
                        from_date=TODAY,
                        to_date=MONDAY,
                        weekdays=(4, 0),
                        start_time=time(16, 0),
                        expected_sessions=2,
                        expected_path="new_sessions",
                    )
                )

        self.assertEqual(caught.exception.code, "changed")


class PressedTwiceTests(QuickPlanFixture):
    """Ответ потерялся, ученик нажал снова: второй раз ничего не пишется, а отмена на месте."""

    def test_the_same_card_applies_once(self):
        first = apply_quick_plan(request(key="card-1"))
        second = apply_quick_plan(request(key="card-1"))

        self.assertEqual(second.schedule_id, first.schedule_id)
        self.assertEqual(second.undo, first.undo)
        self.assertEqual((second.sessions, second.first_date), (5, MONDAY))
        self.assertEqual(len(blocks_of(first.schedule_id)), 5)
        self.assertEqual(LearningGoal.objects.filter(user_email=OWNER).count(), 1)

    def test_a_card_undone_can_be_applied_again(self):
        first = apply_quick_plan(request(key="card-1"))
        undo_quick_plan(first.undo, user_email=OWNER)

        second = apply_quick_plan(request(key="card-1"))

        self.assertNotEqual(second.schedule_id, first.schedule_id)
        self.assertEqual(len(blocks_of(second.schedule_id)), 5)

    def test_a_refused_card_can_be_pressed_again(self):
        commitment = FixedCommitment.objects.create(
            user_email=OWNER, title="Репетитор", weekday=2, start_time=time(15, 30), duration_minutes=90
        )
        with self.assertRaises(QuickPlanRejected):
            apply_quick_plan(request(key="card-1"))
        commitment.delete()

        self.assertEqual(apply_quick_plan(request(key="card-1")).sessions, 5)

    def test_someone_elses_key_is_not_this_card(self):
        first = apply_quick_plan(request(key="card-1"))

        second = apply_quick_plan(request(key="card-1", user_email=STRANGER))

        self.assertNotEqual(second.schedule_id, first.schedule_id)


class CareOnUndoTests(QuickPlanFixture):
    def test_undo_keeps_a_subject_with_a_chat(self):
        result = apply_quick_plan(just_a_subject())
        chat = SubjectChat.objects.create(user_email=OWNER, goal_id=result.goal_id, title="Разговор")

        with self.assertRaises(QuickPlanRejected) as caught:
            undo_quick_plan(result.undo, user_email=OWNER)

        self.assertEqual(caught.exception.code, "undo_stale")
        self.assertTrue(SubjectChat.objects.filter(pk=chat.pk).exists())
        self.assertTrue(LearningGoal.objects.filter(pk=result.goal_id).exists())

    def test_undo_keeps_a_subject_with_another_source(self):
        result = apply_quick_plan(request())
        other = StudyMaterial.objects.create(
            user_email=OWNER, goal_id=result.goal_id, kind=StudyMaterial.Kind.LINK, title="Ссылка", total_units=3, minutes_per_unit=30
        )

        with self.assertRaises(QuickPlanRejected):
            undo_quick_plan(result.undo, user_email=OWNER)

        self.assertTrue(StudyMaterial.objects.filter(pk=other.pk).exists())

    def test_undo_of_a_replaced_schedule_is_refused(self):
        _, plan = book_plan()
        result = apply_quick_plan(request())
        StudySchedule.objects.filter(pk=result.schedule_id).update(status=StudySchedule.Status.ARCHIVED)

        with self.assertRaises(QuickPlanRejected) as caught:
            undo_quick_plan(result.undo, user_email=OWNER)

        self.assertEqual(caught.exception.code, "undo_stale")


class ExistingScheduleCareTests(QuickPlanFixture):
    def test_extra_sessions_do_not_hide_behind_a_new_proposal(self):
        first = apply_quick_plan(request())
        schedule = StudySchedule.objects.get(pk=first.schedule_id)
        StudySchedule.objects.create(
            user_email=OWNER,
            course_plan=schedule.course_plan,
            template=schedule.template,
            start_date=MONDAY,
            end_date=FRIDAY + timedelta(days=30),
            timezone=ZONE,
            status=StudySchedule.Status.PROPOSED,
        )

        with self.assertRaises(QuickPlanRejected) as caught:
            apply_quick_plan(request(from_date=MONDAY + timedelta(days=7), to_date=FRIDAY + timedelta(days=7)))

        self.assertEqual(caught.exception.code, "pending_proposal")
        self.assertEqual(len(blocks_of(first.schedule_id)), 5)

    def test_extra_sessions_keep_the_zone_of_the_schedule(self):
        # Ученик в поездке: «16:00» в его расписании это по-прежнему 16:00 по Алматы.
        first = apply_quick_plan(request())
        day = MONDAY + timedelta(days=7)

        apply_quick_plan(request(from_date=day, to_date=day, weekdays=(0,), timezone="Europe/Moscow"))

        self.assertEqual(
            blocks_of(first.schedule_id)[-1].start_at,
            datetime(2026, 11, 16, 11, 0, tzinfo=dt_timezone.utc),
        )

    def test_a_book_continues_with_the_next_topics(self):
        book_plan()
        first = apply_quick_plan(request())

        second = apply_quick_plan(request(from_date=MONDAY + timedelta(days=7), to_date=FRIDAY + timedelta(days=7)))

        self.assertEqual((second.path, second.schedule_id), ("extra_sessions", first.schedule_id))
        self.assertEqual(second.left_topics, 20)
        titles = [block.topic.title for block in blocks_of(first.schedule_id)[-5:]]
        self.assertEqual(titles, ["Тема 6", "Тема 7", "Тема 8", "Тема 9", "Тема 10"])
        self.assertEqual(blocks_of(first.schedule_id)[-1].title, "Тема 10")

    def test_a_short_book_runs_out_of_topics_and_goes_on_with_plain_sessions(self):
        book_plan(topics=6)
        first = apply_quick_plan(request())

        second = apply_quick_plan(request(from_date=MONDAY + timedelta(days=7), to_date=FRIDAY + timedelta(days=7)))

        self.assertEqual(second.left_topics, 0)
        last = blocks_of(first.schedule_id)[-1]
        self.assertIsNone(last.topic_id)
        self.assertIn("занятие", last.title)

    def test_an_own_unconfirmed_proposal_is_not_busy(self):
        # Подтверждение всё равно отправит её в архив, а отмена вернёт.
        _, plan = book_plan()
        template = WeeklyScheduleTemplate.objects.create(user_email=OWNER, title="Ритм", timezone=ZONE, active=False)
        for weekday in range(5):
            TemplateSlot.objects.create(template=template, weekday=weekday, start_time=time(16, 0), duration_minutes=60)
        proposed = generate_schedule(
            plan=plan, start_date=MONDAY, end_date=FRIDAY, timezone_name=ZONE, template=template, provider_key="deterministic"
        ).schedule

        result = apply_quick_plan(request())

        self.assertEqual(result.path, "book_topics")
        proposed.refresh_from_db()
        self.assertEqual(proposed.status, "archived")
        undo_quick_plan(result.undo, user_email=OWNER)
        proposed.refresh_from_db()
        self.assertEqual(proposed.status, "proposed")


class SchoolDayTests(QuickPlanFixture):
    def school(self, **fields):
        template = WeeklyTemplate.objects.create(id="t1", user_email=OWNER, name="Школа", is_active=True)
        values = {
            "template": template,
            "day_of_week": "wednesday",
            "lesson_number": 7,
            "start_time": "16:30",
            "end_time": "17:15",
            "block_type": "lesson",
            "label": "Алгебра",
        }
        values.update(fields)
        return TemplateLesson.objects.create(**values)

    def assert_busy(self):
        with self.assertRaises(QuickPlanRejected) as caught:
            preview_quick_plan(request())
        self.assertEqual(caught.exception.code, "busy")

    def test_a_test_in_the_school_day_blocks_the_card(self):
        self.school(block_type="test", label="Контрольная")
        self.assert_busy()

    def test_a_rest_does_not_block(self):
        self.school(block_type="rest")
        self.assertEqual(preview_quick_plan(request()).sessions, 5)

    def test_time_without_a_leading_zero(self):
        self.school(start_time="8:30", end_time="9:15")
        with self.assertRaises(QuickPlanRejected) as caught:
            preview_quick_plan(request(start_time=time(8, 30)))
        self.assertEqual(caught.exception.code, "busy")

    def test_a_template_kept_only_in_json(self):
        WeeklyTemplate.objects.create(
            id="t1",
            user_email=OWNER,
            name="Школа",
            is_active=True,
            slots=[{"dayOfWeek": "wednesday", "startTime": "16:30", "endTime": "17:15", "blockType": "lesson", "label": "Алгебра"}],
        )
        self.assert_busy()
