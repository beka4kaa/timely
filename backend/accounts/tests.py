import importlib
import json
from datetime import timedelta
from importlib import import_module
from unittest.mock import patch

from django.apps import apps
from django.db import connection
from django.test import Client, TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from . import views
from .models import Contest, CustomUser, Discipline, PrivateLeaderboard, Task, TaskSubmission, UserRating
from config.testing import auth_headers


class AccessControlApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.admin = CustomUser.objects.create_user(
            username='admin@example.com',
            email='admin@example.com',
            password='test-pass',
            is_staff=True,
            has_full_access=True,
        )
        self.user = CustomUser.objects.create_user(
            username='student@example.com',
            email='student@example.com',
            password='test-pass',
        )

    def test_me_includes_full_access_flag(self):
        # Правило изменилось: разделы открыты по умолчанию, а флаг служит для
        # того, чтобы ЗАКРЫТЬ их конкретному человеку. Прежнее умолчание
        # `False` закрывало «План» и «Курс» каждому новому аккаунту, пока админ
        # не выдаст доступ руками.
        response = self.client.get('/api/me/', **auth_headers(self.user.email))

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['has_full_access'])
        self.assertEqual(response.json()['ai_plan'], 'free')

    def test_access_can_be_revoked(self):
        # Тумблер в админке продолжает работать — только теперь он закрывает,
        # а не открывает.
        self.user.has_full_access = False
        self.user.save(update_fields=['has_full_access'])

        response = self.client.get('/api/me/', **auth_headers(self.user.email))
        self.assertFalse(response.json()['has_full_access'])

    def test_staff_me_uses_max_plan(self):
        response = self.client.get('/api/me/', **auth_headers(self.admin.email))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['ai_plan'], 'max')

    def test_non_admin_cannot_list_admin_users(self):
        response = self.client.get('/api/admin/users/', **auth_headers(self.user.email))

        self.assertEqual(response.status_code, 403)

    def test_admin_can_update_user_access(self):
        response = self.client.patch(
            f'/api/admin/users/{self.user.id}/access/',
            data=json.dumps({'has_full_access': True, 'is_moderator': True}),
            content_type='application/json',
            **auth_headers(self.admin.email),
        )

        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.has_full_access)
        self.assertTrue(self.user.is_moderator)

    def test_staff_can_assign_a_paid_plan(self):
        response = self.client.patch(
            f'/api/admin/users/{self.user.id}/access/',
            data=json.dumps({'ai_plan': 'pro'}),
            content_type='application/json',
            **auth_headers(self.admin.email),
        )

        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.ai_plan, 'pro')

    def test_admin_users_include_rating_and_submission_counts(self):
        task = Task.objects.create(
            author=self.admin,
            title='Algebra',
            condition_text='Solve it',
            status='active',
        )
        TaskSubmission.objects.create(student=self.user, task=task, status='approved')
        TaskSubmission.objects.create(student=self.user, task=task, status='pending')

        response = self.client.get('/api/admin/users/', **auth_headers(self.admin.email))

        self.assertEqual(response.status_code, 200)
        student = next(item for item in response.json() if item['email'] == self.user.email)
        self.assertEqual(student['submissions_total'], 2)
        self.assertEqual(student['submissions_approved'], 1)
        self.assertEqual(student['submissions_pending'], 1)


class MeBioApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = CustomUser.objects.create_user(
            username='student@example.com',
            email='student@example.com',
            password='test-pass',
        )

    def patch(self, body, email='student@example.com'):
        return self.client.patch(
            '/api/me/',
            data=json.dumps(body),
            content_type='application/json',
            **auth_headers(email),
        )

    def test_bio_is_empty_until_written(self):
        response = self.client.get('/api/me/', **auth_headers(self.user.email))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['bio'], '')

    def test_student_saves_their_bio(self):
        response = self.patch({'bio': '  Готовлюсь к итоговым по физике.  '})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['bio'], 'Готовлюсь к итоговым по физике.')
        self.user.refresh_from_db()
        self.assertEqual(self.user.bio, 'Готовлюсь к итоговым по физике.')

    def test_bio_can_be_cleared(self):
        self.patch({'bio': 'Было'})

        response = self.patch({'bio': ''})

        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.bio, '')

    def test_too_long_bio_is_refused(self):
        response = self.patch({'bio': 'я' * 281})

        self.assertEqual(response.status_code, 400)
        self.user.refresh_from_db()
        self.assertEqual(self.user.bio, '')

    def test_patch_changes_nothing_but_the_bio(self):
        response = self.patch({
            'bio': 'Привет',
            'is_staff': True,
            'is_superuser': True,
            'is_moderator': True,
            'overall_elo': 9999,
            'ai_plan': 'max',
            'has_full_access': False,
            'email': 'other@example.com',
            'username': 'other',
        })

        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.bio, 'Привет')
        self.assertFalse(self.user.is_staff)
        self.assertFalse(self.user.is_superuser)
        self.assertFalse(self.user.is_moderator)
        self.assertEqual(self.user.overall_elo, 1200)
        self.assertEqual(self.user.ai_plan, 'free')
        self.assertTrue(self.user.has_full_access)
        self.assertEqual(self.user.email, 'student@example.com')
        self.assertEqual(self.user.username, 'student@example.com')

    def test_patch_needs_a_signed_in_student(self):
        response = self.client.patch(
            '/api/me/',
            data=json.dumps({'bio': 'Чужой'}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 401)

    def test_nobody_else_sees_the_bio(self):
        self.patch({'bio': 'Только для себя'})
        # Even someone who agreed to be on the leaderboard keeps this to themselves.
        self.patch({'show_in_leaderboard': True})
        other = CustomUser.objects.create_user(
            username='other@example.com',
            email='other@example.com',
            password='test-pass',
        )
        headers = auth_headers(other.email)

        board = self.client.get('/api/leaderboard/', **headers).json()['results']
        one = self.client.get(f'/api/leaderboard/{self.user.id}/', **headers).json()

        self.assertIn(self.user.id, [row['id'] for row in board])
        self.assertTrue(all('bio' not in row for row in board))
        self.assertNotIn('bio', one)


class FirstRequestProfileTests(TestCase):
    """Every signed-in account gets its own row, made on its first request."""

    EMAIL = 'new@example.com'

    def setUp(self):
        self.client = Client()

    def me(self, email=EMAIL):
        return self.client.get('/api/me/', **auth_headers(email))

    def patch(self, body, email=EMAIL):
        return self.client.patch(
            '/api/me/',
            data=json.dumps(body),
            content_type='application/json',
            **auth_headers(email),
        )

    def test_first_request_makes_the_profile(self):
        response = self.me()

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertNotIn('authenticated', body)
        self.assertEqual(body['email'], self.EMAIL)
        self.assertEqual(body['name'], 'new')
        self.assertEqual(body['bio'], '')
        self.assertEqual(CustomUser.objects.filter(email=self.EMAIL).count(), 1)

    def test_later_requests_find_the_same_row(self):
        first = self.me().json()['id']

        self.assertEqual(self.me().json()['id'], first)
        self.assertEqual(CustomUser.objects.filter(email=self.EMAIL).count(), 1)

    def test_new_account_saves_a_description_straight_away(self):
        response = self.patch({'bio': 'Новый ученик'})

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['bio'], 'Новый ученик')
        self.assertEqual(CustomUser.objects.get(email=self.EMAIL).bio, 'Новый ученик')

    def test_new_row_grants_nothing(self):
        # Password sign-up accepts anyone's address, so the address alone earns nothing.
        self.me()

        user = CustomUser.objects.get(email=self.EMAIL)
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)
        self.assertFalse(user.is_moderator)
        self.assertFalse(user.has_usable_password())
        self.assertFalse(user.show_in_leaderboard)
        self.assertEqual(user.ai_plan, 'free')
        self.assertEqual(user.overall_elo, 1200)
        self.assertEqual((user.first_name, user.last_name), ('', ''))

    def test_a_request_without_a_genuine_token_makes_nothing(self):
        for headers in (
            {},
            auth_headers(self.EMAIL, secret='not-the-server-secret-' * 2),
            auth_headers(self.EMAIL, ttl=-3600),
        ):
            with self.subTest(headers=sorted(headers)):
                self.assertEqual(self.client.get('/api/me/', **headers).status_code, 401)
        self.assertFalse(CustomUser.objects.exists())

    def test_endpoints_that_need_the_student_work_from_the_first_request(self):
        # These used to crash on an account with no row.
        author = CustomUser.objects.create_user(username='author', email='author@example.com', password='x')
        task = Task.objects.create(author=author, title='Задача', status='active')
        _contest('Идёт', -1, 1, [task])

        submitted = self.client.post(
            '/api/submissions/',
            data=json.dumps({'task': task.id, 'file_url_or_code': 'x = 1'}),
            content_type='application/json',
            **auth_headers(self.EMAIL),
        )
        group = self.client.post(
            '/api/private-leaderboards/',
            data=json.dumps({'name': 'Класс'}),
            content_type='application/json',
            **auth_headers('other@example.com'),
        )

        self.assertEqual(submitted.status_code, 201, submitted.content)
        self.assertEqual(group.status_code, 201, group.content)
        self.assertEqual(CustomUser.objects.filter(email=self.EMAIL).count(), 1)

    def test_losing_the_race_to_create_returns_the_winners_row(self):
        # A page sends several requests at once: this one missed the row in its
        # lookup, and another inserted it before this one's insert.
        winner = CustomUser.objects.create_user(username=self.EMAIL, email=self.EMAIL)

        self.assertEqual(views._create_profile(self.EMAIL), winner)
        self.assertEqual(CustomUser.objects.filter(email=self.EMAIL).count(), 1)

    def test_a_name_held_by_another_address_takes_nothing_over(self):
        owner = CustomUser.objects.create_user(
            username='boss@example.com', email='real@example.com', password='x', is_staff=True
        )

        self.assertEqual(self.me('boss@example.com').json(), {'authenticated': False})
        self.assertEqual(self.patch({'bio': 'Чужой'}, email='boss@example.com').status_code, 404)

        owner.refresh_from_db()
        self.assertEqual(owner.bio, '')
        self.assertEqual(CustomUser.objects.count(), 1)

    def test_what_is_not_an_address_makes_no_row(self):
        # Sign-up doesn't check the format, and a name without «@» would be shown to others as is.
        for subject in ('Директор школы', 'a' * 150 + '@example.com'):
            with self.subTest(subject=subject):
                self.assertEqual(self.me(subject).json(), {'authenticated': False})
                self.assertEqual(self.patch({'bio': 'Текст'}, email=subject).status_code, 404)
        self.assertFalse(CustomUser.objects.exists())

    def test_the_address_is_kept_exactly_as_it_came(self):
        # Every app keys its rows by this same string, so a normalised copy would never be found again.
        email = 'Mixed.Case@Example.COM'

        first = self.me(email).json()

        self.assertEqual(first['email'], email)
        self.assertEqual(self.me(email).json()['id'], first['id'])
        self.assertEqual(CustomUser.objects.count(), 1)

    def test_a_lookalike_address_does_not_reach_another_row(self):
        owner = CustomUser.objects.create_user(
            username='owner', email='admin@example.com', password='x', is_staff=True
        )

        for lookalike in ('ADMIN@example.com', 'admin@EXAMPLE.com', 'admın@example.com'):
            with self.subTest(lookalike=lookalike):
                body = self.me(lookalike).json()
                self.assertNotEqual(body['id'], owner.id)
                self.assertFalse(body['is_admin'])


