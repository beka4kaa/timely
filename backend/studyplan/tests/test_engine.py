"""Размещение частей урока по окнам: порядок, лимиты, конфликты, детерминизм."""

from __future__ import annotations

import time
from collections import defaultdict
from datetime import date, timedelta

from django.test import SimpleTestCase

from studyplan.scheduling.engine import (
    WARN_ACTIVITY_NEVER_ALLOWED,
    WARN_CAPACITY_EXCEEDED,
    WARN_DEADLINE_MISSED,
    WARN_NO_SLOTS,
    build_schedule,
)

from .factories import busy, request, slot, template, topic

MONDAY = date(2026, 8, 17)
WEEK = timedelta(days=7)


def _lessons(draft):
    return [block for block in draft.blocks if block.kind == "lesson"]


def _by_local_day(draft):
    grouped: dict[date, int] = defaultdict(int)
    for block in draft.blocks:
        grouped[block.start.date()] += block.duration_minutes
    return grouped


class PlacementTests(SimpleTestCase):
    def test_topic_is_split_across_slots_in_order(self):
        draft = build_schedule(
            request(
                topics=[topic("t1")],
                spec=template(slot(0), slot(2), slot(4)),
                start=MONDAY,
                end=MONDAY + timedelta(days=6),
            )
        )
        lessons = _lessons(draft)
        self.assertEqual(
            [block.activity_type for block in lessons],
            ["theory", "independent_practice", "assessment"],
        )
        # Первые две части заполняют понедельник целиком, проверка уезжает в среду.
        self.assertEqual(lessons[0].start.date(), MONDAY)
        self.assertEqual(lessons[1].start.date(), MONDAY)
        self.assertEqual(lessons[2].start.date(), MONDAY + timedelta(days=2))
        self.assertTrue(draft.feasible)

    def test_blocks_never_overlap(self):
        draft = build_schedule(
            request(
                topics=[topic(f"t{i}") for i in range(1, 6)],
                spec=template(slot(0), slot(1), slot(2), slot(3), slot(4)),
                start=MONDAY,
                end=MONDAY + timedelta(days=27),
            )
        )
        ordered = sorted(draft.blocks, key=lambda block: block.start)
        for earlier, later in zip(ordered, ordered[1:]):
            self.assertLessEqual(earlier.end, later.start)

    def test_study_order_is_monotonic_so_prerequisites_hold(self):
        draft = build_schedule(
            request(
                topics=[topic("t1"), topic("t2")],
                spec=template(slot(0), slot(2), slot(4)),
                start=MONDAY,
                end=MONDAY + timedelta(days=13),
                prerequisites={"id-t2": ("id-t1",)},
            )
        )
        first = [b for b in _lessons(draft) if b.topic_external_id == "t1"]
        second = [b for b in _lessons(draft) if b.topic_external_id == "t2"]
        self.assertTrue(first and second)
        self.assertLessEqual(max(b.end for b in first), min(b.start for b in second))

    def test_busy_time_is_never_occupied(self):
        # Школа целиком накрывает понедельник — занятия уезжают на среду.
        draft = build_schedule(
            request(
                topics=[topic("t1")],
                spec=template(slot(0), slot(2)),
                start=MONDAY,
                end=MONDAY + timedelta(days=6),
                commitments=(busy(0, hour=16, minutes=180),),
            )
        )
        self.assertTrue(draft.blocks)
        self.assertTrue(all(b.start.date() != MONDAY for b in draft.blocks))

    def test_rest_day_stays_empty(self):
        draft = build_schedule(
            request(
                topics=[topic(f"t{i}") for i in range(1, 4)],
                spec=template(slot(0), slot(2), slot(4)),
                start=MONDAY,
                end=MONDAY + timedelta(days=27),
            )
        )
        weekdays = {block.start.weekday() for block in draft.blocks}
        self.assertEqual(weekdays - {0, 2, 4}, set())


