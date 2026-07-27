import json

from django.test import Client, TestCase

from .models import CustomUser, Task, TaskSubmission


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
        response = self.client.get('/api/me/', HTTP_X_USER_EMAIL=self.user.email)

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['has_full_access'])
        self.assertEqual(response.json()['ai_plan'], 'free')

    def test_staff_me_uses_max_plan(self):
        response = self.client.get('/api/me/', HTTP_X_USER_EMAIL=self.admin.email)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['ai_plan'], 'max')

    def test_non_admin_cannot_list_admin_users(self):
        response = self.client.get('/api/admin/users/', HTTP_X_USER_EMAIL=self.user.email)

        self.assertEqual(response.status_code, 403)

    def test_admin_can_update_user_access(self):
        response = self.client.patch(
            f'/api/admin/users/{self.user.id}/access/',
            data=json.dumps({'has_full_access': True, 'is_moderator': True}),
            content_type='application/json',
            HTTP_X_USER_EMAIL=self.admin.email,
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
            HTTP_X_USER_EMAIL=self.admin.email,
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

        response = self.client.get('/api/admin/users/', HTTP_X_USER_EMAIL=self.admin.email)

        self.assertEqual(response.status_code, 200)
        student = next(item for item in response.json() if item['email'] == self.user.email)
        self.assertEqual(student['submissions_total'], 2)
        self.assertEqual(student['submissions_approved'], 1)
        self.assertEqual(student['submissions_pending'], 1)