class LeaderboardConsentTests(TestCase):
    """The public leaderboard and search show those who agreed, and each student themselves."""

    NEW = 'new@example.com'
    VIEWER = 'viewer@example.com'

    def setUp(self):
        self.client = Client()
        self.viewer = CustomUser.objects.create_user(
            username='viewer', email=self.VIEWER, password='x', show_in_leaderboard=True,
        )
        # Made the way a real first request makes it.
        self.new_id = self.get('/api/me/', self.NEW).json()['id']

    def get(self, url, email=VIEWER):
        return self.client.get(url, **auth_headers(email))

    def patch_me(self, body, email=NEW):
        return self.client.patch(
            '/api/me/',
            data=json.dumps(body),
            content_type='application/json',
            **auth_headers(email),
        )

    def post(self, url, body, email=VIEWER):
        return self.client.post(
            url,
            data=json.dumps(body),
            content_type='application/json',
            **auth_headers(email),
        )

    def board_ids(self, query='', email=VIEWER):
        return [row['id'] for row in self.get(f'/api/leaderboard/{query}', email).json()['results']]

    def test_a_new_account_is_off_until_asked(self):
        self.assertFalse(self.get('/api/me/', self.NEW).json()['show_in_leaderboard'])
        self.assertFalse(CustomUser().show_in_leaderboard)

    def test_others_do_not_see_a_new_account(self):
        self.assertNotIn(self.new_id, self.board_ids())
        self.assertEqual(self.get(f'/api/leaderboard/{self.new_id}/').status_code, 404)

    def test_a_student_always_sees_their_own_place(self):
        CustomUser.objects.filter(pk=self.viewer.pk).update(overall_elo=1500)

        self.assertEqual(self.board_ids(email=self.NEW), [self.viewer.id, self.new_id])
        self.assertEqual(self.get(f'/api/leaderboard/{self.new_id}/', self.NEW).status_code, 200)

    def test_consent_shows_them_and_withdrawing_hides_them_again(self):
        response = self.patch_me({'show_in_leaderboard': True})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()['show_in_leaderboard'])
        self.assertIn(self.new_id, self.board_ids())
        self.assertEqual(self.get(f'/api/leaderboard/{self.new_id}/').status_code, 200)

        response = self.patch_me({'show_in_leaderboard': False})
        self.assertFalse(response.json()['show_in_leaderboard'])
        self.assertNotIn(self.new_id, self.board_ids())
        self.assertEqual(self.get(f'/api/leaderboard/{self.new_id}/').status_code, 404)

    def test_filters_follow_the_same_rule(self):
        CustomUser.objects.filter(pk=self.new_id).update(country_code='KZ')
        physics = Discipline.objects.create(name='Физика')
        UserRating.objects.create(user_id=self.new_id, discipline=physics)
        by_subject = '?discipline_name=Физика'
        by_country = '?country_code=KZ'

        self.assertEqual(self.board_ids(by_subject), [])
        self.assertEqual(self.board_ids(by_country), [])
        self.assertEqual(self.board_ids(by_subject, email=self.NEW), [self.new_id])
        self.assertEqual(self.board_ids(by_country, email=self.NEW), [self.new_id])

        self.patch_me({'show_in_leaderboard': True})
        self.assertEqual(self.board_ids(by_subject), [self.new_id])
        self.assertEqual(self.board_ids(by_country), [self.new_id])

    def test_description_and_consent_are_saved_separately(self):
        self.patch_me({'bio': 'Про себя'})
        self.assertFalse(CustomUser.objects.get(pk=self.new_id).show_in_leaderboard)

        self.patch_me({'show_in_leaderboard': True})
        self.patch_me({'bio': 'Уже другое'})
        user = CustomUser.objects.get(pk=self.new_id)
        self.assertTrue(user.show_in_leaderboard)
        self.assertEqual(user.bio, 'Уже другое')

        self.patch_me({'show_in_leaderboard': False})
        self.assertEqual(CustomUser.objects.get(pk=self.new_id).bio, 'Уже другое')

    def test_consent_takes_only_a_yes_or_a_no(self):
        for value in ('может быть', None, []):
            with self.subTest(value=value):
                self.assertEqual(self.patch_me({'show_in_leaderboard': value}).status_code, 400)
        self.assertFalse(CustomUser.objects.get(pk=self.new_id).show_in_leaderboard)

    def test_a_student_changes_only_their_own_setting(self):
        self.patch_me({'show_in_leaderboard': False}, email=self.VIEWER)
        self.patch_me({'show_in_leaderboard': True}, email=self.NEW)

        self.viewer.refresh_from_db()
        self.assertFalse(self.viewer.show_in_leaderboard)
        self.assertTrue(CustomUser.objects.get(pk=self.new_id).show_in_leaderboard)

    def test_the_public_row_gives_away_no_address(self):
        self.patch_me({'show_in_leaderboard': True})

        response = self.get(f'/api/leaderboard/{self.new_id}/')
        row = response.json()

        self.assertEqual(row['username'], f'Ученик {self.new_id}')
        self.assertNotIn('new@', response.content.decode())
        self.assertNotIn('show_in_leaderboard', row)
        # The student is told exactly this name before agreeing.
        self.assertEqual(self.get('/api/me/', self.NEW).json()['public_username'], row['username'])


