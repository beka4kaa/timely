"""Цели: обычное создание, цвет, предметы и ровно одна главная цель у ученика."""

import importlib
from datetime import date, timedelta

from django.apps import apps
from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from config.testing import auth_headers
from curriculum.models import LearningGoal

from .models import Goal

STUDENT = 'student@example.com'
OTHER = 'other@example.com'


def goal_of(email, title, **fields):
    fields.setdefault('type', 'goal')
    return Goal.objects.create(user_email=email, title=title, **fields)


class _Base(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.credentials(**auth_headers(STUDENT))

    def main_goals(self, email=STUDENT):
        return list(Goal.objects.filter(user_email=email, is_main=True).values_list('title', flat=True))

    def create(self, **body):
        body.setdefault('type', 'goal')
        return self.client.post('/api/goals/', body, format='json')

    def patch(self, goal, **body):
        return self.client.patch(f'/api/goals/{goal.pk}/', body, format='json')


class CreatingTests(_Base):
    def test_creating_one_goal_leaves_the_others_alone(self):
        old = goal_of(STUDENT, 'Старая', status='active')

        response = self.create(title='Новая', dueDate='2026-12-03', status='active')

        self.assertEqual(response.status_code, 201)
        old.refresh_from_db()
        self.assertEqual(old.status, 'active')
        self.assertEqual(Goal.objects.filter(user_email=STUDENT).count(), 2)
        self.assertEqual(response.data['title'], 'Новая')
        self.assertEqual(response.data['dueDate'], '2026-12-03')
        self.assertEqual(response.data['user_email'], STUDENT)
        self.assertIsInstance(response.data['id'], str)

    def test_keeps_the_new_fields_and_the_old_ones(self):
        response = self.create(title='Цель', tone='teal', scope='study', progress=12, priority='high')

        self.assertEqual(response.data['tone'], 'teal')
        self.assertEqual(response.data['scope'], 'study')
        self.assertEqual(response.data['progress'], 12)
        self.assertEqual(response.data['computed_progress'], 12)
        self.assertEqual(response.data['priority'], 'high')
        self.assertEqual(response.data['children_count'], 0)

    def test_old_goals_have_no_tone_or_scope_yet(self):
        goal = goal_of(STUDENT, 'Старая')

        row = self.client.get(f'/api/goals/{goal.pk}/').data

        self.assertEqual(row['tone'], '')
        self.assertEqual(row['scope'], '')
        self.assertEqual(row['lessons'], [])

    def test_refuses_an_unknown_tone_or_scope(self):
        self.assertEqual(self.create(title='Цель', tone='сиреневый').status_code, 400)
        self.assertEqual(self.create(title='Цель', scope='работа').status_code, 400)

    def test_refuses_impossible_progress(self):
        self.assertEqual(self.create(title='Цель', progress=101).status_code, 400)
        self.assertEqual(self.create(title='Цель', progress=-1).status_code, 400)


class OneMainGoalTests(_Base):
    def test_the_first_goal_becomes_main_by_itself(self):
        first = self.create(title='Первая')
        second = self.create(title='Вторая')

        self.assertTrue(first.data['isMain'])
        self.assertFalse(second.data['isMain'])
        self.assertEqual(self.main_goals(), ['Первая'])

    def test_choosing_another_moves_the_star(self):
        goal_of(STUDENT, 'Была главной', is_main=True)
        other = goal_of(STUDENT, 'Другая')

        response = self.patch(other, isMain=True)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['isMain'])
        self.assertEqual(self.main_goals(), ['Другая'])

    def test_a_new_goal_can_be_main_right_away(self):
        goal_of(STUDENT, 'Была главной', is_main=True)

        response = self.create(title='Сразу главная', isMain=True)

        self.assertTrue(response.data['isMain'])
        self.assertEqual(self.main_goals(), ['Сразу главная'])

    def test_the_only_goal_cannot_stop_being_main(self):
        goal = goal_of(STUDENT, 'Единственная', is_main=True)

        response = self.patch(goal, isMain=False)

        self.assertTrue(response.data['isMain'])
        self.assertEqual(self.main_goals(), ['Единственная'])

    def test_finishing_or_deleting_the_main_goal_passes_it_on(self):
        for finish in (
            lambda goal: self.patch(goal, status='done'),
            lambda goal: self.patch(goal, status='archived'),
            lambda goal: self.client.patch(f'/api/goals/{goal.pk}/progress/', {'progress': 100}, format='json'),
            lambda goal: self.client.delete(f'/api/goals/{goal.pk}/'),
        ):
            Goal.objects.all().delete()
            main = goal_of(STUDENT, 'Главная', is_main=True)
            goal_of(STUDENT, 'Далёкая', due_date=date(2030, 1, 1))
            goal_of(STUDENT, 'Близкая', due_date=date(2027, 1, 1))
            goal_of(STUDENT, 'Без срока')

            self.assertLess(finish(main).status_code, 300)

            self.assertEqual(self.main_goals(), ['Близкая'])

    def test_with_nothing_left_there_is_no_main(self):
        main = goal_of(STUDENT, 'Последняя', is_main=True)

        self.patch(main, status='done')

        self.assertEqual(self.main_goals(), [])

    def test_a_goal_coming_back_does_not_take_the_star_by_itself(self):
        goal_of(STUDENT, 'Новая главная', is_main=True)
        done = goal_of(STUDENT, 'Завершённая', status='done', progress=100)

        response = self.patch(done, status='active', progress=40)

        self.assertFalse(response.data['isMain'])
        self.assertEqual(self.main_goals(), ['Новая главная'])

    def test_it_can_take_the_star_back_when_asked(self):
        goal_of(STUDENT, 'Новая главная', is_main=True)
        archived = goal_of(STUDENT, 'Вернулась', status='archived')

        response = self.patch(archived, status='active', isMain=True)

        self.assertTrue(response.data['isMain'])
        self.assertEqual(self.main_goals(), ['Вернулась'])

    def test_a_finished_goal_or_a_task_cannot_be_main(self):
        done = goal_of(STUDENT, 'Завершённая', status='done')
        task = goal_of(STUDENT, 'Задача', type='task')

        self.assertEqual(self.patch(done, isMain=True).status_code, 400)
        self.assertEqual(self.patch(task, isMain=True).status_code, 400)
        self.assertEqual(self.create(title='Задача', type='task', isMain=True).status_code, 400)
        self.assertEqual(self.main_goals(), [])

    def test_students_do_not_share_a_star(self):
        goal_of(OTHER, 'Чужая главная', is_main=True)

        self.create(title='Своя')

        self.assertEqual(self.main_goals(), ['Своя'])
        self.assertEqual(self.main_goals(OTHER), ['Чужая главная'])

    def test_the_database_refuses_two_main_goals(self):
        goal_of(STUDENT, 'Одна', is_main=True)

        with self.assertRaises(IntegrityError), transaction.atomic():
            goal_of(STUDENT, 'Вторая', is_main=True)

    def test_someone_elses_goal_cannot_be_chosen(self):
        theirs = goal_of(OTHER, 'Чужая')

        self.assertEqual(self.patch(theirs, isMain=True).status_code, 404)
        self.assertEqual(self.main_goals(OTHER), [])


