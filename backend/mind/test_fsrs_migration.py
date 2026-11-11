"""Миграция `mind.0005_topic_fsrs`: начальная память FSRS из полей SM-2.

TransactionTestCase, а не TestCase: схема откатывается и накатывается внутри
теста, а SQLite не меняет схему в открытой транзакции.
"""

from __future__ import annotations

import importlib
from datetime import datetime, timedelta, timezone as dt_timezone

from django.apps import apps as django_apps
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import SimpleTestCase, TestCase, TransactionTestCase

from mind.srs import MAX_EASE_FACTOR, MIN_EASE_FACTOR, STATE_NEW, STATE_REVIEW, ease_from_difficulty

BEFORE = [("mind", "0004_add_order_index_to_subject")]
AFTER = [("mind", "0005_topic_fsrs")]
REVIEWED_AT = datetime(2026, 11, 1, 15, 30, tzinfo=dt_timezone.utc)


def _migration():
    return importlib.import_module("mind.migrations.0005_topic_fsrs")


class Sm2MappingTests(SimpleTestCase):
    """Формула перевода записана в миграции. Проверяем её таблицей."""

    def test_stability_is_the_old_interval(self) -> None:
        to_fsrs = _migration().fsrs_from_sm2
        self.assertEqual(to_fsrs(1, 2.5)[0], 1.0)
        self.assertEqual(to_fsrs(7, 2.5)[0], 7.0)
        self.assertEqual(to_fsrs(45, 2.5)[0], 45.0)
        # Интервала нет или он испорчен: хотя бы день.
        self.assertEqual(to_fsrs(None, 2.5)[0], 1.0)
        self.assertEqual(to_fsrs(0, 2.5)[0], 1.0)

    def test_difficulty_is_a_straight_line_from_ease(self) -> None:
        to_fsrs = _migration().fsrs_from_sm2
        self.assertAlmostEqual(to_fsrs(3, 3.0)[1], 1.0)
        self.assertAlmostEqual(to_fsrs(3, 1.3)[1], 10.0)
        self.assertAlmostEqual(to_fsrs(3, 2.15)[1], 5.5)
        self.assertAlmostEqual(to_fsrs(3, None)[1], to_fsrs(3, 2.5)[1])
        # За краями SM-2 не выходим за края FSRS.
        self.assertAlmostEqual(to_fsrs(3, 0.5)[1], 10.0)
        self.assertAlmostEqual(to_fsrs(3, 4.0)[1], 1.0)

    def test_code_maps_difficulty_back_to_the_same_ease(self) -> None:
        """Миграция держит формулу у себя, код — обратную. Разойтись они не должны."""
        to_fsrs = _migration().fsrs_from_sm2
        for ease in (MIN_EASE_FACTOR, 1.75, 2.0, 2.5, 2.8, MAX_EASE_FACTOR):
            self.assertAlmostEqual(ease_from_difficulty(to_fsrs(5, ease)[1]), ease, places=3)


class SeedTwiceTests(TestCase):
    """Повторный прогон заполнения не трогает темы, у которых память FSRS уже есть."""

    def test_seed_keeps_existing_fsrs_memory(self) -> None:
        from mind.models import Subject, Topic

        subject = Subject.objects.create(name="Физика", user_email="student@example.com")
        topic = Topic.objects.create(
            subject=subject,
            name="Инерция",
            interval_days=7,
            ease_factor=2.0,
            last_revised_at=REVIEWED_AT,
            fsrs_stability=42.0,
            fsrs_difficulty=3.0,
            fsrs_state=STATE_REVIEW,
            fsrs_reps=6,
            fsrs_lapses=2,
        )

        _migration().seed_fsrs_memory(django_apps, None)

        topic.refresh_from_db()
        self.assertEqual(
            (topic.fsrs_stability, topic.fsrs_difficulty, topic.fsrs_reps, topic.fsrs_lapses),
            (42.0, 3.0, 6, 2),
        )


class TopicFsrsMigrationTests(TransactionTestCase):
    def _migrate(self, targets):
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(targets)
        return executor.loader.project_state(targets).apps

    def tearDown(self) -> None:
        # Остальные тесты ждут последнюю схему.
        executor = MigrationExecutor(connection)
        executor.loader.build_graph()
        executor.migrate(executor.loader.graph.leaf_nodes())

    def test_reviewed_topics_get_memory_and_keep_their_dates(self) -> None:
        old_apps = self._migrate(BEFORE)
        Subject = old_apps.get_model("mind", "Subject")
        Topic = old_apps.get_model("mind", "Topic")
        subject = Subject.objects.create(name="Физика", user_email="student@example.com")

        def add(name, **fields):
            # str(): у объекта из памяти pk — UUID, а из базы приходит строка.
            return str(Topic.objects.create(subject=subject, name=name, **fields).pk)

        reviewed = add(
            "Инерция",
            status="SUCCESS",
            interval_days=7,
            ease_factor=2.0,
            last_revised_at=REVIEWED_AT,
            next_review_at=REVIEWED_AT + timedelta(days=7),
        )
        studied_today = add(
            "Импульс",
            status="MEDIUM",
            interval_days=1,
            last_revised_at=REVIEWED_AT,
            next_review_at=REVIEWED_AT + timedelta(days=1),
        )
        overdue = add(
            "Работа",
            status="MASTERED",
            interval_days=30,
            ease_factor=2.9,
            last_revised_at=REVIEWED_AT - timedelta(days=60),
            next_review_at=REVIEWED_AT - timedelta(days=30),
        )
        never = add("Мощность")
        no_date = add("Энергия", interval_days=5, status="MEDIUM")

        new_apps = self._migrate(AFTER)
        Topic = new_apps.get_model("mind", "Topic")
        rows = {str(row.pk): row for row in Topic.objects.all()}

        topic = rows[reviewed]
        self.assertEqual(topic.fsrs_stability, 7.0)
        self.assertAlmostEqual(topic.fsrs_difficulty, 1 + (3.0 - 2.0) * 9 / 1.7)
        self.assertEqual(
            (topic.fsrs_state, topic.fsrs_reps, topic.fsrs_lapses), (STATE_REVIEW, 1, 0)
        )
        # Дата повторения и всё прежнее не трогаются: «пора повторить» не вспыхнет.
        self.assertEqual(topic.next_review_at, REVIEWED_AT + timedelta(days=7))
        self.assertEqual(topic.last_revised_at, REVIEWED_AT)
        self.assertEqual((topic.status, topic.interval_days, topic.ease_factor), ("SUCCESS", 7, 2.0))

        self.assertEqual(rows[studied_today].fsrs_stability, 1.0)
        self.assertEqual(rows[studied_today].fsrs_state, STATE_REVIEW)
        self.assertEqual(rows[overdue].fsrs_stability, 30.0)
        self.assertEqual(rows[overdue].next_review_at, REVIEWED_AT - timedelta(days=30))

        for pk in (never, no_date):
            untouched = rows[pk]
            self.assertIsNone(untouched.fsrs_stability)
            self.assertIsNone(untouched.fsrs_difficulty)
            self.assertEqual(
                (untouched.fsrs_state, untouched.fsrs_reps, untouched.fsrs_lapses), (STATE_NEW, 0, 0)
            )
        self.assertEqual(rows[no_date].interval_days, 5)
