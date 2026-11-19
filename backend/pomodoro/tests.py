"""
Тесты помодоро-трекера.

Основное, что здесь проверяется, — изоляция данных между пользователями и
корректная нарезка на локальные дни: сессии хранятся в UTC, а календарь
активности пользователь видит в своём часовом поясе.
"""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from unittest.mock import patch

from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.test import Client, TestCase, TransactionTestCase
from django.utils import timezone

from .models import FocusSession
from .views import FocusSessionViewSet, _compute_streak, _local_day
from config.testing import auth_headers


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
        self.email = 'student@timely-plan.com'
        self.other = 'someone-else@timely-plan.com'

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
            **auth_headers(self.email),
        )

    def test_create_attaches_current_user(self):
        response = self._create()
        self.assertEqual(response.status_code, 201)
        session = FocusSession.objects.get()
        self.assertEqual(session.user_email, self.email)
        self.assertEqual(session.seconds, 3000)

    def test_same_session_sent_twice_is_stored_once(self):
        # Ответ на первую отправку потерялся или две вкладки отправили одну фазу:
        # вторая отправка возвращает уже записанную сессию, а не создаёт копию.
        started_at = timezone.now().isoformat()
        first = self._create(started_at=started_at)
        second = self._create(started_at=started_at)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()['id'], first.json()['id'])
        self.assertEqual(FocusSession.objects.count(), 1)

    def test_resend_is_matched_per_user_and_kind(self):
        started_at = timezone.now().isoformat()
        self._create(started_at=started_at)
        self._create(started_at=started_at, kind='break', seconds=600, planned_seconds=600)
        other = self.client.post(
            '/api/pomodoro/sessions/',
            data={
                'kind': 'focus',
                'started_at': started_at,
                'seconds': 3000,
                'planned_seconds': 3000,
                'preset_focus_min': 50,
                'preset_break_min': 10,
            },
            content_type='application/json',
            **auth_headers(self.other),
        )
        self.assertEqual(other.status_code, 201)
        self.assertEqual(FocusSession.objects.count(), 3)

    def test_send_racing_another_tab_returns_the_stored_session(self):
        # Две вкладки отправили одну фазу одновременно: проверка «уже записана?» у второй
        # прошла раньше, чем первая записала. Вставку останавливает уникальный индекс, и
        # вторая получает записанную сессию, а не ошибку.
        started_at = timezone.now().isoformat()
        first = self._create(started_at=started_at)
        real_lookup = FocusSessionViewSet._stored
        calls = []

        def late_lookup(view, user_email, data):
            calls.append(1)
            return None if len(calls) == 1 else real_lookup(view, user_email, data)

        with patch.object(FocusSessionViewSet, '_stored', late_lookup):
            second = self._create(started_at=started_at)

        self.assertEqual(len(calls), 2)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()['id'], first.json()['id'])
        self.assertEqual(FocusSession.objects.count(), 1)

    def test_database_refuses_a_second_copy(self):
        started_at = timezone.now()
        fields = {
            'user_email': self.email,
            'kind': FocusSession.FOCUS,
            'started_at': started_at,
            'seconds': 3000,
            'planned_seconds': 3000,
            'preset_focus_min': 50,
            'preset_break_min': 10,
        }
        FocusSession.objects.create(**fields)
        with self.assertRaises(IntegrityError), transaction.atomic():
            FocusSession.objects.create(**fields)

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
            '/api/pomodoro/sessions/', **auth_headers(self.email)
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
            '/api/pomodoro/sessions/?days=7', **auth_headers(self.email)
        )
        self.assertEqual(len(response.json()), 1)

    def test_summary_buckets_by_local_day_and_skips_breaks(self):
        now = timezone.now()
        FocusSession.objects.create(
            user_email=self.email, kind='focus', started_at=now,
            seconds=1800, planned_seconds=1800,
            preset_focus_min=30, preset_break_min=5,
        )
        # Разные фазы начинаются в разные моменты: одну и ту же дважды база не примет.
        FocusSession.objects.create(
            user_email=self.email, kind='focus', started_at=now - timedelta(milliseconds=1),
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
            **auth_headers(self.email),
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
            **auth_headers('fresh@timely-plan.com'),
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
            **auth_headers(self.email),
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
            **auth_headers(self.email),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['deleted'], 0)
        self.assertEqual(FocusSession.objects.filter(user_email=self.other).count(), 1)


