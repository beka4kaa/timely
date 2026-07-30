"""
Тесты помодоро-трекера.

Основное, что здесь проверяется, — изоляция данных между пользователями и
корректная нарезка на локальные дни: сессии хранятся в UTC, а календарь
активности пользователь видит в своём часовом поясе.
"""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone

from django.test import Client, TestCase
from django.utils import timezone

from .models import FocusSession
from .views import _compute_streak, _local_day


def _utc(year, month, day, hour=12, minute=0):
    return datetime(year, month, day, hour, minute, tzinfo=dt_timezone.utc)


class LocalDayTests(TestCase):
    """Перевод UTC-момента в локальный день пользователя."""

    def test_positive_offset_zone_rolls_to_next_day(self):
        # Алматы = UTC+5, getTimezoneOffset() = -300.
        # 20:30 UTC — это уже 01:30 следующего дня по местному времени.
        self.assertEqual(
            _local_day(_utc(2026, 7, 30, 20, 30), -300).isoformat(),
            '2026-07-31',
        )

    def test_negative_offset_zone_rolls_to_previous_day(self):
        # Нью-Йорк = UTC-4, getTimezoneOffset() = 240.
        # 02:00 UTC — это ещё вчерашний вечер по местному времени.
        self.assertEqual(
            _local_day(_utc(2026, 7, 30, 2, 0), 240).isoformat(),
            '2026-07-29',
        )

    def test_utc_offset_zero_keeps_day(self):
        self.assertEqual(
            _local_day(_utc(2026, 7, 30, 12, 0), 0).isoformat(),
            '2026-07-30',
        )


class StreakTests(TestCase):
    """Подсчёт серии подряд идущих учебных дней."""

    def test_counts_consecutive_days_including_today(self):
        today = datetime(2026, 7, 30).date()
        daily = {
            '2026-07-30': 3000,
            '2026-07-29': 3000,
            '2026-07-28': 3000,
        }
        self.assertEqual(_compute_streak(daily, today), 3)

    def test_today_without_study_does_not_break_streak(self):
        today = datetime(2026, 7, 30).date()
        daily = {'2026-07-29': 3000, '2026-07-28': 3000}
        self.assertEqual(_compute_streak(daily, today), 2)

    def test_gap_stops_the_streak(self):
        today = datetime(2026, 7, 30).date()
        daily = {
            '2026-07-30': 3000,
            # 29 июля пропущено
            '2026-07-28': 3000,
            '2026-07-27': 3000,
        }
        self.assertEqual(_compute_streak(daily, today), 1)

    def test_empty_history_has_no_streak(self):
        self.assertEqual(_compute_streak({}, datetime(2026, 7, 30).date()), 0)