class ExistingAccountsMigrationTests(TestCase):
    def test_accounts_from_before_consent_stay_visible(self):
        old = CustomUser.objects.create_user(username='old', email='old@example.com', password='x')
        self.assertFalse(old.show_in_leaderboard)

        module = importlib.import_module('accounts.migrations.0008_customuser_show_in_leaderboard')
        module.keep_existing_visible(apps, None)

        old.refresh_from_db()
        self.assertTrue(old.show_in_leaderboard)


def _account(name, **fields):
    return CustomUser.objects.create_user(username=name, email=f'{name}@example.com', **fields)


def _many_students(count):
    CustomUser.objects.bulk_create(
        CustomUser(username=f'student{index}', email=f'student{index}@example.com', show_in_leaderboard=True)
        for index in range(count)
    )


def _contest(title, starts_in_hours, ends_in_hours, tasks=()):
    now = timezone.now()
    contest = Contest.objects.create(
        title=title,
        start_time=now + timedelta(hours=starts_in_hours),
        end_time=now + timedelta(hours=ends_in_hours),
    )
    contest.tasks.set(tasks)
    return contest


class _ApiTestCase(TestCase):
    def get(self, url, user):
        return self.client.get(url, **auth_headers(user.email))

    def post(self, url, user, body=None):
        return self.client.post(
            url, data=json.dumps(body or {}), content_type='application/json', **auth_headers(user.email),
        )


