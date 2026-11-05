import json

from django.test import Client, TestCase

from .models import CustomUser, Task, TaskSubmission
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

    def test_saving_a_bio_does_not_create_an_account(self):
        # A new row would put the student on the public leaderboard without asking.
        response = self.patch({'bio': 'Новый'}, email='nobody@example.com')

        self.assertEqual(response.status_code, 404)
        self.assertFalse(CustomUser.objects.filter(email='nobody@example.com').exists())

    def test_nobody_else_sees_the_bio(self):
        self.patch({'bio': 'Только для себя'})
        other = CustomUser.objects.create_user(
            username='other@example.com',
            email='other@example.com',
            password='test-pass',
        )
        headers = auth_headers(other.email)

        board = self.client.get('/api/leaderboard/', **headers).json()
        one = self.client.get(f'/api/leaderboard/{self.user.id}/', **headers).json()
        found = self.client.get(f'/api/users/search/?q={self.user.id}', **headers).json()

        self.assertTrue(board and all('bio' not in row for row in board))
        self.assertNotIn('bio', one)
        self.assertTrue(found and all('bio' not in row for row in found))