class FirstMainGoalMigrationTests(TestCase):
    def run_migration(self):
        module = importlib.import_module('planner.migrations.0006_goal_tone_scope_is_main_lessons')
        module.choose_main_goals(apps, None)

    def test_picks_one_per_student_by_priority_then_deadline(self):
        today = date(2026, 11, 5)
        goal_of(STUDENT, 'Низкий приоритет', priority='low', due_date=today)
        goal_of(STUDENT, 'Важная, но дальше', priority='high', due_date=today + timedelta(days=90))
        goal_of(STUDENT, 'Важная и близко', priority='high', due_date=today + timedelta(days=9))
        goal_of(STUDENT, 'Завершённая', priority='critical', status='done')
        goal_of(STUDENT, 'Задача', priority='critical', type='task')
        goal_of(OTHER, 'Без приоритета')

        self.run_migration()

        self.assertEqual(
            sorted(Goal.objects.filter(is_main=True).values_list('title', flat=True)),
            ['Без приоритета', 'Важная и близко'],
        )

    def test_a_student_with_only_finished_goals_gets_none(self):
        goal_of(STUDENT, 'Завершённая', status='done')

        self.run_migration()

        self.assertFalse(Goal.objects.filter(is_main=True).exists())


class ProgressTests(_Base):
    def setUp(self):
        super().setUp()
        self.goal = goal_of(STUDENT, 'Цель', status='active')

    def move(self, value):
        return self.client.patch(f'/api/goals/{self.goal.pk}/progress/', {'progress': value}, format='json')

    def test_moves_by_hand(self):
        response = self.move(40)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['progress'], 40)
        self.assertEqual(response.data['status'], 'active')

    def test_the_top_finishes_the_goal(self):
        self.assertEqual(self.move(100).data['status'], 'done')

    def test_refuses_nonsense(self):
        for value in (101, -5, 'много', None):
            with self.subTest(value=value):
                self.assertEqual(self.move(value).status_code, 400)