class LoadLimitTests(SimpleTestCase):
    def test_daily_limit_is_respected(self):
        draft = build_schedule(
            request(
                topics=[topic(f"t{i}") for i in range(1, 4)],
                spec=template(
                    slot(0, hour=17, slot_id="a"),
                    slot(0, hour=19, slot_id="b"),
                    slot(2, hour=17, slot_id="c"),
                    slot(2, hour=19, slot_id="d"),
                    max_day=45,
                ),
                start=MONDAY,
                end=MONDAY + timedelta(days=27),
            )
        )
        for day, minutes in _by_local_day(draft).items():
            self.assertLessEqual(minutes, 45, f"перегружен день {day}")

    def test_weekly_limit_is_respected(self):
        draft = build_schedule(
            request(
                topics=[topic(f"t{i}") for i in range(1, 6)],
                spec=template(slot(0), slot(2), slot(4), max_week=60),
                start=MONDAY,
                end=MONDAY + timedelta(days=27),
            )
        )
        per_week: dict[tuple[int, int], int] = defaultdict(int)
        for block in draft.blocks:
            iso = block.start.date().isocalendar()
            per_week[(iso[0], iso[1])] += block.duration_minutes
        for key, minutes in per_week.items():
            self.assertLessEqual(minutes, 60, f"перегружена неделя {key}")

    def test_buffer_leaves_part_of_the_week_free(self):
        # Четыре окна по 45 минут = 180 в неделю; четверть остаётся пустой.
        spec = template(slot(0), slot(1), slot(2), slot(3))
        draft = build_schedule(
            request(
                topics=[topic(f"t{i}") for i in range(1, 8)],
                spec=spec,
                start=MONDAY,
                end=MONDAY + timedelta(days=6),
                buffer=0.25,
            )
        )
        planned = sum(block.duration_minutes for block in draft.blocks)
        self.assertLessEqual(planned, 135)
        self.assertGreater(planned, 0)

    def test_zero_buffer_lifts_the_weekly_cap(self):
        # Ровно 180 минут не получается и не должно: части темы (25/20/15) не
        # замощают окна по 45 минут без остатка, и «плотно» здесь означает
        # «сколько влезло целыми частями», а не «до последней минуты».
        def planned_with(buffer: float) -> int:
            draft = build_schedule(
                request(
                    topics=[topic(f"t{i}") for i in range(1, 8)],
                    spec=template(slot(0), slot(1), slot(2), slot(3)),
                    start=MONDAY,
                    end=MONDAY + timedelta(days=6),
                    buffer=buffer,
                )
            )
            return sum(block.duration_minutes for block in draft.blocks)

        without_buffer = planned_with(0.0)
        with_buffer = planned_with(0.25)
        self.assertGreater(without_buffer, 135)
        self.assertLessEqual(with_buffer, 135)
        self.assertGreater(without_buffer, with_buffer)


class ConflictTests(SimpleTestCase):
    def test_impossible_plan_reports_conflict_instead_of_cutting_topics(self):
        draft = build_schedule(
            request(
                topics=[topic(f"t{i}") for i in range(1, 11)],
                spec=template(slot(0)),
                start=MONDAY,
                end=MONDAY + timedelta(days=13),
            )
        )
        self.assertFalse(draft.feasible)
        self.assertIsNotNone(draft.conflict)
        self.assertTrue(draft.conflict.unplaced)
        self.assertTrue(draft.conflict.suggestions)
        self.assertEqual(draft.conflict.required_minutes, 600)
        # Ни один блок не укорочен ниже запланированного.
        for block in _lessons(draft):
            self.assertGreaterEqual(block.duration_minutes, 15)

    def test_conflict_payload_is_serialisable(self):
        draft = build_schedule(
            request(
                topics=[topic(f"t{i}") for i in range(1, 11)],
                spec=template(slot(0)),
                start=MONDAY,
                end=MONDAY + timedelta(days=13),
            )
        )
        payload = draft.conflict.to_payload()
        self.assertFalse(payload["feasible"])
        self.assertIsInstance(payload["unplaced"], list)
        self.assertIsInstance(payload["suggestions"], list)

    def test_activity_without_any_slot_is_reported_explicitly(self):
        draft = build_schedule(
            request(
                topics=[topic("t1")],
                spec=template(slot(0, allowed=("theory",)), slot(2, allowed=("theory",))),
                start=MONDAY,
                end=MONDAY + timedelta(days=13),
            )
        )
        reasons = {part.reason for part in draft.conflict.unplaced}
        self.assertEqual(reasons, {"no_slot_accepts_activity"})
        self.assertIn(WARN_ACTIVITY_NEVER_ALLOWED, draft.warnings)

    def test_empty_template_range_reports_no_slots(self):
        # Окно только по воскресеньям, а горизонт — рабочая неделя.
        draft = build_schedule(
            request(
                topics=[topic("t1")],
                spec=template(slot(6)),
                start=MONDAY,
                end=MONDAY + timedelta(days=4),
            )
        )
        self.assertIn(WARN_NO_SLOTS, draft.warnings)
        self.assertFalse(draft.feasible)
        self.assertEqual(draft.blocks, ())
        self.assertEqual(
            {part.reason for part in draft.conflict.unplaced},
            {"out_of_capacity", "blocked_by_earlier_part"},
        )

    def test_topic_is_never_left_half_scheduled(self):
        # Места хватает на несколько тем и обрывается на середине. Тема, у
        # которой не поместилась теория, не должна получить проверку.
        draft = build_schedule(
            request(
                topics=[topic(f"t{i}") for i in range(1, 11)],
                spec=template(slot(0), slot(2)),
                start=MONDAY,
                end=MONDAY + timedelta(days=13),
            )
        )
        self.assertFalse(draft.feasible)
        by_topic: dict[str, set[str]] = defaultdict(set)
        for block in _lessons(draft):
            by_topic[block.topic_external_id].add(block.activity_type)
        for external_id, activities in by_topic.items():
            if "assessment" in activities:
                self.assertIn(
                    "theory", activities, f"у темы {external_id} проверка без теории"
                )

    def test_missed_deadline_is_a_conflict_even_when_everything_fits(self):
        draft = build_schedule(
            request(
                topics=[topic("t1"), topic("t2")],
                spec=template(slot(0)),
                start=MONDAY,
                end=MONDAY + timedelta(days=27),
                desired_finish_date=MONDAY + timedelta(days=3),
            )
        )
        self.assertFalse(draft.feasible)
        self.assertEqual(draft.conflict.unplaced, ())
        self.assertGreater(draft.conflict.overrun_days, 0)
        self.assertIn(WARN_DEADLINE_MISSED, draft.warnings)
        self.assertNotIn(WARN_CAPACITY_EXCEEDED, draft.warnings)

    def test_capacity_shortage_is_distinguished_from_a_late_deadline(self):
        draft = build_schedule(
            request(
                topics=[topic(f"t{i}") for i in range(1, 11)],
                spec=template(slot(0)),
                start=MONDAY,
                end=MONDAY + timedelta(days=13),
            )
        )
        self.assertIn(WARN_CAPACITY_EXCEEDED, draft.warnings)
        self.assertNotIn(WARN_DEADLINE_MISSED, draft.warnings)