class ContestSecrecyTests(_ApiTestCase):
    """Условие закрыто до начала контеста, авторское решение до его конца."""

    def setUp(self):
        self.author = _account('author', is_staff=True)
        self.student = _account('student')
        self.moderator = _account('moderator', is_moderator=True)

    def task(self, title, **fields):
        fields.setdefault('author', self.author)
        return Task.objects.create(
            title=title,
            condition_text=f'условие {title}',
            author_solution_image=f'решение {title}',
            status='active',
            **fields,
        )

    def contest_row(self, contest, user=None):
        rows = self.get('/api/contests/', user or self.student).json()
        return next(row for row in rows if row['id'] == contest.id)

    def details(self, contest, user=None):
        return {row['id']: row for row in self.contest_row(contest, user)['task_details']}

    def listed_task_ids(self, user=None):
        return {row['id'] for row in self.get('/api/tasks/', user or self.student).json()}

    def test_nothing_of_a_future_contest_is_readable(self):
        task = self.task('будущая')
        contest = _contest('Скоро', 24, 25, [task])

        row = self.contest_row(contest)
        self.assertEqual(row['task_details'], [])
        # Число задач остаётся: страница пишет «4 задачи», а открыть задачу по номеру нельзя.
        self.assertEqual(row['tasks'], [task.id])
        self.assertNotIn(task.id, self.listed_task_ids())
        self.assertEqual(self.get(f'/api/tasks/{task.id}/', self.student).status_code, 404)
        self.assertEqual(self.get(f'/api/contests/{contest.id}/', self.student).json()['task_details'], [])

    def test_running_contest_shows_the_statement_but_not_the_solution(self):
        task = self.task('идёт')
        contest = _contest('Сейчас', -1, 1, [task])

        shown = self.details(contest)[task.id]
        self.assertEqual(shown['condition_text'], 'условие идёт')
        self.assertNotIn('author_solution_image', shown)
        self.assertIn(task.id, self.listed_task_ids())
        one = self.get(f'/api/tasks/{task.id}/', self.student).json()
        self.assertEqual(one['condition_text'], 'условие идёт')
        self.assertNotIn('author_solution_image', one)

    def test_finished_contest_shows_the_solution(self):
        task = self.task('прошла')
        contest = _contest('Вчера', -25, -24, [task])

        self.assertEqual(self.details(contest)[task.id]['author_solution_image'], 'решение прошла')
        one = self.get(f'/api/tasks/{task.id}/', self.student).json()
        self.assertEqual(one['author_solution_image'], 'решение прошла')

    def test_a_contest_opens_exactly_at_its_start_and_closes_at_its_end(self):
        # Те же границы, что у страницы контестов: начало и конец уже считаются наступившими.
        now = timezone.now()
        task = self.task('граница')
        contest = Contest.objects.create(title='Только что', start_time=now, end_time=now + timedelta(hours=1))
        contest.tasks.set([task])
        with patch('django.utils.timezone.now', return_value=now):
            self.assertIn(task.id, self.details(contest))

            Contest.objects.filter(pk=contest.pk).update(start_time=now - timedelta(hours=1), end_time=now)
            self.assertIn('author_solution_image', self.details(contest)[task.id])

    def test_reused_task_stays_closed_until_its_next_contest_starts(self):
        # Иначе условие будущего контеста читалось бы в прошедшем, где эта задача уже была.
        task = self.task('снова')
        other = self.task('другая')
        past = _contest('Вчера', -25, -24, [task, other])
        _contest('Скоро', 24, 25, [task])

        self.assertEqual(set(self.details(past)), {other.id})
        self.assertCountEqual(self.contest_row(past)['tasks'], [task.id, other.id])
        self.assertNotIn(task.id, self.listed_task_ids())

    def test_reused_task_shows_no_solution_while_another_contest_runs(self):
        task = self.task('снова')
        past = _contest('Вчера', -25, -24, [task])
        running = _contest('Сейчас', -1, 1, [task])

        self.assertNotIn('author_solution_image', self.details(past)[task.id])
        self.assertNotIn('author_solution_image', self.details(running)[task.id])

    def test_running_contest_keeps_its_statement_when_the_task_is_also_in_a_future_one(self):
        task = self.task('снова')
        running = _contest('Сейчас', -1, 1, [task])
        future = _contest('Скоро', 24, 25, [task])

        self.assertEqual(self.details(running)[task.id]['condition_text'], 'условие снова')
        self.assertEqual(self.details(future), {})

    def test_task_stays_closed_until_it_gets_a_contest(self):
        # Админ сначала создаёт задачу и только потом контест: иначе условие было бы открыто всё это время.
        task = self.task('черновик')

        self.assertNotIn(task.id, self.listed_task_ids())
        self.assertEqual(self.get(f'/api/tasks/{task.id}/', self.student).status_code, 404)

    def test_staff_see_everything_before_the_start(self):
        task = self.task('будущая')
        contest = _contest('Скоро', 24, 25, [task])

        for user in (self.author, self.moderator):
            with self.subTest(user=user.username):
                shown = self.details(contest, user)[task.id]
                self.assertEqual(shown['condition_text'], 'условие будущая')
                self.assertEqual(shown['author_solution_image'], 'решение будущая')
                self.assertIn(task.id, self.listed_task_ids(user))

    def test_author_reads_their_own_task(self):
        # Он сам это написал: скрывать нечего, а поле иначе стало бы доступно только на запись.
        task = self.task('своя', author=self.student)
        _contest('Скоро', 24, 25, [task])

        one = self.get(f'/api/tasks/{task.id}/', self.student).json()
        self.assertEqual(one['condition_text'], 'условие своя')
        self.assertEqual(one['author_solution_image'], 'решение своя')
        self.assertIn(task.id, self.listed_task_ids())

    def test_closed_task_cannot_be_named_through_a_submission(self):
        # Ответ на отправку называет задачу и её баллы.
        future = self.task('будущая')
        _contest('Скоро', 24, 25, [future])
        draft = self.task('черновик')
        missing = self.post('/api/submissions/', self.student, {'task': 987654}).json()['task']

        for task in (future, draft):
            with self.subTest(task=task.title):
                response = self.post('/api/submissions/', self.student, {'task': task.id})
                self.assertEqual(response.status_code, 400)
                self.assertNotIn(task.title, response.content.decode())
                # Закрытая задача отвечает так же, как несуществующая.
                self.assertEqual(
                    response.json()['task'][0].replace(str(task.id), '987654'), missing[0],
                )
        self.assertFalse(TaskSubmission.objects.exists())

    def test_submission_cannot_be_moved_onto_a_closed_task(self):
        running = self.task('идёт')
        _contest('Сейчас', -1, 1, [running])
        future = self.task('будущая')
        _contest('Скоро', 24, 25, [future])
        created = self.post('/api/submissions/', self.student, {'task': running.id})
        self.assertEqual(created.status_code, 201, created.content)

        response = self.client.patch(
            f"/api/submissions/{created.json()['id']}/",
            data=json.dumps({'task': future.id}),
            content_type='application/json',
            **auth_headers(self.student.email),
        )

        self.assertEqual(response.status_code, 400)
        self.assertNotIn('будущая', response.content.decode())

    def test_submission_is_accepted_for_a_task_that_is_open(self):
        running = self.task('идёт')
        _contest('Сейчас', -1, 1, [running])

        response = self.post('/api/submissions/', self.student, {'task': running.id, 'file_url_or_code': 'x'})

        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['task_title'], 'идёт')

    def test_author_real_name_is_not_shown_with_a_task(self):
        peer = _account('peer', first_name='Настоящее', last_name='Имя')
        task = self.task('идёт', author=peer)
        contest = _contest('Сейчас', -1, 1, [task])

        self.assertEqual(self.details(contest)[task.id]['author_name'], 'peer')

    def test_contest_list_does_not_query_per_task(self):
        _contest('Первый', -25, -24, [self.task('одна')])
        with CaptureQueriesContext(connection) as few:
            self.get('/api/contests/', self.student)

        for index in range(2):
            tasks = [self.task(f'{index}-{n}', author=_account(f'a{index}{n}')) for n in range(3)]
            _contest(f'Ещё {index}', -25, -24, tasks)
        with self.assertNumQueries(len(few)):
            self.get('/api/contests/', self.student)


