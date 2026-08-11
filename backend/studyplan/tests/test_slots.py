"""Развёртка недельного ритма в конкретные окна, включая переходы времени."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from datetime import timezone as dt_timezone
from zoneinfo import ZoneInfo

from django.test import SimpleTestCase

from studyplan.scheduling.contracts import CommitmentSpec
from studyplan.scheduling.slots import (
    WARN_BUSY_SWALLOWED,
    WARN_DST_AMBIGUOUS,
    WARN_DST_GAP,
    WARN_OVERLAP_DROPPED,
    WARN_UNKNOWN_TIMEZONE,
    expand_free_slots,
    local_to_utc,
    resolve_zone,
)

from .factories import busy, slot, template

UTC = dt_timezone.utc

# Понедельник.
MONDAY = date(2026, 8, 17)


class LocalToUtcTests(SimpleTestCase):
    def test_converts_local_wall_clock_to_utc(self):
        moment, warning = local_to_utc(
            MONDAY, time(17, 0), ZoneInfo("Europe/Moscow")
        )
        self.assertEqual(moment, datetime(2026, 8, 17, 14, 0, tzinfo=UTC))
        self.assertEqual(warning, "")

    def test_nonexistent_local_time_is_shifted_and_reported(self):
        # 8 марта 2026, America/New_York: часы прыгают с 02:00 на 03:00, и
        # отметки 02:30 в этот день не существует.
        moment, warning = local_to_utc(
            date(2026, 3, 8), time(2, 30), ZoneInfo("America/New_York")
        )
        self.assertEqual(warning, WARN_DST_GAP)
        local = moment.astimezone(ZoneInfo("America/New_York"))
        self.assertEqual(local.hour, 3)
        self.assertEqual(local.minute, 30)

    def test_ambiguous_local_time_takes_first_occurrence(self):
        # 1 ноября 2026: 01:30 случается дважды. Занятие должно быть одно.
        moment, warning = local_to_utc(
            date(2026, 11, 1), time(1, 30), ZoneInfo("America/New_York")
        )
        self.assertEqual(warning, WARN_DST_AMBIGUOUS)
        # Первое вхождение — ещё по летнему времени, то есть UTC-4.
        self.assertEqual(moment, datetime(2026, 11, 1, 5, 30, tzinfo=UTC))

    def test_unknown_timezone_falls_back_to_utc(self):
        self.assertEqual(resolve_zone("Mars/Olympus").key, "UTC")


class ExpandFreeSlotsTests(SimpleTestCase):
    def test_single_weekly_slot_expands_once_per_week(self):
        free, warnings = expand_free_slots(
            template(slot(0)),
            (),
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=13),
        )
        self.assertEqual(len(free), 2)
        self.assertEqual(warnings, [])
        self.assertEqual([item.local_date for item in free],
                         [MONDAY, MONDAY + timedelta(days=7)])

    def test_rest_day_has_no_slots(self):
        free, _ = expand_free_slots(
            template(slot(0), slot(2)),
            (),
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=6),
        )
        weekdays = {item.local_date.weekday() for item in free}
        self.assertEqual(weekdays, {0, 2})

    def test_busy_time_is_subtracted(self):
        # Окно 17:00–17:45, занято 17:00–17:20 → остаётся 25 минут.
        free, _ = expand_free_slots(
            template(slot(0)),
            (busy(0, hour=17, minutes=20),),
            start_date=MONDAY,
            end_date=MONDAY,
        )
        self.assertEqual(len(free), 1)
        self.assertEqual(free[0].duration_minutes, 25)
        self.assertEqual(free[0].start, datetime(2026, 8, 17, 17, 20, tzinfo=UTC))

    def test_fully_busy_slot_disappears(self):
        free, warnings = expand_free_slots(
            template(slot(0)),
            (busy(0, hour=16, minutes=180),),
            start_date=MONDAY,
            end_date=MONDAY,
        )
        self.assertEqual(free, [])
        self.assertIn(WARN_BUSY_SWALLOWED, warnings)

    def test_leftover_shorter_than_minimum_is_dropped(self):
        # Окно 17:00–17:45, занято 17:15–17:40: остаются 15 и 5 минут.
        # Пятиминутный огрызок отдельным занятием не становится.
        free, _ = expand_free_slots(
            template(slot(0)),
            (busy(0, hour=17, minute=15, minutes=25),),
            start_date=MONDAY,
            end_date=MONDAY,
        )
        self.assertEqual([item.duration_minutes for item in free], [15])

    def test_one_off_commitment_blocks_its_day_only(self):
        one_off = CommitmentSpec(
            title="Экзамен",
            start_at=datetime(2026, 8, 17, 17, 0, tzinfo=UTC),
            end_at=datetime(2026, 8, 17, 18, 0, tzinfo=UTC),
        )
        free, _ = expand_free_slots(
            template(slot(0)),
            (one_off,),
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=7),
        )
        self.assertEqual([item.local_date for item in free],
                         [MONDAY + timedelta(days=7)])

    def test_fixed_slot_is_not_offered_for_study(self):
        free, _ = expand_free_slots(
            template(slot(0), slot(0, hour=19, slot_id="held", fixed=True)),
            (),
            start_date=MONDAY,
            end_date=MONDAY,
        )
        self.assertEqual(len(free), 1)
        self.assertEqual(free[0].start.hour, 17)

    def test_overlapping_slots_are_dropped_not_doubled(self):
        free, warnings = expand_free_slots(
            template(
                slot(0, hour=17, minutes=60, slot_id="a"),
                slot(0, hour=17, minute=30, minutes=60, slot_id="b"),
            ),
            (),
            start_date=MONDAY,
            end_date=MONDAY,
        )
        self.assertEqual(len(free), 1)
        self.assertIn(WARN_OVERLAP_DROPPED, warnings)

    def test_validity_window_limits_expansion(self):
        free, _ = expand_free_slots(
            template(slot(0), valid_until=MONDAY),
            (),
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=13),
        )
        self.assertEqual([item.local_date for item in free], [MONDAY])

    def test_unknown_timezone_is_reported(self):
        _, warnings = expand_free_slots(
            template(slot(0), timezone_name="Mars/Olympus"),
            (),
            start_date=MONDAY,
            end_date=MONDAY,
        )
        self.assertIn(WARN_UNKNOWN_TIMEZONE, warnings)


class DaylightSavingRhythmTests(SimpleTestCase):
    """Ритм задан стенными часами и обязан их пережить."""

    def test_local_time_survives_spring_transition(self):
        zone = ZoneInfo("America/New_York")
        # Воскресенья вокруг перехода 8 марта 2026.
        start = date(2026, 3, 1)
        free, warnings = expand_free_slots(
            template(slot(6, hour=17), timezone_name="America/New_York"),
            (),
            start_date=start,
            end_date=start + timedelta(days=14),
        )
        local_hours = {item.start.astimezone(zone).hour for item in free}
        self.assertEqual(local_hours, {17})
        # UTC-время при этом обязано СМЕСТИТЬСЯ — иначе стенные часы поехали бы.
        utc_hours = {item.start.hour for item in free}
        self.assertEqual(utc_hours, {22, 21})
        self.assertEqual(warnings, [])

    def test_slot_inside_spring_gap_is_shifted_with_warning(self):
        free, warnings = expand_free_slots(
            template(slot(6, hour=2, minute=30), timezone_name="America/New_York"),
            (),
            start_date=date(2026, 3, 8),
            end_date=date(2026, 3, 8),
        )
        self.assertIn(WARN_DST_GAP, warnings)
        self.assertEqual(len(free), 1)

    def test_spring_gap_collision_does_not_create_overlap(self):
        # 02:30 не существует и уезжает на 03:30 — ровно туда, где уже стоит
        # второе окно. Без защиты получились бы два блока внахлёст.
        free, warnings = expand_free_slots(
            template(
                slot(6, hour=2, minute=30, minutes=60, slot_id="gap"),
                slot(6, hour=3, minute=30, minutes=60, slot_id="real"),
                timezone_name="America/New_York",
            ),
            (),
            start_date=date(2026, 3, 8),
            end_date=date(2026, 3, 8),
        )
        self.assertEqual(len(free), 1)
        self.assertIn(WARN_OVERLAP_DROPPED, warnings)

    def test_ambiguous_hour_produces_one_slot(self):
        free, warnings = expand_free_slots(
            template(slot(6, hour=1, minute=30), timezone_name="America/New_York"),
            (),
            start_date=date(2026, 11, 1),
            end_date=date(2026, 11, 1),
        )
        self.assertEqual(len(free), 1)
        self.assertIn(WARN_DST_AMBIGUOUS, warnings)