class DeterminismTests(SimpleTestCase):
    """Одинаковый вход обязан давать одинаковый календарь."""

    def _fingerprint(self, draft):
        return [
            (
                block.start.isoformat(),
                block.end.isoformat(),
                block.activity_type,
                block.topic_external_id,
                block.kind,
                block.review_step,
            )
            for block in draft.blocks
        ]

    def test_same_request_object_twice(self):
        req = request(
            topics=[topic(f"t{i}") for i in range(1, 6)],
            spec=template(slot(0), slot(2), slot(4)),
            start=MONDAY,
            end=MONDAY + timedelta(days=41),
        )
        self.assertEqual(
            self._fingerprint(build_schedule(req)),
            self._fingerprint(build_schedule(req)),
        )

    def test_two_identically_built_requests(self):
        def make():
            return request(
                topics=[topic(f"t{i}") for i in range(1, 6)],
                spec=template(slot(0), slot(2), slot(4)),
                start=MONDAY,
                end=MONDAY + timedelta(days=41),
                commitments=(busy(2, hour=17, minutes=20),),
            )

        self.assertEqual(
            self._fingerprint(build_schedule(make())),
            self._fingerprint(build_schedule(make())),
        )


class HorizonTests(SimpleTestCase):
    def test_three_month_plan_is_fully_dated(self):
        draft = build_schedule(
            request(
                topics=[topic(f"t{i}") for i in range(1, 26)],
                spec=template(slot(0), slot(1), slot(2), slot(3), slot(4)),
                start=MONDAY,
                end=MONDAY + timedelta(days=90),
            )
        )
        self.assertTrue(draft.feasible)
        self.assertGreater(len(draft.blocks), 50)
        for block in draft.blocks:
            self.assertIsNotNone(block.start.tzinfo)
            self.assertTrue(block.title)
            self.assertTrue(block.activity_type)
            self.assertGreater(block.duration_minutes, 0)
        span = max(b.start for b in draft.blocks) - min(b.start for b in draft.blocks)
        self.assertGreater(span.days, 30)

    def test_large_course_stays_fast(self):
        # Сто двадцать тем на три месяца — это порядка четырёхсот частей и
        # почти тысячи окон. Размещение остаётся жадным и однопроходным;
        # если кто-то однажды сделает его квадратичным, тест это заметит.
        started = time.monotonic()
        draft = build_schedule(
            request(
                topics=[topic(f"t{i}") for i in range(1, 121)],
                spec=template(
                    *[
                        slot(weekday, hour=hour, minutes=60, slot_id=f"s{weekday}-{hour}")
                        for weekday in range(7)
                        for hour in (10, 14, 18)
                    ]
                ),
                start=MONDAY,
                end=MONDAY + timedelta(days=90),
            )
        )
        elapsed = time.monotonic() - started
        self.assertTrue(draft.feasible)
        self.assertGreater(len(draft.blocks), 400)
        self.assertLess(elapsed, 5.0, f"размещение заняло {elapsed:.1f} с")