class FocusSessionApiTests(TestCase):
    """HTTP-контур: создание, изоляция, сводка и очистка дня."""

    def setUp(self):
        self.client = Client()
        self.email = 'student@timelyplan.me'
        self.other = 'someone-else@timelyplan.me'

    def _create(self, **overrides):
        payload = {
            'kind': 'focus',
            'started_at': timezone.now().isoformat(),
            'seconds': 3000,
            'planned_seconds': 3000,
            'preset_focus_min': 50,
            'preset_break_min': 10,
        }
        payload.update(overrides)
        return self.client.post(
            '/api/pomodoro/sessions/',
            data=payload,
            content_type='application/json',
            HTTP_X_USER_EMAIL=self.email,
        )

    def test_create_attaches_current_user(self):
        response = self._create()
        self.assertEqual(response.status_code, 201)
        session = FocusSession.objects.get()
        self.assertEqual(session.user_email, self.email)
        self.assertEqual(session.seconds, 3000)

    def test_create_without_user_is_rejected(self):
        response = self.client.post(
            '/api/pomodoro/sessions/',
            data={
                'kind': 'focus',
                'started_at': timezone.now().isoformat(),
                'seconds': 3000,
                'planned_seconds': 3000,
                'preset_focus_min': 50,
                'preset_break_min': 10,
            },
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(FocusSession.objects.count(), 0)

    def test_list_hides_other_users_sessions(self):
        self._create()
        FocusSession.objects.create(
            user_email=self.other,
            kind='focus',
            started_at=timezone.now(),
            seconds=1800,
            planned_seconds=1800,
            preset_focus_min=30,
            preset_break_min=5,
        )

        response = self.client.get(
            '/api/pomodoro/sessions/', HTTP_X_USER_EMAIL=self.email
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 1)
        self.assertEqual(response.json()[0]['seconds'], 3000)

    def test_list_respects_days_window(self):
        self._create()
        FocusSession.objects.create(
            user_email=self.email,
            kind='focus',
            started_at=timezone.now() - timedelta(days=40),
            seconds=1200,
            planned_seconds=1500,
            preset_focus_min=25,
            preset_break_min=5,
        )

        response = self.client.get(
            '/api/pomodoro/sessions/?days=7', HTTP_X_USER_EMAIL=self.email
        )
        self.assertEqual(len(response.json()), 1)

    def test_summary_buckets_by_local_day_and_skips_breaks(self):
        now = timezone.now()
        FocusSession.objects.create(
            user_email=self.email, kind='focus', started_at=now,
            seconds=1800, planned_seconds=1800,
            preset_focus_min=30, preset_break_min=5,
        )
        FocusSession.objects.create(
            user_email=self.email, kind='focus', started_at=now,
            seconds=1200, planned_seconds=1200,
            preset_focus_min=20, preset_break_min=5,
        )
        # Перерывы не должны попадать в время учёбы.
        FocusSession.objects.create(
            user_email=self.email, kind='break', started_at=now,
            seconds=600, planned_seconds=600,
            preset_focus_min=30, preset_break_min=10,
        )

        response = self.client.get(
            '/api/pomodoro/sessions/summary/?tz_offset=0',
            HTTP_X_USER_EMAIL=self.email,
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()

        today_key = _local_day(now, 0).isoformat()
        self.assertEqual(body['daily'][today_key], 3000)
        self.assertEqual(body['total_seconds'], 3000)
        self.assertEqual(body['active_days'], 1)
        self.assertEqual(body['best_day'], {'date': today_key, 'seconds': 3000})

    def test_summary_is_empty_for_new_user(self):
        response = self.client.get(
            '/api/pomodoro/sessions/summary/?tz_offset=0',
            HTTP_X_USER_EMAIL='fresh@timelyplan.me',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                'daily': {},
                'streak': 0,
                'active_days': 0,
                'total_seconds': 0,
                'best_day': None,
            },
        )

    def test_summary_requires_user(self):
        response = self.client.get('/api/pomodoro/sessions/summary/')
        self.assertEqual(response.status_code, 401)

    def test_clear_day_removes_only_that_local_day(self):
        now = timezone.now()
        today = _local_day(now, 0)
        FocusSession.objects.create(
            user_email=self.email, kind='focus', started_at=now,
            seconds=1800, planned_seconds=1800,
            preset_focus_min=30, preset_break_min=5,
        )
        FocusSession.objects.create(
            user_email=self.email, kind='focus',
            started_at=now - timedelta(days=3),
            seconds=1800, planned_seconds=1800,
            preset_focus_min=30, preset_break_min=5,
        )

        response = self.client.delete(
            f'/api/pomodoro/sessions/clear-day/?tz_offset=0&date={today.isoformat()}',
            HTTP_X_USER_EMAIL=self.email,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['deleted'], 1)
        self.assertEqual(FocusSession.objects.filter(user_email=self.email).count(), 1)

    def test_clear_day_does_not_touch_other_users(self):
        now = timezone.now()
        FocusSession.objects.create(
            user_email=self.other, kind='focus', started_at=now,
            seconds=1800, planned_seconds=1800,
            preset_focus_min=30, preset_break_min=5,
        )

        response = self.client.delete(
            '/api/pomodoro/sessions/clear-day/?tz_offset=0',
            HTTP_X_USER_EMAIL=self.email,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['deleted'], 0)
        self.assertEqual(FocusSession.objects.filter(user_email=self.other).count(), 1)
