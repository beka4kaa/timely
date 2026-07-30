"""Прогноз завершения: чистая арифметика календаря, без LLM."""

from datetime import date

from django.test import SimpleTestCase

from curriculum.forecast import (
    ForecastInput,
    ForecastNotPossible,
    compute_forecast,
    suggest_intensity,
)

# Понедельник.
START = date(2026, 8, 3)
WEEKDAYS_ONLY = (0, 1, 2, 3, 4)


class BasicForecastTests(SimpleTestCase):
    def test_normal_pace(self):
        result = compute_forecast(
            ForecastInput(
                total_estimated_minutes=1200,
                sessions_per_week=4,
                minutes_per_session=40,
                start_date=START,
            )
        )
        # 1200 * 1.15 = 1380 минут → 1380/40 = 34.5 → 35 занятий.
        self.assertEqual(result.effective_minutes, 1380)
        self.assertEqual(result.estimated_sessions, 35)
        self.assertEqual(result.sessions_per_week, 4)
        self.assertIsNotNone(result.estimated_finish_date)
        self.assertGreater(result.estimated_finish_date, START)

    def test_result_is_deterministic(self):
        payload = ForecastInput(
            total_estimated_minutes=900,
            sessions_per_week=3,
            minutes_per_session=45,
            start_date=START,
        )
        first = compute_forecast(payload)
        second = compute_forecast(payload)
        self.assertEqual(
            first.estimated_finish_date, second.estimated_finish_date
        )
        self.assertEqual(first.to_payload(), second.to_payload())

    def test_realistic_is_not_earlier_than_optimistic(self):
        result = compute_forecast(
            ForecastInput(
                total_estimated_minutes=2000,
                sessions_per_week=3,
                minutes_per_session=40,
                start_date=START,
            )
        )
        self.assertGreaterEqual(
            result.realistic_finish_date, result.optimistic_finish_date
        )
        # Ученику показываем реалистичную, а не оптимистичную дату.
        self.assertEqual(result.estimated_finish_date, result.realistic_finish_date)

    def test_review_overhead_extends_the_course(self):
        base = ForecastInput(
            total_estimated_minutes=1000,
            sessions_per_week=3,
            minutes_per_session=50,
            start_date=START,
            review_overhead=0.0,
        )
        with_overhead = ForecastInput(
            total_estimated_minutes=1000,
            sessions_per_week=3,
            minutes_per_session=50,
            start_date=START,
            review_overhead=0.5,
        )
        self.assertLess(
            compute_forecast(base).estimated_sessions,
            compute_forecast(with_overhead).estimated_sessions,
        )


class ConstraintTests(SimpleTestCase):
    def test_zero_duration_is_rejected(self):
        with self.assertRaises(ForecastNotPossible):
            compute_forecast(
                ForecastInput(
                    total_estimated_minutes=0,
                    sessions_per_week=3,
                    minutes_per_session=40,
                    start_date=START,
                )
            )

    def test_no_available_days_is_rejected(self):
        with self.assertRaises(ForecastNotPossible):
            compute_forecast(
                ForecastInput(
                    total_estimated_minutes=600,
                    sessions_per_week=3,
                    minutes_per_session=40,
                    start_date=START,
                    allowed_weekdays=(),
                )
            )

    def test_pace_capped_by_available_weekdays(self):
        result = compute_forecast(
            ForecastInput(
                total_estimated_minutes=600,
                sessions_per_week=7,
                minutes_per_session=40,
                start_date=START,
                # Только суббота и воскресенье.
                allowed_weekdays=(5, 6),
            )
        )
        self.assertEqual(result.sessions_per_week, 2)
        self.assertIn("sessions_per_week_capped_by_available_days", result.warnings)

    def test_sessions_land_only_on_allowed_weekdays(self):
        result = compute_forecast(
            ForecastInput(
                total_estimated_minutes=400,
                sessions_per_week=5,
                minutes_per_session=40,
                start_date=START,
                allowed_weekdays=WEEKDAYS_ONLY,
            )
        )
        self.assertIn(result.estimated_finish_date.weekday(), WEEKDAYS_ONLY)