class LeaderboardPrivacyTests(_ApiTestCase):
    def setUp(self):
        self.viewer = _account('viewer')

    def rows(self, query=''):
        return self.get(f'/api/leaderboard/{query}', self.viewer).json()

    def test_city_is_not_in_any_answer(self):
        almaty = _account('almaty', city='Алматы', country_code='KZ', show_in_leaderboard=True)
        board = PrivateLeaderboard.objects.create(name='Группа', owner=self.viewer)
        board.members.add(self.viewer, almaty)

        listed = next(row for row in self.rows()['results'] if row['id'] == almaty.id)
        one = self.get(f'/api/leaderboard/{almaty.id}/', self.viewer).json()
        group = self.get(f'/api/private-leaderboards/{board.id}/', self.viewer).content.decode()

        self.assertNotIn('city', listed)
        self.assertEqual(listed['country_code'], 'KZ')
        self.assertNotIn('city', one)
        self.assertNotIn('city', group)
        self.assertNotIn('Алматы', group)

    def test_city_filter_is_gone(self):
        almaty = _account('almaty', city='Алматы', show_in_leaderboard=True)
        astana = _account('astana', city='Астана', show_in_leaderboard=True)

        ids = {row['id'] for row in self.rows('?city=Алматы')['results']}

        # Иначе фильтр отвечал бы на вопрос «кто живёт в этом городе».
        self.assertEqual(ids, {self.viewer.id, almaty.id, astana.id})

    def test_country_filter_stays(self):
        kz = _account('kz', country_code='KZ', show_in_leaderboard=True)
        _account('ru', country_code='RU', show_in_leaderboard=True)

        self.assertEqual([row['id'] for row in self.rows('?country_code=KZ')['results']], [kz.id])

    def test_student_still_reads_their_own_city(self):
        almaty = _account('almaty', city='Алматы')

        self.assertEqual(self.get('/api/me/', almaty).json()['city'], 'Алматы')

    def test_one_answer_does_not_hold_the_whole_list(self):
        _many_students(120)

        first = self.rows()

        self.assertEqual(first['count'], 121)
        self.assertEqual(len(first['results']), 100)
        self.assertIsNotNone(first['next'])
        self.assertEqual(len(self.rows('?page=2')['results']), 21)
        self.assertIsNone(self.rows('?page=2')['next'])

    def test_a_client_cannot_ask_for_a_bigger_page(self):
        _many_students(120)

        for query in ('?page_size=1000', '?limit=1000', '?page=1&page_size=121'):
            with self.subTest(query=query):
                self.assertEqual(len(self.rows(query)['results']), 100)

    def test_equal_points_do_not_repeat_or_drop_across_pages(self):
        # У всех старт 1200: без второго ключа порядок равных между запросами не определён.
        _many_students(120)

        ids = [row['id'] for page in (1, 2) for row in self.rows(f'?page={page}')['results']]

        self.assertEqual(len(ids), 121)
        self.assertEqual(len(set(ids)), 121)
        self.assertEqual(ids, sorted(ids))

    def test_every_order_has_a_tie_breaker(self):
        # SQLite отдаёт равных по порядку строк и не покажет ошибку, а PostgreSQL может перемешать.
        math = Discipline.objects.create(name='Математика')
        UserRating.objects.create(user=self.viewer, discipline=math)
        for query in ('', '?discipline_name=Математика'):
            with self.subTest(query=query), CaptureQueriesContext(connection) as queries:
                self.rows(query)
                # Поиск самого ученика тоже сортирует по id, поэтому берём запрос с баллами.
                orders = [row['sql'].split('ORDER BY')[1] for row in queries if 'ORDER BY' in row['sql']]
                listed = next(order for order in orders if 'elo' in order)
                self.assertIn('"accounts_customuser"."id" ASC', listed)

    def test_hidden_student_finds_their_own_row_on_a_later_page(self):
        # Своё место видно всегда, а страница рейтинга ищет его во всём списке.
        _many_students(120)
        CustomUser.objects.filter(pk=self.viewer.pk).update(overall_elo=100)
        other = _account('other')

        first = self.rows()
        second = self.rows('?page=2')

        self.assertNotIn(self.viewer.id, [row['id'] for row in first['results']])
        self.assertEqual(second['results'][-1]['id'], self.viewer.id)
        seen_by_other = self.get('/api/leaderboard/?page=2', other).json()['results']
        self.assertNotIn(self.viewer.id, [row['id'] for row in seen_by_other])

    def test_higher_rating_comes_first(self):
        top = _account('top', overall_elo=2000, show_in_leaderboard=True)

        self.assertEqual(self.rows()['results'][0]['id'], top.id)


