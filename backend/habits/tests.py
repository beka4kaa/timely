"""Привычка: отметить можно только сегодня, и сегодня у ученика своё, а не серверное."""

from datetime import date, datetime, timedelta, timezone as dt_timezone
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from config.testing import auth_headers
from planner.models import Goal

from .models import Habit, HabitLog
from .serializers import CALENDAR_DAYS

STUDENT = 'student@example.com'
OTHER = 'other@example.com'

# 20:30 UTC 4 ноября: в Алматы (UTC+5) уже половина второго ночи 5 ноября.
LATE_EVENING_UTC = datetime(2026, 11, 4, 20, 30, tzinfo=dt_timezone.utc)
SERVER_DAY = date(2026, 11, 4)
ALMATY_DAY = date(2026, 11, 5)


class _Base(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.credentials(**auth_headers(STUDENT))
        self.habit = Habit.objects.create(user_email=STUDENT, name='Читать')
        clock = patch('django.utils.timezone.now', return_value=LATE_EVENING_UTC)
        clock.start()
        self.addCleanup(clock.stop)

    def toggle(self, body=None, habit=None):
        return self.client.post(f'/api/habits/{(habit or self.habit).id}/toggle/', body or {}, format='json')


class TheStudentsDayTests(_Base):
    def test_marks_the_day_the_student_names_not_the_servers(self):
        response = self.toggle({'date': ALMATY_DAY.isoformat()})

        self.assertEqual(response.status_code, 200)
        self.assertTrue(HabitLog.objects.filter(habit=self.habit, date=ALMATY_DAY).exists())
        self.assertFalse(HabitLog.objects.filter(habit=self.habit, date=SERVER_DAY).exists())
        self.assertTrue(response.data['done_today'])
        self.assertEqual(response.data['today'], ALMATY_DAY.isoformat())
        self.assertEqual(response.data['calendar'][-1], {'date': ALMATY_DAY.isoformat(), 'done': True, 'minutes': 0})

    def test_without_a_date_falls_back_to_the_servers_day(self):
        self.toggle()

        self.assertTrue(HabitLog.objects.filter(habit=self.habit, date=SERVER_DAY).exists())

    def test_a_past_day_cannot_be_marked(self):
        for raw in ('2026-11-02', '2026-11-03', '2020-01-01'):
            with self.subTest(raw=raw):
                response = self.toggle({'date': raw})
                self.assertEqual(response.status_code, 400)
        self.assertFalse(HabitLog.objects.exists())

    def test_a_day_nobody_on_earth_has_yet_cannot_be_marked(self):
        self.assertEqual(self.toggle({'date': '2026-11-06'}).status_code, 400)
        self.assertFalse(HabitLog.objects.exists())

    def test_nonsense_is_not_a_date(self):
        for raw in ('вчера', '2026-13-45', '5 ноября'):
            with self.subTest(raw=raw):
                self.assertEqual(self.toggle({'date': raw}).status_code, 400)
        self.assertFalse(HabitLog.objects.exists())

    def test_the_list_counts_from_the_students_day(self):
        HabitLog.objects.create(habit=self.habit, date=ALMATY_DAY)

        rows = self.client.get(f'/api/habits/?today={ALMATY_DAY}').data

        self.assertTrue(rows[0]['done_today'])
        self.assertEqual(rows[0]['streak'], 1)
        self.assertEqual(rows[0]['calendar'][-1]['date'], ALMATY_DAY.isoformat())

    def test_the_list_ignores_a_wrong_clock(self):
        rows = self.client.get('/api/habits/?today=2031-01-01').data

        self.assertEqual(rows[0]['today'], SERVER_DAY.isoformat())
        self.assertEqual(rows[0]['calendar'][-1]['date'], SERVER_DAY.isoformat())

    def test_the_streak_counts_back_from_the_students_day(self):
        for offset in range(1, 4):
            HabitLog.objects.create(habit=self.habit, date=ALMATY_DAY - timedelta(days=offset))

        response = self.toggle({'date': ALMATY_DAY.isoformat()})

        self.assertEqual(response.data['streak'], 4)


class TogglingTests(_Base):
    def test_pressing_twice_takes_back_only_today(self):
        HabitLog.objects.create(habit=self.habit, date=SERVER_DAY - timedelta(days=1))

        self.assertTrue(self.toggle().data['done_today'])
        response = self.toggle()

        self.assertFalse(response.data['done_today'])
        self.assertEqual(response.data['total_done'], 1)
        self.assertTrue(HabitLog.objects.filter(date=SERVER_DAY - timedelta(days=1)).exists())

    def test_done_says_what_should_be_whatever_is_there(self):
        self.assertTrue(self.toggle({'done': True}).data['done_today'])
        self.assertTrue(self.toggle({'done': True}).data['done_today'])
        self.assertEqual(HabitLog.objects.count(), 1)
        self.assertFalse(self.toggle({'done': False}).data['done_today'])
        self.assertFalse(self.toggle({'done': False}).data['done_today'])
        self.assertEqual(HabitLog.objects.count(), 0)

    def test_done_must_be_a_boolean(self):
        self.assertEqual(self.toggle({'done': 'да'}).status_code, 400)

    def test_a_day_with_a_note_keeps_its_record(self):
        HabitLog.objects.create(habit=self.habit, date=SERVER_DAY, note='важная заметка', minutes=25)

        response = self.toggle({'done': False})

        self.assertTrue(response.data['done_today'])
        self.assertEqual(HabitLog.objects.get().note, 'важная заметка')

    def test_someone_elses_habit_is_not_found(self):
        theirs = Habit.objects.create(user_email=OTHER, name='Чужая')

        self.assertEqual(self.toggle(habit=theirs).status_code, 404)
        self.assertFalse(HabitLog.objects.exists())


class OldDetailsTests(_Base):
    """Страница заметки больше не показывает, но старый путь и данные целы."""

    def test_log_still_attaches_detail_to_the_students_day(self):
        response = self.client.post(
            f'/api/habits/{self.habit.id}/log/',
            {'date': ALMATY_DAY.isoformat(), 'note': 'заметка', 'minutes': 25},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['note_today'], 'заметка')
        self.assertEqual(response.data['minutes_today'], 25)
        self.assertEqual(HabitLog.objects.get().date, ALMATY_DAY)

    def test_log_refuses_a_past_day(self):
        response = self.client.post(f'/api/habits/{self.habit.id}/log/', {'date': '2026-11-01', 'note': 'х'}, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertFalse(HabitLog.objects.exists())

    def test_gallery_still_works(self):
        HabitLog.objects.create(habit=self.habit, date=SERVER_DAY, photo='data:image/jpeg;base64,xx')

        rows = self.client.get('/api/habits/gallery/').data

        self.assertEqual([row['habit_id'] for row in rows], [self.habit.id])


class CardShapeTests(_Base):
    def test_a_new_habit_comes_back_with_an_honest_empty_calendar(self):
        response = self.client.post(f'/api/habits/?today={ALMATY_DAY}', {'name': 'Зарядка', 'color': '#3fe0a2'}, format='json')

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['streak'], 0)
        self.assertEqual(response.data['total_done'], 0)
        self.assertFalse(response.data['done_today'])
        self.assertEqual(len(response.data['calendar']), CALENDAR_DAYS)
        self.assertFalse(any(day['done'] for day in response.data['calendar']))
        self.assertEqual(response.data['calendar'][-1]['date'], ALMATY_DAY.isoformat())
        self.assertEqual(Habit.objects.get(pk=response.data['id']).user_email, STUDENT)

    def test_renaming_keeps_the_old_details_and_the_days(self):
        HabitLog.objects.create(habit=self.habit, date=SERVER_DAY, note='заметка')
        self.habit.goal_text = 'хотя бы 5 минут'
        self.habit.save()

        response = self.client.patch(f'/api/habits/{self.habit.id}/', {'name': 'Читать 20 минут'}, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['name'], 'Читать 20 минут')
        self.assertEqual(response.data['goal_text'], 'хотя бы 5 минут')
        self.assertEqual(response.data['note_today'], 'заметка')
        self.assertEqual(response.data['total_done'], 1)


class HowOftenTests(_Base):
    """Как часто. `ALMATY_DAY`, 5 ноября 2026, это четверг: день недели 3."""

    def add_days(self, *offsets, habit=None):
        for offset in offsets:
            HabitLog.objects.create(habit=habit or self.habit, date=ALMATY_DAY - timedelta(days=offset))

    def row(self):
        return self.client.get(f'/api/habits/?today={ALMATY_DAY}').data[0]

    def set_weekdays(self, *days, freeze_budget=0):
        Habit.objects.filter(pk=self.habit.pk).update(
            frequency=Habit.WEEKDAYS, weekdays=list(days), freeze_budget=freeze_budget,
        )

    def set_interval(self, days, freeze_budget=0):
        Habit.objects.filter(pk=self.habit.pk).update(
            frequency=Habit.INTERVAL, interval_days=days, freeze_budget=freeze_budget,
        )

    def test_an_old_habit_is_every_day_and_nothing_about_it_changes(self):
        row = self.row()

        self.assertEqual((row['frequency'], row['weekdays'], row['interval_days']), ('daily', [], 2))
        self.assertTrue(row['due_today'])
        self.assertEqual(row['next_due'], ALMATY_DAY.isoformat())
        self.assertFalse(any('off' in day for day in row['calendar']))

    def test_creates_with_weekdays_tidied_up(self):
        response = self.client.post(
            '/api/habits/', {'name': 'Плавание', 'frequency': 'weekdays', 'weekdays': [4, 0, 4]}, format='json',
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['weekdays'], [0, 4])
        self.assertEqual(Habit.objects.get(pk=response.data['id']).weekdays, [0, 4])

    def test_all_seven_days_are_just_every_day(self):
        response = self.client.post(
            '/api/habits/', {'name': 'Вода', 'frequency': 'weekdays', 'weekdays': list(range(7))}, format='json',
        )

        self.assertEqual(response.data['frequency'], 'daily')
        self.assertEqual(response.data['weekdays'], [])

    def test_crooked_values_are_refused(self):
        for body in (
            {'frequency': 'weekdays'},
            {'frequency': 'weekdays', 'weekdays': []},
            {'frequency': 'weekdays', 'weekdays': [7]},
            {'frequency': 'weekdays', 'weekdays': [-1]},
            {'frequency': 'weekdays', 'weekdays': ['пн']},
            {'frequency': 'weekdays', 'weekdays': [True]},
            {'frequency': 'weekdays', 'weekdays': 3},
            {'frequency': 'interval', 'interval_days': 1},
            {'frequency': 'interval', 'interval_days': 31},
            {'frequency': 'иногда'},
        ):
            with self.subTest(body=body):
                response = self.client.patch(f'/api/habits/{self.habit.id}/', body, format='json')
                self.assertEqual(response.status_code, 400)
        self.habit.refresh_from_db()
        self.assertEqual(self.habit.frequency, Habit.DAILY)

    def test_one_field_of_a_patch_keeps_the_rest(self):
        self.client.patch(f'/api/habits/{self.habit.id}/', {'frequency': 'interval', 'interval_days': 5}, format='json')

        response = self.client.patch(f'/api/habits/{self.habit.id}/', {'interval_days': 3}, format='json')

        self.assertEqual((response.data['frequency'], response.data['interval_days']), ('interval', 3))

    def test_renaming_leaves_how_often_alone(self):
        self.set_weekdays(0, 3)

        response = self.client.patch(f'/api/habits/{self.habit.id}/', {'name': 'Новое имя'}, format='json')

        self.assertEqual((response.data['frequency'], response.data['weekdays']), ('weekdays', [0, 3]))

    def test_going_back_to_every_day_forgets_the_days(self):
        self.set_weekdays(0, 3)

        response = self.client.patch(f'/api/habits/{self.habit.id}/', {'frequency': 'daily'}, format='json')

        self.assertEqual((response.data['frequency'], response.data['weekdays']), ('daily', []))

    def test_weekdays_say_which_days_count(self):
        self.set_weekdays(0, 3)  # понедельник и четверг
        row = self.row()

        self.assertTrue(row['due_today'])
        self.assertEqual(row['next_due'], ALMATY_DAY.isoformat())
        by_date = {day['date']: day for day in row['calendar']}
        self.assertNotIn('off', by_date[ALMATY_DAY.isoformat()])
        self.assertTrue(by_date[(ALMATY_DAY - timedelta(days=1)).isoformat()]['off'])
        self.assertNotIn('off', by_date[(ALMATY_DAY - timedelta(days=3)).isoformat()])

    def test_a_day_off_can_still_be_marked_and_says_when_next(self):
        self.set_weekdays(0)  # только понедельник

        row = self.row()
        self.assertFalse(row['due_today'])
        self.assertEqual(row['next_due'], date(2026, 11, 9).isoformat())

        response = self.toggle({'date': ALMATY_DAY.isoformat()})
        self.assertTrue(response.data['done_today'])
        self.assertFalse(response.data['due_today'])
        self.assertEqual(response.data['streak'], 1)

    def test_days_off_do_not_break_a_weekday_streak(self):
        self.set_weekdays(0, 3)
        # Понедельник 2 ноября, четверг 29 октября, понедельник 26 октября.
        self.add_days(3, 7, 10)

        # Сегодня четверг: день ещё не кончился, и серия цела.
        self.assertEqual(self.row()['streak'], 3)
        # Отметка делает её длиннее.
        self.assertEqual(self.toggle({'date': ALMATY_DAY.isoformat()}).data['streak'], 4)

    def test_on_a_day_off_the_streak_is_still_alive(self):
        self.set_weekdays(0, 2)  # понедельник и среда
        self.add_days(1, 3)  # среда и понедельник

        self.assertEqual(self.row()['streak'], 2)

    def test_a_missed_scheduled_day_breaks_a_weekday_streak(self):
        self.set_weekdays(0, 2)
        self.add_days(3)  # понедельник есть, а среда пропущена

        self.assertEqual(self.row()['streak'], 0)

    def test_a_shield_bridges_a_missed_scheduled_day_only(self):
        self.set_weekdays(0, 2, freeze_budget=1)
        self.add_days(3, 8)  # понедельник 2 ноября и среда 28 октября

        # Сегодня четверг, среда 4-го пропущена: без отметки сегодня цепочки нет.
        self.assertEqual(self.row()['streak'], 0)

        response = self.toggle({'date': ALMATY_DAY.isoformat()})
        # Щит закрыл только среду. На пятницу 30-го и другие дни отдыха он не тратится.
        self.assertEqual(response.data['streak'], 3)
        self.assertEqual(response.data['shields_used'], 1)

    def test_a_mark_on_a_day_off_counts_toward_the_streak(self):
        self.set_weekdays(0)
        self.add_days(3, 2)  # понедельник и вторник сверх плана

        self.assertEqual(self.row()['streak'], 2)

    def test_changing_how_often_recounts_the_streak(self):
        self.add_days(3, 6)  # понедельник и пятница: ежедневной привычке этого мало

        self.assertEqual(self.row()['streak'], 0)

        response = self.client.patch(
            f'/api/habits/{self.habit.id}/?today={ALMATY_DAY}',
            {'frequency': 'weekdays', 'weekdays': [0, 4]},
            format='json',
        )
        self.assertEqual(response.data['streak'], 2)

    def test_an_interval_is_due_until_it_is_done(self):
        self.set_interval(3)

        self.assertTrue(self.row()['due_today'], 'ещё ни разу не делали')

        self.add_days(5)
        row = self.row()
        self.assertTrue(row['due_today'], 'прошло больше трёх дней, и она всё ещё ждёт')
        self.assertEqual(row['next_due'], ALMATY_DAY.isoformat())

    def test_an_interval_counts_from_the_last_mark(self):
        self.set_interval(3)
        self.add_days(1)
        row = self.row()

        self.assertFalse(row['due_today'])
        self.assertEqual(row['next_due'], (ALMATY_DAY + timedelta(days=2)).isoformat())

        response = self.toggle({'date': ALMATY_DAY.isoformat()})
        self.assertEqual(response.data['next_due'], (ALMATY_DAY + timedelta(days=3)).isoformat())

    def test_days_between_marks_are_days_off(self):
        self.set_interval(3)
        self.add_days(3)
        by_date = {day['date']: day for day in self.row()['calendar']}

        self.assertTrue(by_date[(ALMATY_DAY - timedelta(days=2)).isoformat()]['off'])
        self.assertTrue(by_date[(ALMATY_DAY - timedelta(days=1)).isoformat()]['off'])
        self.assertNotIn('off', by_date[ALMATY_DAY.isoformat()], 'три дня прошли, сегодня пора')

    def test_an_interval_streak_lives_on_gaps_inside_the_interval(self):
        self.set_interval(3)
        self.add_days(2, 5, 8)

        self.assertEqual(self.row()['streak'], 3)

    def test_an_interval_streak_breaks_when_the_day_passes(self):
        self.set_interval(3)
        self.add_days(4, 7)  # после 1 ноября пора было 4-го, а сегодня уже 5-е

        self.assertEqual(self.row()['streak'], 0)
        self.assertEqual(self.toggle({'date': ALMATY_DAY.isoformat()}).data['streak'], 1)

    def test_a_shield_covers_one_late_day_of_an_interval(self):
        self.set_interval(3, freeze_budget=1)
        self.add_days(4, 7)

        response = self.toggle({'date': ALMATY_DAY.isoformat()})

        self.assertEqual(response.data['streak'], 3)
        self.assertEqual(response.data['shields_used'], 1)

    def test_taking_a_mark_back_restores_the_old_day(self):
        self.set_interval(3)
        self.add_days(3)

        self.assertEqual(self.toggle({'date': ALMATY_DAY.isoformat(), 'done': True}).data['streak'], 2)
        response = self.toggle({'date': ALMATY_DAY.isoformat(), 'done': False})

        self.assertEqual(response.data['streak'], 1)
        self.assertTrue(response.data['due_today'])
        self.assertEqual(response.data['next_due'], ALMATY_DAY.isoformat())

    def test_every_day_keeps_its_old_streak_rules(self):
        Habit.objects.filter(pk=self.habit.pk).update(freeze_budget=2)
        self.add_days(2, 3, 4)  # вчера пропуск, раньше три дня подряд

        self.assertEqual(self.row()['streak'], 0, 'без сегодняшней отметки цепочки нет')
        self.assertEqual(self.toggle({'date': ALMATY_DAY.isoformat()}).data['streak'], 4)

    def test_a_habit_with_no_days_left_does_not_fall_over(self):
        self.set_weekdays()

        row = self.row()

        self.assertFalse(row['due_today'])
        self.assertIsNone(row['next_due'])


class GoalLinkTests(_Base):
    def setUp(self):
        super().setUp()
        self.goal = Goal.objects.create(user_email=STUDENT, title='Сдать физику', type='goal')
        self.goal.refresh_from_db()  # у только что созданной цели pk ещё объект UUID

    def test_links_to_own_goal_and_signs_the_card(self):
        response = self.client.patch(f'/api/habits/{self.habit.id}/', {'goal': self.goal.pk}, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['goal'], self.goal.pk)
        self.assertEqual(response.data['goal_title'], 'Сдать физику')

    def test_creates_with_a_goal(self):
        response = self.client.post('/api/habits/', {'name': 'Решать задачи', 'goal': self.goal.pk}, format='json')

        self.assertEqual(response.status_code, 201)
        self.assertEqual(Habit.objects.get(pk=response.data['id']).goal_id, self.goal.pk)

    def test_someone_elses_goal_looks_like_no_goal(self):
        theirs = Goal.objects.create(user_email=OTHER, title='Чужая цель', type='goal')

        for call, url, body in (
            (self.client.patch, f'/api/habits/{self.habit.id}/', {'goal': theirs.pk}),
            (self.client.post, '/api/habits/', {'name': 'Новая', 'goal': theirs.pk}),
        ):
            response = call(url, body, format='json')
            self.assertEqual(response.status_code, 400)
            self.assertIn('goal', response.data)
        self.habit.refresh_from_db()
        self.assertIsNone(self.habit.goal_id)
        self.assertEqual(Habit.objects.filter(name='Новая').count(), 0)

    def test_unlinks_with_null(self):
        self.habit.goal = self.goal
        self.habit.save()

        response = self.client.patch(f'/api/habits/{self.habit.id}/', {'goal': None}, format='json')

        self.assertIsNone(response.data['goal'])
        self.assertEqual(response.data['goal_title'], '')

    def test_deleting_the_goal_leaves_the_habit(self):
        self.habit.goal = self.goal
        self.habit.save()

        self.assertEqual(self.client.delete(f'/api/goals/{self.goal.pk}/').status_code, 204)

        self.habit.refresh_from_db()
        self.assertIsNone(self.habit.goal_id)

    def test_an_archived_goal_is_gone_from_the_card(self):
        self.habit.goal = self.goal
        self.habit.save()
        Goal.objects.filter(pk=self.goal.pk).update(status='archived')

        row = self.client.get('/api/habits/').data[0]

        self.assertIsNone(row['goal'])
        self.assertEqual(row['goal_title'], '')