class DeadlineTests(SimpleTestCase):
    def test_comfortable_deadline_is_feasible(self):
        result = compute_forecast(
            ForecastInput(
                total_estimated_minutes=600,
                sessions_per_week=3,
                minutes_per_session=40,
                start_date=START,
                desired_finish_date=date(2027, 1, 1),
            )
        )
        self.assertTrue(result.desired_deadline_feasible)
        self.assertEqual(result.risk, "low")

    def test_impossible_deadline_is_reported_not_faked(self):
        result = compute_forecast(
            ForecastInput(
                total_estimated_minutes=100_000,
                sessions_per_week=2,
                minutes_per_session=30,
                start_date=START,
                allowed_weekdays=(5, 6),
                desired_finish_date=date(2026, 8, 10),
            )
        )
        self.assertFalse(result.desired_deadline_feasible)
        self.assertEqual(result.risk, "high")
        self.assertIsNone(result.required_sessions_per_week)
        self.assertIn("deadline_unreachable_at_any_pace", result.warnings)

    def test_required_pace_is_computed_when_reachable(self):
        result = compute_forecast(
            ForecastInput(
                total_estimated_minutes=1200,
                sessions_per_week=1,
                minutes_per_session=40,
                start_date=START,
                desired_finish_date=date(2026, 10, 1),
            )
        )
        self.assertIsNotNone(result.required_sessions_per_week)
        self.assertGreater(result.required_sessions_per_week, 1)


class BlackoutAndCalendarTests(SimpleTestCase):
    def test_blackout_period_pushes_finish_date(self):
        base = ForecastInput(
            total_estimated_minutes=600,
            sessions_per_week=3,
            minutes_per_session=40,
            start_date=START,
        )
        blocked = ForecastInput(
            total_estimated_minutes=600,
            sessions_per_week=3,
            minutes_per_session=40,
            start_date=START,
            blackout_periods=((date(2026, 8, 5), date(2026, 9, 5)),),
        )
        self.assertGreater(
            compute_forecast(blocked).estimated_finish_date,
            compute_forecast(base).estimated_finish_date,
        )

    def test_leap_year_february_is_counted_correctly(self):
        # 2028 — високосный: 29 февраля существует и должно быть учтено.
        result = compute_forecast(
            ForecastInput(
                total_estimated_minutes=2400,
                sessions_per_week=5,
                minutes_per_session=40,
                start_date=date(2028, 2, 1),
                allowed_weekdays=WEEKDAYS_ONLY,
            )
        )
        self.assertIsNotNone(result.estimated_finish_date)
        self.assertGreater(result.estimated_finish_date, date(2028, 2, 1))

    def test_forecast_crosses_year_boundary(self):
        # 2000 мин × 1.15 = 2300 → 58 занятий, ×1.2 буфера = 70 занятий.
        # По 2 в неделю с 2 ноября 2026 это ~35 недель, то есть середина 2027.
        result = compute_forecast(
            ForecastInput(
                total_estimated_minutes=2000,
                sessions_per_week=2,
                minutes_per_session=40,
                start_date=date(2026, 11, 2),
                allowed_weekdays=WEEKDAYS_ONLY,
            )
        )
        self.assertEqual(result.estimated_finish_date.year, 2027)

    def test_changed_intensity_changes_finish_date(self):
        slow = compute_forecast(
            ForecastInput(
                total_estimated_minutes=1200,
                sessions_per_week=2,
                minutes_per_session=40,
                start_date=START,
            )
        )
        fast = compute_forecast(
            ForecastInput(
                total_estimated_minutes=1200,
                sessions_per_week=5,
                minutes_per_session=40,
                start_date=START,
            )
        )
        self.assertLess(fast.estimated_finish_date, slow.estimated_finish_date)


class IntensitySuggestionTests(SimpleTestCase):
    def test_without_deadline_suggests_calm_pace(self):
        pace, minutes = suggest_intensity(
            total_estimated_minutes=1200,
            desired_finish_date=None,
            start_date=START,
        )
        self.assertEqual((pace, minutes), (3, 40))

    def test_tight_deadline_raises_pace(self):
        relaxed, _ = suggest_intensity(
            total_estimated_minutes=1200,
            desired_finish_date=date(2027, 6, 1),
            start_date=START,
        )
        tight, _ = suggest_intensity(
            total_estimated_minutes=1200,
            desired_finish_date=date(2026, 9, 15),
            start_date=START,
        )
        self.assertLessEqual(relaxed, tight)