class LessonsTests(_Base):
    def setUp(self):
        super().setUp()
        self.own = LearningGoal.objects.create(user_email=STUDENT, original_text='Физика')
        self.theirs = LearningGoal.objects.create(user_email=OTHER, original_text='Чужая физика')

    def test_links_own_lessons(self):
        response = self.create(title='Цель', lessons=[str(self.own.pk)])

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['lessons'], [str(self.own.pk)])
        goal = Goal.objects.get(pk=response.data['id'])
        self.assertEqual(list(goal.lessons.all()), [self.own])

    def test_someone_elses_lesson_looks_like_no_lesson(self):
        response = self.create(title='Цель', lessons=[str(self.theirs.pk)])

        self.assertEqual(response.status_code, 400)
        self.assertIn('lessons', response.data)
        self.assertFalse(Goal.objects.exists())

    def test_a_malformed_id_is_a_mistake_not_a_crash(self):
        self.assertEqual(self.create(title='Цель', lessons=['не-uuid']).status_code, 400)

    def test_changes_and_clears_lessons(self):
        goal = goal_of(STUDENT, 'Цель')

        self.assertEqual(self.patch(goal, lessons=[str(self.own.pk)]).data['lessons'], [str(self.own.pk)])
        self.assertEqual(self.patch(goal, lessons=[]).data['lessons'], [])

    def test_a_deleted_lesson_just_leaves_the_goal(self):
        goal = goal_of(STUDENT, 'Цель')
        goal.lessons.add(self.own)

        self.own.delete()

        self.assertEqual(self.client.get(f'/api/goals/{goal.pk}/').data['lessons'], [])


class BulkSyncTests(_Base):
    """Полная замена осталась для старых клиентов, и новые поля она не трогает."""

    def sync(self, *goals):
        payload = [{'id': goal.pk, 'title': goal.title, 'type': goal.type, 'status': goal.status} for goal in goals]
        return self.client.post('/api/goals/bulk_sync/', {'goals': payload, 'links': []}, format='json')

    def test_keeps_tone_scope_and_the_star(self):
        goal = goal_of(STUDENT, 'Цель', tone='rose', scope='study', is_main=True)

        self.assertEqual(self.sync(goal).status_code, 200)

        goal.refresh_from_db()
        self.assertEqual((goal.tone, goal.scope, goal.is_main), ('rose', 'study', True))

    def test_passes_the_star_on_when_the_main_goal_is_left_out(self):
        goal_of(STUDENT, 'Выпала', is_main=True)
        kept = goal_of(STUDENT, 'Осталась')

        self.sync(kept)

        self.assertEqual(self.main_goals(), ['Осталась'])