class PrivateBoardConsentTests(_ApiTestCase):
    """В группу человек вступает только сам, по коду, который ему дал создатель."""

    def setUp(self):
        self.owner = _account('owner', first_name='Руслан', last_name='Настоящий')
        self.friend = _account('friend', first_name='Камила', last_name='Настоящая')
        self.stranger = _account('stranger')
        self.board = self.post(
            '/api/private-leaderboards/', self.owner, {'name': '9 «Б»'},
        ).json()

    def code(self):
        return self.board['invite_code']

    def member_ids(self):
        return set(PrivateLeaderboard.objects.get(pk=self.board['id']).members.values_list('pk', flat=True))

    def join(self, user, code=None):
        return self.post('/api/private-leaderboards/join/', user, {'code': code or self.code()})

    def test_nobody_can_be_added_by_someone_else(self):
        for body in (
            {'user_id': self.friend.id},
            {'identifier': self.friend.username},
            {'identifier': str(self.friend.id)},
        ):
            with self.subTest(body=body):
                response = self.post(
                    f"/api/private-leaderboards/{self.board['id']}/add-member/", self.owner, body,
                )
                self.assertEqual(response.status_code, 404)
        self.assertEqual(self.member_ids(), {self.owner.id})
        self.assertEqual(self.get('/api/private-leaderboards/', self.friend).json(), [])

    def test_students_cannot_be_looked_up_by_name(self):
        # Настоящее имя связало бы ученика с его строкой в рейтинге.
        for query in ('Камила', 'Настоящая', 'friend', str(self.friend.id)):
            with self.subTest(query=query):
                response = self.get(f'/api/users/search/?q={query}', self.stranger)
                self.assertEqual(response.status_code, 404)
                self.assertNotIn('Настоящая', response.content.decode())

    def test_a_student_joins_with_the_code_on_their_own(self):
        response = self.join(self.friend)

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.member_ids(), {self.owner.id, self.friend.id})
        self.assertEqual(response.json()['id'], self.board['id'])
        listed = self.get('/api/private-leaderboards/', self.friend).json()
        self.assertEqual([row['id'] for row in listed], [self.board['id']])

    def test_joining_a_group_does_not_show_a_hidden_student_anywhere_else(self):
        # Согласие действует только на эту группу, а показ в общем рейтинге решается отдельно.
        self.join(self.friend)

        board = self.get(f"/api/private-leaderboards/{self.board['id']}/", self.owner).json()
        self.assertIn(self.friend.id, [row['id'] for row in board['members']])
        self.assertEqual(self.get(f'/api/leaderboard/{self.friend.id}/', self.owner).status_code, 404)
        self.assertNotIn(self.friend.id, [row['id'] for row in self.get('/api/leaderboard/', self.owner).json()['results']])

    def test_code_is_forgiving_about_case_and_spaces(self):
        response = self.join(self.friend, f'  {self.code().lower()} ')

        self.assertEqual(response.status_code, 200, response.content)

    def test_joining_twice_changes_nothing(self):
        self.join(self.friend)

        self.assertEqual(self.join(self.friend).status_code, 200)
        self.assertEqual(self.member_ids(), {self.owner.id, self.friend.id})

    def test_wrong_code_finds_nothing(self):
        for code in ('', 'НЕТТАКОГО', 'AAAAAAAA'):
            with self.subTest(code=code):
                response = self.post('/api/private-leaderboards/join/', self.friend, {'code': code})
                self.assertEqual(response.status_code, 404)
        self.assertEqual(self.member_ids(), {self.owner.id})

    def test_account_without_a_profile_cannot_join(self):
        response = self.client.post(
            '/api/private-leaderboards/join/',
            data=json.dumps({'code': self.code()}),
            content_type='application/json',
            **auth_headers('no-at-sign'),
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.member_ids(), {self.owner.id})

    def test_only_the_owner_sees_the_code(self):
        self.join(self.friend)

        self.assertTrue(self.code())
        as_member = self.get(f"/api/private-leaderboards/{self.board['id']}/", self.friend).json()
        self.assertNotIn('invite_code', as_member)
        self.assertNotIn('invite_code', self.join(self.friend).json())
        self.assertNotIn('invite_code', self.get('/api/private-leaderboards/', self.friend).json()[0])
        as_owner = self.get(f"/api/private-leaderboards/{self.board['id']}/", self.owner).json()
        self.assertEqual(as_owner['invite_code'], self.code())

    def test_board_is_invisible_to_outsiders_even_with_its_number(self):
        self.assertEqual(self.get(f"/api/private-leaderboards/{self.board['id']}/", self.stranger).status_code, 404)

    def test_code_cannot_be_written(self):
        response = self.client.patch(
            f"/api/private-leaderboards/{self.board['id']}/",
            data=json.dumps({'invite_code': 'ABCDEFGH'}),
            content_type='application/json',
            **auth_headers(self.owner.email),
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['invite_code'], self.code())

    def test_new_code_replaces_the_old_one(self):
        url = f"/api/private-leaderboards/{self.board['id']}/reset-code/"
        self.join(self.friend)
        self.assertEqual(self.post(url, self.friend).status_code, 403)

        response = self.post(url, self.owner)

        self.assertEqual(response.status_code, 200, response.content)
        fresh = response.json()['invite_code']
        self.assertNotEqual(fresh, self.code())
        self.assertEqual(self.join(self.stranger).status_code, 404)
        self.assertEqual(self.join(self.stranger, fresh).status_code, 200)

    def test_a_member_can_leave(self):
        self.join(self.friend)

        response = self.post(f"/api/private-leaderboards/{self.board['id']}/leave/", self.friend)

        self.assertEqual(response.status_code, 204, response.content)
        self.assertEqual(self.member_ids(), {self.owner.id})
        self.assertEqual(self.get('/api/private-leaderboards/', self.friend).json(), [])

    def test_owner_cannot_leave_their_own_group(self):
        response = self.post(f"/api/private-leaderboards/{self.board['id']}/leave/", self.owner)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.member_ids(), {self.owner.id})

    def test_outsider_cannot_leave_or_touch_the_group(self):
        board_id = self.board['id']
        self.assertEqual(self.post(f'/api/private-leaderboards/{board_id}/leave/', self.stranger).status_code, 404)
        self.assertEqual(self.post(f'/api/private-leaderboards/{board_id}/reset-code/', self.stranger).status_code, 404)

    def test_owner_can_remove_a_member_and_only_the_owner(self):
        self.join(self.friend)
        self.join(self.stranger)
        url = f"/api/private-leaderboards/{self.board['id']}/remove-member/"

        self.assertEqual(self.post(url, self.stranger, {'user_id': self.friend.id}).status_code, 403)
        self.assertEqual(self.member_ids(), {self.owner.id, self.friend.id, self.stranger.id})

        response = self.post(url, self.owner, {'user_id': self.friend.id})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.member_ids(), {self.owner.id, self.stranger.id})

    def test_members_see_the_public_name_of_the_owner_only(self):
        self.join(self.friend)

        body = self.get(f"/api/private-leaderboards/{self.board['id']}/", self.friend)

        self.assertEqual(body.json()['owner_name'], 'owner')
        self.assertNotIn('Настоящий', body.content.decode())
        self.assertNotIn('Настоящая', body.content.decode())

    def test_every_group_gets_its_own_code(self):
        other = self.post('/api/private-leaderboards/', self.friend, {'name': 'Другая'}).json()

        self.assertNotEqual(other['invite_code'], self.code())


class BoardConsentMigrationTests(TestCase):
    def test_existing_groups_keep_only_their_owner_and_get_a_code(self):
        # Всех остальных в эти группы добавили, не спросив.
        owner = _account('owner')
        board = PrivateLeaderboard.objects.create(name='Старая', owner=owner)
        board.members.add(owner, _account('added'))
        without_owner = PrivateLeaderboard.objects.create(name='Без создателя', owner=_account('other'))
        without_owner.members.add(owner)
        old_codes = {board.invite_code, without_owner.invite_code}
        migration = import_module('accounts.migrations.0010_board_codes_and_consent')

        migration.give_codes_and_keep_only_owners(apps, None)

        for row in PrivateLeaderboard.objects.all():
            self.assertEqual(list(row.members.values_list('pk', flat=True)), [row.owner_id])
            self.assertNotIn(row.invite_code, old_codes)
