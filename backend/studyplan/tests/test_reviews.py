"""Повторения через 2, 7 и 21 день после того, как тема закончена."""

from __future__ import annotations

from datetime import date, timedelta

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