class DuplicateCleanupMigrationTests(TransactionTestCase):
    """
    Миграция с уникальным индексом сначала убирает копии, накопившиеся до неё: одна
    и та же фаза, записанная двумя вкладками или повторной отправкой. Остаётся первая.
    """

    before = [('pomodoro', '0001_initial')]
    after = [('pomodoro', '0002_focussession_once')]

    def _migrate(self, targets):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(targets)
        return executor.loader.project_state(targets).apps

    def tearDown(self):
        # Остальные тесты ждут схему с индексом.
        self._migrate(self.after)

    def test_copies_are_removed_and_the_first_one_stays(self):
        old_apps = self._migrate(self.before)
        Session = old_apps.get_model('pomodoro', 'FocusSession')
        start = _utc(2026, 11, 10, 9, 0)

        def add(**overrides):
            fields = {
                'user_email': 'student@timely-plan.com',
                'kind': 'focus',
                'started_at': start,
                'seconds': 3000,
                'planned_seconds': 3000,
                'preset_focus_min': 50,
                'preset_break_min': 10,
            }
            fields.update(overrides)
            return Session.objects.create(**fields).pk

        first = add()
        add(seconds=2990)
        add(seconds=3000)
        other_kind = add(kind='break', seconds=600, planned_seconds=600)
        other_user = add(user_email='someone-else@timely-plan.com')
        other_time = add(started_at=start + timedelta(milliseconds=1))

        new_apps = self._migrate(self.after)
        Session = new_apps.get_model('pomodoro', 'FocusSession')
        self.assertEqual(
            sorted(Session.objects.values_list('pk', flat=True)),
            sorted([first, other_kind, other_user, other_time]),
        )
        self.assertEqual(Session.objects.get(pk=first).seconds, 3000)

    def test_migration_without_copies_changes_nothing(self):
        old_apps = self._migrate(self.before)
        Session = old_apps.get_model('pomodoro', 'FocusSession')
        Session.objects.create(
            user_email='student@timely-plan.com',
            kind='focus',
            started_at=_utc(2026, 11, 10, 9, 0),
            seconds=3000,
            planned_seconds=3000,
            preset_focus_min=50,
            preset_break_min=10,
        )
        new_apps = self._migrate(self.after)
        self.assertEqual(new_apps.get_model('pomodoro', 'FocusSession').objects.count(), 1)


class TimerStateApiTests(TestCase):
    """Идущий таймер один на все устройства ученика.

    Сервер хранит его как есть и меняет версию на каждой записи. Запись со старой
    версией отклоняется и возвращает то, что уже лежит: так два устройства не затирают
    друг друга молча, а то, что опоздало, берёт свежее состояние.
    """

    URL = '/api/pomodoro/state/'

    def setUp(self):
        self.client = Client()
        self.email = 'student@timely-plan.com'
        self.other = 'someone-else@timely-plan.com'

    def _put(self, state, base_version, email=None):
        return self.client.put(
            self.URL,
            data={'state': state, 'base_version': base_version},
            content_type='application/json',
            **auth_headers(email or self.email),
        )

    def _get(self, email=None):
        return self.client.get(self.URL, **auth_headers(email or self.email))

    def test_nothing_is_stored_at_first(self):
        response = self._get()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'state': None, 'version': 0})

    def test_first_save_becomes_version_one_and_is_read_back(self):
        state = {'phase': 'focus', 'running': True, 'endsAt': 1795080000000}
        response = self._put(state, 0)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'state': state, 'version': 1})
        self.assertEqual(self._get().json(), {'state': state, 'version': 1})

    def test_each_save_moves_the_version(self):
        self._put({'phase': 'focus'}, 0)
        response = self._put({'phase': 'break'}, 1)
        self.assertEqual(response.json()['version'], 2)

    def test_stale_save_is_refused_and_returns_what_is_stored(self):
        self._put({'phase': 'focus', 'running': True}, 0)
        late = self._put({'phase': 'focus', 'running': False}, 0)
        self.assertEqual(late.status_code, 409)
        self.assertEqual(late.json(), {'state': {'phase': 'focus', 'running': True}, 'version': 1})

    def test_save_before_anything_stored_with_a_wrong_version_is_refused(self):
        response = self._put({'phase': 'focus'}, 3)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json(), {'state': None, 'version': 0})

    def test_each_student_has_their_own_timer(self):
        self._put({'phase': 'focus'}, 0)
        self.assertEqual(self._get(self.other).json(), {'state': None, 'version': 0})

    def test_state_must_be_an_object(self):
        self.assertEqual(self._put('focus', 0).status_code, 400)
        self.assertEqual(self._put(['focus'], 0).status_code, 400)

    def test_version_must_be_a_number(self):
        self.assertEqual(self._put({'phase': 'focus'}, 'latest').status_code, 400)
        response = self.client.put(
            self.URL,
            data={'state': {'phase': 'focus'}},
            content_type='application/json',
            **auth_headers(self.email),
        )
        self.assertEqual(response.status_code, 400)

    def test_oversized_state_is_refused(self):
        response = self._put({'name': 'x' * 5000}, 0)
        self.assertEqual(response.status_code, 400)

    def test_requires_sign_in(self):
        self.assertEqual(self.client.get(self.URL).status_code, 401)
