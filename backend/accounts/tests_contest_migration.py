"""Миграция контестов: что становится черновиком и какие старые ответы привязываются."""

import importlib
from datetime import timedelta

from django.apps import apps
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone

from .models import Contest, CustomUser, Task, TaskSubmission

MIGRATION = "accounts.migrations.0012_contest_tiers_files_answers"


def migration():
    return importlib.import_module(MIGRATION)


class ContestMigrationTests(TestCase):
    def setUp(self):
        self.now = timezone.now()
        self.teacher = CustomUser.objects.create_user(username="t", email="t@example.com", password="x", is_staff=True)
        self.student = CustomUser.objects.create_user(username="s", email="s@example.com", password="x")

    def contest(self, title, start, hours=3, *tasks):
        contest = Contest.objects.create(title=title, start_time=start, end_time=start + timedelta(hours=hours))
        contest.tasks.set(tasks)
        return contest

    def task(self, title="t"):
        return Task.objects.create(author=self.teacher, title=title, status="active")

    def answer(self, task, at, status="approved"):
        row = TaskSubmission.objects.create(student=self.student, task=task, status=status)
        TaskSubmission.objects.filter(pk=row.pk).update(created_at=at)
        return row

    def test_ended_contests_stay_published_and_the_rest_become_drafts(self):
        past = self.contest("Прошёл", self.now - timedelta(days=2))
        running = self.contest("Идёт", self.now - timedelta(hours=1))
        future = self.contest("Будет", self.now + timedelta(days=2))
        Contest.objects.update(is_published=False)

        migration().publish_ended_contests(apps, None)

        self.assertTrue(Contest.objects.get(pk=past.pk).is_published)
        self.assertFalse(Contest.objects.get(pk=running.pk).is_published)
        self.assertFalse(Contest.objects.get(pk=future.pk).is_published)

    def test_old_answers_link_to_their_only_contest(self):
        single = self.task("один")
        shared = self.task("общая")
        start = self.now - timedelta(days=3)
        contest = self.contest("Кубок", start, 3, single, shared)
        self.contest("Другой", self.now - timedelta(days=10), 3, shared)

        inside = self.answer(single, start + timedelta(minutes=30))
        outside = self.answer(single, start + timedelta(days=1), status="rejected")
        on_shared = self.answer(shared, start + timedelta(minutes=40))

        migration().link_answers_to_contests(apps, None)

        self.assertEqual(TaskSubmission.objects.get(pk=inside.pk).contest_id, contest.pk)
        self.assertIsNone(TaskSubmission.objects.get(pk=outside.pk).contest_id)
        self.assertIsNone(TaskSubmission.objects.get(pk=on_shared.pk).contest_id)

    def test_only_the_earliest_accepted_answer_links(self):
        task = self.task()
        start = self.now - timedelta(days=3)
        contest = self.contest("Кубок", start, 3, task)
        late = self.answer(task, start + timedelta(minutes=50))
        early = self.answer(task, start + timedelta(minutes=10))
        wrong = self.answer(task, start + timedelta(minutes=5), status="rejected")

        migration().link_answers_to_contests(apps, None)

        self.assertEqual(TaskSubmission.objects.get(pk=early.pk).contest_id, contest.pk)
        self.assertIsNone(TaskSubmission.objects.get(pk=late.pk).contest_id)
        self.assertEqual(TaskSubmission.objects.get(pk=wrong.pk).contest_id, contest.pk)

    def test_second_accepted_answer_in_a_contest_is_refused(self):
        task = self.task()
        contest = self.contest("Кубок", self.now, 3, task)
        TaskSubmission.objects.create(student=self.student, task=task, contest=contest, status="approved")
        TaskSubmission.objects.create(student=self.student, task=task, contest=contest, status="rejected")

        with self.assertRaises(IntegrityError), transaction.atomic():
            TaskSubmission.objects.create(student=self.student, task=task, contest=contest, status="approved")

    def test_new_fields_have_their_defaults(self):
        contest = self.contest("Кубок", self.now + timedelta(days=1))
        task = self.task()
        self.assertEqual((contest.tier, contest.art, contest.is_published), (5, "rings", False))
        self.assertEqual((task.position, task.answer, task.statement_file, task.solution_file), (0, "", None, None))
