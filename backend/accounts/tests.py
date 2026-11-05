import importlib
import json

from django.apps import apps
from django.test import Client, TestCase

from . import views
from .models import CustomUser, Discipline, PrivateLeaderboard, Task, TaskSubmission, UserRating
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

        board = self.client.get('/api/leaderboard/', **headers).json()
        one = self.client.get(f'/api/leaderboard/{self.user.id}/', **headers).json()
        found = self.client.get(f'/api/users/search/?q={self.user.id}', **headers).json()

        self.assertIn(self.user.id, [row['id'] for row in board])
        self.assertTrue(all('bio' not in row for row in board))
        self.assertNotIn('bio', one)
        self.assertTrue(found and all('bio' not in row for row in found))


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
        return [row['id'] for row in self.get(f'/api/leaderboard/{query}', email).json()]

    def found_ids(self, q, email=VIEWER):
        return [row['id'] for row in self.get(f'/api/users/search/?q={q}', email).json()]

    def test_a_new_account_is_off_until_asked(self):
        self.assertFalse(self.get('/api/me/', self.NEW).json()['show_in_leaderboard'])
        self.assertFalse(CustomUser().show_in_leaderboard)

    def test_others_do_not_see_a_new_account(self):
        self.assertNotIn(self.new_id, self.board_ids())
        self.assertEqual(self.get(f'/api/leaderboard/{self.new_id}/').status_code, 404)
        self.assertEqual(self.found_ids(self.new_id), [])

    def test_a_student_always_sees_their_own_place(self):
        CustomUser.objects.filter(pk=self.viewer.pk).update(overall_elo=1500)

        self.assertEqual(self.board_ids(email=self.NEW), [self.viewer.id, self.new_id])
        self.assertEqual(self.get(f'/api/leaderboard/{self.new_id}/', self.NEW).status_code, 200)
        self.assertEqual(self.found_ids(self.new_id, email=self.NEW), [self.new_id])

    def test_consent_shows_them_and_withdrawing_hides_them_again(self):
        response = self.patch_me({'show_in_leaderboard': True})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(response.json()['show_in_leaderboard'])
        self.assertIn(self.new_id, self.board_ids())
        self.assertEqual(self.get(f'/api/leaderboard/{self.new_id}/').status_code, 200)
        self.assertEqual(self.found_ids(self.new_id), [self.new_id])

        response = self.patch_me({'show_in_leaderboard': False})
        self.assertFalse(response.json()['show_in_leaderboard'])
        self.assertNotIn(self.new_id, self.board_ids())
        self.assertEqual(self.get(f'/api/leaderboard/{self.new_id}/').status_code, 404)
        self.assertEqual(self.found_ids(self.new_id), [])

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

    def test_search_finds_only_those_who_agreed(self):
        hidden = CustomUser.objects.create_user(
            username='tihonya', email='tihonya@example.com', password='x', first_name='Тихон',
        )

        for q in ('tihonya', 'Тихон', hidden.id):
            with self.subTest(q=q):
                self.assertEqual(self.found_ids(q), [])
                self.assertEqual(self.found_ids(q, email=hidden.email), [hidden.id])

        self.patch_me({'show_in_leaderboard': True}, email=hidden.email)
        for q in ('tihonya', 'Тихон', hidden.id):
            with self.subTest(q=q, agreed=True):
                self.assertEqual(self.found_ids(q), [hidden.id])

    def test_a_group_owner_cannot_reach_a_hidden_student(self):
        hidden = CustomUser.objects.create_user(username='tihonya', email='tihonya@example.com', password='x')
        board = PrivateLeaderboard.objects.create(name='Класс', owner=self.viewer)
        url = f'/api/private-leaderboards/{board.id}/add-member/'

        for body in ({'user_id': hidden.id}, {'identifier': 'tihonya'}, {'identifier': str(hidden.id)}):
            with self.subTest(body=body):
                self.assertEqual(self.post(url, body).status_code, 404)
        self.assertFalse(board.members.filter(pk=hidden.id).exists())

        self.patch_me({'show_in_leaderboard': True}, email=hidden.email)
        self.assertEqual(self.post(url, {'user_id': hidden.id}).status_code, 200)
        self.assertTrue(board.members.filter(pk=hidden.id).exists())

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
