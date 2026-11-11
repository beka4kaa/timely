"""Повторения в плане.

Тема, которую ученик ещё ни разу не повторял, получает три повторения через 2,
7 и 21 день после урока. У повторённой темы срок уже назначил FSRS
(`mind.Topic.next_review_at`): план ставит одно повторение на этот срок.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone as dt_timezone

from django.test import SimpleTestCase

from studyplan.scheduling.engine import build_schedule

from .factories import request, slot, template, topic

MONDAY = date(2026, 8, 17)


def _every_day(**kwargs):
    return template(*[slot(weekday, **kwargs) for weekday in range(7)])


def _reviews(draft):
    return [block for block in draft.blocks if block.kind == "review"]


class ReviewSchedulingTests(SimpleTestCase):
    def test_three_reviews_at_the_expected_offsets(self):
        draft = build_schedule(
            request(
                topics=[topic("t1")],
                spec=_every_day(),
                start=MONDAY,
                end=MONDAY + timedelta(days=60),
            )
        )
        lessons = [b for b in draft.blocks if b.kind == "lesson"]
        finished = max(block.end for block in lessons).date()

        reviews = _reviews(draft)
        self.assertEqual([r.review_step for r in reviews], [0, 1, 2])
        self.assertEqual(
            [r.start.date() for r in reviews],
            [
                finished + timedelta(days=2),
                finished + timedelta(days=7),
                finished + timedelta(days=21),
            ],
        )

    def test_review_is_short_and_marked_as_review(self):
        draft = build_schedule(
            request(
                topics=[topic("t1")],
                spec=_every_day(),
                start=MONDAY,
                end=MONDAY + timedelta(days=60),
            )
        )
        for block in _reviews(draft):
            self.assertEqual(block.activity_type, "review")
            self.assertEqual(block.duration_minutes, 15)
            self.assertIn("повторение", block.title)
            self.assertEqual(block.topic_external_id, "t1")

    def test_review_does_not_count_as_a_new_topic(self):
        draft = build_schedule(
            request(
                topics=[topic("t1"), topic("t2")],
                spec=_every_day(),
                start=MONDAY,
                end=MONDAY + timedelta(days=60),
            )
        )
        lesson_activities = {
            block.activity_type for block in draft.blocks if block.kind == "lesson"
        }
        self.assertNotIn("review", lesson_activities)
        self.assertEqual(draft.stats["required_minutes"], 120)
        self.assertEqual(draft.stats["reviews_planned"], 6)

    def test_reviews_beyond_the_horizon_are_not_created(self):
        draft = build_schedule(
            request(
                topics=[topic("t1")],
                spec=_every_day(),
                start=MONDAY,
                end=MONDAY + timedelta(days=9),
            )
        )
        self.assertEqual([r.review_step for r in _reviews(draft)], [0, 1])
        self.assertEqual(draft.stats["reviews_beyond_horizon"], 1)

    def test_missing_review_slot_does_not_break_the_course(self):
        # В ритме нет ни одного окна, где разрешено повторение.
        spec = template(
            *[
                slot(
                    weekday,
                    allowed=("theory", "independent_practice", "assessment"),
                )
                for weekday in range(7)
            ]
        )
        draft = build_schedule(
            request(
                topics=[topic("t1")],
                spec=spec,
                start=MONDAY,
                end=MONDAY + timedelta(days=60),
            )
        )
        self.assertEqual(_reviews(draft), [])
        self.assertEqual(draft.stats["reviews_dropped_no_slot"], 3)
        # Пропущенное повторение — потеря качества, а не срыв курса.
        self.assertTrue(draft.feasible)

    def test_reviews_share_capacity_with_lessons(self):
        draft = build_schedule(
            request(
                topics=[topic(f"t{i}") for i in range(1, 4)],
                spec=_every_day(),
                start=MONDAY,
                end=MONDAY + timedelta(days=60),
            )
        )
        ordered = sorted(draft.blocks, key=lambda block: block.start)
        for earlier, later in zip(ordered, ordered[1:]):
            self.assertLessEqual(
                earlier.end, later.start, "повторение наложилось на урок"
            )

    def test_earlier_review_gets_the_earlier_slot(self):
        # Повторение первой темы через 21 день не должно опережать повторение
        # третьей темы через 2 дня: очередь строится по календарю, а не по теме.
        draft = build_schedule(
            request(
                topics=[topic(f"t{i}") for i in range(1, 4)],
                spec=_every_day(),
                start=MONDAY,
                end=MONDAY + timedelta(days=60),
            )
        )
        reviews = _reviews(draft)
        starts = [block.start for block in reviews]
        self.assertEqual(starts, sorted(starts))


def _at(day: date, hour: int = 9) -> datetime:
    return datetime.combine(day, time(hour, 0), tzinfo=dt_timezone.utc)


def _of(draft, external_id: str):
    return [block for block in _reviews(draft) if block.topic_external_id == external_id]


class FsrsReviewDateTests(SimpleTestCase):
    """Повторённая тема: одно повторение на дату FSRS вместо 2/7/21."""

    def test_reviewed_topic_gets_one_review_on_the_fsrs_date(self):
        due_day = MONDAY + timedelta(days=12)
        draft = build_schedule(
            request(
                topics=[topic("t1"), topic("t2")],
                spec=_every_day(),
                start=MONDAY,
                end=MONDAY + timedelta(days=60),
                review_due={"id-t1": _at(due_day)},
            )
        )
        fsrs = _of(draft, "t1")
        self.assertEqual([block.start.date() for block in fsrs], [due_day])
        # Не шаг 2/7/21: подпись «через 2 дня» к нему не подходит.
        self.assertIsNone(fsrs[0].review_step)
        self.assertEqual(fsrs[0].activity_type, "review")
        self.assertEqual(fsrs[0].duration_minutes, 15)

        # Тема без повторений живёт по-старому.
        self.assertEqual([block.review_step for block in _of(draft, "t2")], [0, 1, 2])
        self.assertEqual(draft.stats["reviews_planned"], 4)

    def test_review_never_comes_before_the_lesson(self):
        # FSRS просил повторить ещё до урока по этой теме в плане.
        draft = build_schedule(
            request(
                topics=[topic("t1")],
                spec=_every_day(),
                start=MONDAY,
                end=MONDAY + timedelta(days=60),
                review_due={"id-t1": _at(MONDAY - timedelta(days=3))},
            )
        )
        lessons = [block for block in draft.blocks if block.kind == "lesson"]
        lesson_end = max(block.end for block in lessons)
        fsrs = _of(draft, "t1")
        self.assertEqual(len(fsrs), 1)
        self.assertGreaterEqual(fsrs[0].start, lesson_end)
        self.assertLessEqual(
            fsrs[0].start.date(), lesson_end.date() + timedelta(days=7), "повторение ищет место не дольше недели"
        )

    def test_overdue_review_is_not_on_the_lesson_day(self):
        # Срок FSRS прошёл ещё до урока: урок сам освежил тему, повторение через 2 дня после него.
        draft = build_schedule(
            request(
                topics=[topic("t1")],
                spec=_every_day(),
                start=MONDAY,
                end=MONDAY + timedelta(days=60),
                review_due={"id-t1": _at(MONDAY - timedelta(days=5))},
            )
        )
        lessons = [block for block in draft.blocks if block.kind == "lesson"]
        lesson_day = max(block.end for block in lessons).date()
        fsrs = _of(draft, "t1")
        self.assertEqual(len(fsrs), 1)
        self.assertNotEqual(fsrs[0].start.date(), lesson_day)
        self.assertEqual(fsrs[0].start.date(), lesson_day + timedelta(days=2))
        self.assertIsNone(fsrs[0].review_step)

    def test_fsrs_date_is_read_in_the_schedule_time_zone(self):
        # 22:00 UTC 28 августа — это уже 29 августа в Алматы (UTC+5).
        almaty = template(*[slot(weekday) for weekday in range(7)], timezone_name="Asia/Almaty")
        draft = build_schedule(
            request(
                topics=[topic("t1")],
                spec=almaty,
                start=MONDAY,
                end=MONDAY + timedelta(days=60),
                timezone_name="Asia/Almaty",
                review_due={"id-t1": datetime(2026, 8, 28, 22, 0, tzinfo=dt_timezone.utc)},
            )
        )
        fsrs = _of(draft, "t1")
        self.assertEqual(len(fsrs), 1)
        from zoneinfo import ZoneInfo

        self.assertEqual(fsrs[0].start.astimezone(ZoneInfo("Asia/Almaty")).date(), date(2026, 8, 29))

    def test_fsrs_date_beyond_the_horizon_is_not_created(self):
        end = MONDAY + timedelta(days=20)
        draft = build_schedule(
            request(
                topics=[topic("t1")],
                spec=_every_day(),
                start=MONDAY,
                end=end,
                review_due={"id-t1": _at(end + timedelta(days=5))},
            )
        )
        self.assertEqual(_of(draft, "t1"), [])
        self.assertEqual(draft.stats["reviews_beyond_horizon"], 1)


# ───────────── Связь темы программы с темой ученика (с базой) ─────────────

from studyplan.tests.test_materialize import OWNER, SchedulePlanFixture  # noqa: E402


class FsrsReviewDatesFromTopicsTests(SchedulePlanFixture):
    """`build_request` находит срок FSRS у темы ученика с тем же названием.

    Общего ключа у `CourseTopic` и `mind.Topic` нет, поэтому связь мягкая: по
    названию без учёта регистра, только у этого ученика и только однозначная.
    """

    DUE = datetime(2026, 9, 14, 6, 0, tzinfo=dt_timezone.utc)

    def _subject(self, name="Физика", email=OWNER):
        from mind.models import Subject

        return Subject.objects.create(name=name, user_email=email)

    def _reviewed(self, subject, name, *, due=None, reps=2):
        from mind.models import Topic

        due = due or self.DUE
        return Topic.objects.create(
            subject=subject,
            name=name,
            status="SUCCESS",
            fsrs_stability=9.0,
            fsrs_difficulty=5.0,
            fsrs_state=2,
            fsrs_reps=reps,
            last_revised_at=due - timedelta(days=9),
            next_review_at=due,
        )

    def _request(self):
        from studyplan.services import build_request

        request, _warnings, _snapshot = build_request(
            plan=self.plan,
            template=self.make_template(),
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=60),
            timezone_name="UTC",
        )
        return request

    def test_reviewed_topic_with_the_same_name_gives_its_date(self):
        self._reviewed(self._subject(), "  тема T1.1 ")
        self.assertEqual(self._request().review_due, {str(self.topics[0].id): self.DUE})

    def test_new_foreign_or_ambiguous_topics_are_ignored(self):
        physics = self._subject()
        self._reviewed(physics, "Тема t1.2", reps=0)
        self._reviewed(self._subject(email="other@example.com"), "Тема t1.3")
        self._reviewed(physics, "Тема t2.1")
        self._reviewed(self._subject("Механика"), "Тема t2.1")
        self.assertEqual(self._request().review_due, {})

    def test_goal_subject_settles_an_ambiguous_name(self):
        physics = self._subject()
        self.goal.subject = physics
        self.goal.save(update_fields=["subject"])
        self._reviewed(physics, "Тема t2.1")
        self._reviewed(self._subject("Механика"), "Тема t2.1", due=self.DUE + timedelta(days=3))
        self.assertEqual(self._request().review_due, {str(self.topics[3].id): self.DUE})

    def test_single_namesake_in_another_subject_is_ignored_when_the_goal_subject_is_known(self):
        """Цель про физику, а единственные «Векторы» ученика — в геометрии: это другая тема."""
        from studyplan.models import LearningBlock
        from studyplan.services import generate_schedule

        physics = self._subject()
        self.goal.subject = physics
        self.goal.save(update_fields=["subject"])
        self._reviewed(self._subject("Геометрия"), "Тема t1.1")

        self.assertEqual(self._request().review_due, {})

        outcome = generate_schedule(
            plan=self.plan,
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=60),
            template=self.make_template(),
        )
        steps = set(
            LearningBlock.objects.filter(
                schedule=outcome.schedule, activity_type="review", review_of_topic=self.topics[0]
            ).values_list("review_step", flat=True)
        )
        self.assertTrue(steps)
        self.assertLessEqual(steps, {0, 1, 2})

    def test_generated_calendar_puts_the_review_on_the_fsrs_date(self):
        from studyplan.models import LearningBlock
        from studyplan.services import generate_schedule

        self._reviewed(self._subject(), "Тема t1.1")
        outcome = generate_schedule(
            plan=self.plan,
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=60),
            template=self.make_template(),
        )
        reviews = LearningBlock.objects.filter(
            schedule=outcome.schedule, activity_type="review", review_of_topic=self.topics[0]
        )
        self.assertEqual(reviews.count(), 1)
        block = reviews.get()
        self.assertIsNone(block.review_step)
        self.assertGreaterEqual(block.start_at.date(), self.DUE.date())
        self.assertLessEqual(block.start_at.date(), self.DUE.date() + timedelta(days=7))

        # Остальные темы без повторений остались на шагах 2/7/21.
        steps = set(
            LearningBlock.objects.filter(schedule=outcome.schedule, activity_type="review")
            .exclude(review_of_topic=self.topics[0])
            .values_list("review_step", flat=True)
        )
        self.assertTrue(steps)
        self.assertLessEqual(steps, {0, 1, 2})
