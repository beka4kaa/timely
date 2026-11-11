"""
Тесты повторения темы по FSRS: обёртка `mind.srs`, `mind.reviews` и вью.

Откуда ожидаемые значения. Числа не берутся из нашей обёртки, иначе тест
подтверждал бы сам себя:

* начальная устойчивость сверяется с параметрами самого пакета
  (`fsrs.scheduler.DEFAULT_PARAMETERS`, первые четыре веса);
* остальное проверяется свойствами, которые FSRS обещает по определению: при
  цели 0,9 интервал равен округлённой устойчивости, а через S дней шанс
  вспомнить ровно 0,9;
* сравнения («с опозданием интервал больше», «серия ошибок не застревает»)
  не зависят от конкретных весов.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo

from django.db import connection
from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from fsrs.scheduler import DEFAULT_PARAMETERS
from rest_framework.test import APIRequestFactory

from mind.srs import (
    MASTERED_STABILITY_DAYS,
    MAX_EASE_FACTOR,
    MAX_INTERVAL_DAYS,
    MIN_EASE_FACTOR,
    REVIEW_RATINGS,
    STATE_NEW,
    STATE_REVIEW,
    SUCCESS_STABILITY_DAYS,
    TopicMemory,
    clean_retention,
    ease_from_difficulty,
    next_review,
    preview_intervals,
    recall_probability,
    status_from_stability,
)

NOW = datetime(2026, 11, 11, 9, 0, tzinfo=dt_timezone.utc)
OWNER = "student@example.com"


def _known(
    stability: float,
    difficulty: float = 5.0,
    *,
    days_ago: float = 0,
    reps: int = 3,
    status: str = "MEDIUM",
) -> TopicMemory:
    """Тема, которую уже повторяли: прошлый раз `days_ago` дней назад."""
    return TopicMemory(
        stability=stability,
        difficulty=difficulty,
        state=STATE_REVIEW,
        reps=reps,
        lapses=0,
        last_review=NOW - timedelta(days=days_ago),
        status=status,
    )


class NewTopicTests(SimpleTestCase):
    """Первое повторение: у темы ещё нет памяти."""

    def test_each_rating_starts_from_the_package_initial_stability(self) -> None:
        for index, rating in enumerate(REVIEW_RATINGS):
            outcome = next_review(rating=rating, memory=TopicMemory(), now=NOW)
            self.assertAlmostEqual(outcome.stability, DEFAULT_PARAMETERS[index], places=6, msg=rating)
            self.assertEqual(outcome.reps, 1, rating)
            self.assertEqual(outcome.lapses, 0, rating)
            self.assertEqual(outcome.state, STATE_REVIEW, rating)

    def test_first_interval_is_whole_days_from_stability(self) -> None:
        # 0,212 → 1; 1,2931 → 1; 2,3065 → 2; 8,2956 → 8: при цели 0,9 интервал
        # FSRS равен устойчивости, округлённой до дня, но не меньше дня.
        days = {}
        for rating in REVIEW_RATINGS:
            outcome = next_review(rating=rating, memory=TopicMemory(), now=NOW)
            days[rating] = outcome.interval_days
            self.assertEqual(outcome.interval_days, max(1, round(outcome.stability)), rating)
            self.assertEqual(outcome.next_review_at, NOW + timedelta(days=outcome.interval_days), rating)
        self.assertEqual(days, {"AGAIN": 1, "HARD": 1, "GOOD": 2, "EASY": 8})

    def test_first_review_status_matches_the_old_progression(self) -> None:
        statuses = {
            rating: next_review(rating=rating, memory=TopicMemory(), now=NOW).status
            for rating in REVIEW_RATINGS
        }
        self.assertEqual(
            statuses,
            {"AGAIN": "MEDIUM", "HARD": "MEDIUM", "GOOD": "MEDIUM", "EASY": "SUCCESS"},
        )

    def test_new_topic_has_no_recall_probability(self) -> None:
        self.assertIsNone(recall_probability(TopicMemory(), NOW))
        self.assertIsNone(next_review(rating="GOOD", memory=TopicMemory(), now=NOW).recall_probability)

    def test_broken_numbers_count_as_new(self) -> None:
        """Поля темы правятся PATCH'ем. NaN не должен ронять повторение."""
        fresh = next_review(rating="GOOD", memory=TopicMemory(), now=NOW)
        for stability, difficulty in ((float("nan"), 5.0), (10.0, float("inf"))):
            broken = TopicMemory(
                stability=stability, difficulty=difficulty, state=STATE_REVIEW, reps=2,
                last_review=NOW - timedelta(days=3),
            )
            self.assertIsNone(recall_probability(broken, NOW))
            self.assertAlmostEqual(next_review(rating="GOOD", memory=broken, now=NOW).stability, fresh.stability)

    def test_memory_without_a_review_date_counts_as_new(self) -> None:
        """Без даты прошлого повторения шанс вспомнить не посчитать."""
        broken = TopicMemory(stability=30.0, difficulty=5.0, state=STATE_REVIEW, reps=4)
        fresh = next_review(rating="GOOD", memory=TopicMemory(), now=NOW)
        outcome = next_review(rating="GOOD", memory=broken, now=NOW)
        self.assertAlmostEqual(outcome.stability, fresh.stability)
        self.assertEqual(outcome.reps, 5)


class FourRatingsTests(SimpleTestCase):
    """Четыре оценки одной и той же темы, повторённой вовремя."""

    def setUp(self) -> None:
        self.memory = _known(10.0, days_ago=10)
        self.outcomes = {
            rating: next_review(rating=rating, memory=self.memory, now=NOW) for rating in REVIEW_RATINGS
        }

    def test_better_rating_means_more_stable_memory(self) -> None:
        stability = [self.outcomes[rating].stability for rating in REVIEW_RATINGS]
        self.assertEqual(stability, sorted(stability))
        self.assertEqual(len(set(stability)), 4)

    def test_better_rating_never_brings_the_topic_back_sooner(self) -> None:
        days = [self.outcomes[rating].interval_days for rating in REVIEW_RATINGS]
        self.assertEqual(days, sorted(days))
        self.assertLess(days[0], days[-1])

    def test_only_again_counts_as_a_lapse(self) -> None:
        lapses = {rating: self.outcomes[rating].lapses for rating in REVIEW_RATINGS}
        self.assertEqual(lapses, {"AGAIN": 1, "HARD": 0, "GOOD": 0, "EASY": 0})
        for rating in REVIEW_RATINGS:
            self.assertEqual(self.outcomes[rating].reps, self.memory.reps + 1, rating)

    def test_first_again_is_not_a_lapse(self) -> None:
        """Забыть можно только то, что уже держалось в памяти."""
        self.assertEqual(next_review(rating="AGAIN", memory=TopicMemory(), now=NOW).lapses, 0)

    def test_recall_chance_before_the_answer_is_recorded(self) -> None:
        # Повторение ровно через S дней: шанс 0,9 по определению устойчивости.
        for rating in REVIEW_RATINGS:
            self.assertAlmostEqual(self.outcomes[rating].recall_probability, 0.9, places=6)

    def test_unknown_rating_behaves_as_good(self) -> None:
        unknown = next_review(rating="WHATEVER", memory=self.memory, now=NOW)
        self.assertEqual(unknown, self.outcomes["GOOD"])
        self.assertEqual(unknown.rating, "GOOD")

    def test_rating_is_case_insensitive(self) -> None:
        self.assertEqual(next_review(rating=" easy ", memory=self.memory, now=NOW), self.outcomes["EASY"])

    def test_preview_shows_what_each_rating_would_set(self) -> None:
        self.assertEqual(
            preview_intervals(self.memory, NOW),
            {rating: self.outcomes[rating].interval_days for rating in REVIEW_RATINGS},
        )


class TimingTests(SimpleTestCase):
    """FSRS учитывает, сколько дней реально прошло."""

    def test_review_ten_days_late_gives_a_longer_interval_than_on_time(self) -> None:
        first = next_review(rating="GOOD", memory=TopicMemory(), now=NOW)
        on_time_at = first.next_review_at
        late_at = on_time_at + timedelta(days=10)

        on_time = next_review(rating="GOOD", memory=first.memory(), now=on_time_at)
        late = next_review(rating="GOOD", memory=first.memory(), now=late_at)

        self.assertGreater(late.interval_days, on_time.interval_days)
        self.assertGreater(late.stability, on_time.stability)
        self.assertLess(late.recall_probability, on_time.recall_probability)

    def test_recall_chance_is_ninety_percent_after_stability_days(self) -> None:
        memory = _known(10.0)
        self.assertAlmostEqual(recall_probability(memory, NOW), 1.0)
        self.assertAlmostEqual(recall_probability(memory, NOW + timedelta(days=10)), 0.9, places=6)
        chances = [recall_probability(memory, NOW + timedelta(days=day)) for day in range(0, 40, 5)]
        self.assertEqual(chances, sorted(chances, reverse=True))

    def test_higher_desired_retention_brings_the_topic_back_sooner(self) -> None:
        memory = _known(10.0, days_ago=10)
        usual = next_review(rating="GOOD", memory=memory, now=NOW, desired_retention=0.9)
        before_test = next_review(rating="GOOD", memory=memory, now=NOW, desired_retention=0.95)
        self.assertLess(before_test.interval_days, usual.interval_days)
        # Устойчивость от цели не зависит: меняется только срок.
        self.assertAlmostEqual(before_test.stability, usual.stability)
        self.assertEqual(before_test.desired_retention, 0.95)


class AgainSeriesTests(SimpleTestCase):
    """После серии «не вспомнил» тема не застревает на коротком интервале.

    В старом SM-2 пять AGAIN роняли ease_factor на пол 1,3, и тема в статусе
    MEDIUM навсегда оставалась с интервалом 2 дня: max(2, int(2 * 1,3)) = 2.
    """

    def test_goods_after_five_agains_keep_growing(self) -> None:
        outcome = next_review(rating="AGAIN", memory=TopicMemory(), now=NOW)
        for _ in range(4):
            outcome = next_review(rating="AGAIN", memory=outcome.memory(), now=outcome.next_review_at)
            self.assertGreaterEqual(outcome.interval_days, 1)
        self.assertEqual(outcome.lapses, 4)

        stability = [outcome.stability]
        days = []
        for _ in range(8):
            outcome = next_review(rating="GOOD", memory=outcome.memory(), now=outcome.next_review_at)
            stability.append(outcome.stability)
            days.append(outcome.interval_days)

        self.assertEqual(stability, sorted(stability))
        self.assertEqual(len(set(stability)), len(stability))
        self.assertEqual(days, sorted(days))
        self.assertGreater(days[-1], 7)


class IntervalCapTests(SimpleTestCase):
    """Срок не длиннее учебного года: тему, забытую дольше, всё равно учат заново."""

    def test_fifth_good_in_a_row_stays_within_a_school_year(self) -> None:
        # По весам пакета без потолка пятое «Вспомнил» подряд дало бы 497 дней.
        self.assertEqual(MAX_INTERVAL_DAYS, 365)
        outcome = next_review(rating="GOOD", memory=TopicMemory(), now=NOW)
        days = [outcome.interval_days]
        for _ in range(4):
            outcome = next_review(rating="GOOD", memory=outcome.memory(), now=outcome.next_review_at)
            days.append(outcome.interval_days)
        self.assertLessEqual(days[4], 365)
        self.assertEqual(days, sorted(days))
        # Урезается только срок, память остаётся какой есть.
        self.assertGreater(outcome.stability, 365)

    def test_button_previews_respect_the_cap(self) -> None:
        memory = _known(400.0, difficulty=1.0, days_ago=365)
        self.assertLessEqual(max(preview_intervals(memory, NOW).values()), 365)


class BeforeTestTests(SimpleTestCase):
    """Срок, который перескочил бы через контрольную, ставится на день перед ней."""

    def test_due_moves_to_the_day_before_the_test(self) -> None:
        test_day = NOW.date() + timedelta(days=10)
        usual = next_review(rating="GOOD", memory=_known(10.0, days_ago=10), now=NOW)
        self.assertGreater(usual.next_review_at.date(), test_day)

        outcome = next_review(
            rating="GOOD", memory=_known(10.0, days_ago=10), now=NOW, next_test=test_day
        )
        self.assertEqual(outcome.next_review_at.date(), test_day - timedelta(days=1))
        self.assertEqual(outcome.interval_days, 9)
        self.assertEqual(outcome.next_review_at, NOW + timedelta(days=9))
        # Меняется только срок: память и статус те же.
        self.assertAlmostEqual(outcome.stability, usual.stability)
        self.assertEqual(outcome.status, usual.status)

    def test_never_earlier_than_tomorrow(self) -> None:
        tomorrow = NOW.date() + timedelta(days=1)
        outcome = next_review(rating="EASY", memory=_known(10.0, days_ago=10), now=NOW, next_test=tomorrow)
        self.assertEqual(outcome.interval_days, 1)

    def test_test_after_the_due_date_or_today_changes_nothing(self) -> None:
        memory = _known(10.0, days_ago=10)
        usual = next_review(rating="GOOD", memory=memory, now=NOW)
        for test_day in (NOW.date(), usual.next_review_at.date() + timedelta(days=1)):
            moved = next_review(rating="GOOD", memory=memory, now=NOW, next_test=test_day)
            self.assertEqual(moved, usual, test_day)

    def test_test_on_the_due_date_moves_it_one_day_earlier(self) -> None:
        memory = _known(10.0, days_ago=10)
        usual = next_review(rating="GOOD", memory=memory, now=NOW)
        moved = next_review(rating="GOOD", memory=memory, now=NOW, next_test=usual.next_review_at.date())
        self.assertEqual(moved.interval_days, usual.interval_days - 1)

    def test_button_previews_use_the_same_rule(self) -> None:
        test_day = NOW.date() + timedelta(days=5)
        memory = _known(10.0, days_ago=10)
        previews = preview_intervals(memory, NOW, next_test=test_day)
        for rating in REVIEW_RATINGS:
            moved = next_review(rating=rating, memory=memory, now=NOW, next_test=test_day)
            self.assertEqual(previews[rating], moved.interval_days, rating)
        self.assertLessEqual(max(previews.values()), 4)


class StatusTests(SimpleTestCase):
    """Статусы темы выводятся из устойчивости: страница слабых тем их читает."""

    def test_thresholds(self) -> None:
        self.assertEqual(SUCCESS_STABILITY_DAYS, 7)
        self.assertEqual(MASTERED_STABILITY_DAYS, 21)
        table = [
            (None, "NOT_STARTED"),
            (0.2, "MEDIUM"),
            (6.99, "MEDIUM"),
            (7.0, "SUCCESS"),
            (20.99, "SUCCESS"),
            (21.0, "MASTERED"),
            (400.0, "MASTERED"),
        ]
        for stability, status in table:
            self.assertEqual(status_from_stability(stability), status, stability)

    def test_outcome_status_follows_stability(self) -> None:
        outcome = next_review(rating="GOOD", memory=TopicMemory(), now=NOW)
        for _ in range(4):
            self.assertEqual(outcome.status, status_from_stability(outcome.stability))
            outcome = next_review(rating="GOOD", memory=outcome.memory(), now=outcome.next_review_at)
        self.assertEqual(outcome.status, "MASTERED")

    def test_again_recomputes_the_status_and_can_lower_it(self) -> None:
        mastered = _known(60.0, days_ago=60, status="MASTERED")
        self.assertEqual(next_review(rating="AGAIN", memory=mastered, now=NOW).status, "MEDIUM")
        manual = TopicMemory(status="MASTERED")
        self.assertEqual(next_review(rating="AGAIN", memory=manual, now=NOW).status, "MEDIUM")

    def test_successful_recall_never_lowers_the_status(self) -> None:
        """Тему отметили «усвоено» руками: «Вспомнил» не должен её понизить."""
        manual = TopicMemory(status="MASTERED")
        for rating in ("HARD", "GOOD", "EASY"):
            self.assertEqual(next_review(rating=rating, memory=manual, now=NOW).status, "MASTERED", rating)
        # Перенесённая из SM-2 «усвоенная» тема с коротким интервалом и «С трудом».
        migrated = _known(7.0, days_ago=7, status="MASTERED")
        self.assertEqual(next_review(rating="HARD", memory=migrated, now=NOW).status, "MASTERED")

    def test_successful_recall_still_raises_the_status(self) -> None:
        outcome = next_review(rating="EASY", memory=TopicMemory(status="MEDIUM"), now=NOW)
        self.assertEqual(outcome.status, "SUCCESS")


class LegacyFieldsTests(SimpleTestCase):
    """`interval_days` и `ease_factor` остаются для чтения и отката."""

    def test_ease_mirror_spans_the_sm2_range(self) -> None:
        self.assertAlmostEqual(ease_from_difficulty(1.0), MAX_EASE_FACTOR)
        self.assertAlmostEqual(ease_from_difficulty(10.0), MIN_EASE_FACTOR)
        eases = [ease_from_difficulty(difficulty) for difficulty in (1, 3, 5, 7, 9, 10)]
        self.assertEqual(eases, sorted(eases, reverse=True))

    def test_outcome_carries_the_mirrored_ease(self) -> None:
        for rating in REVIEW_RATINGS:
            outcome = next_review(rating=rating, memory=_known(10.0, days_ago=10), now=NOW)
            self.assertAlmostEqual(outcome.ease_factor, ease_from_difficulty(outcome.difficulty), places=3)
            self.assertGreaterEqual(outcome.ease_factor, MIN_EASE_FACTOR)
            self.assertLessEqual(outcome.ease_factor, MAX_EASE_FACTOR)


class PurityTests(SimpleTestCase):
    def test_same_input_gives_the_same_outcome(self) -> None:
        memory = _known(3.0, days_ago=4)
        self.assertEqual(
            next_review(rating="HARD", memory=memory, now=NOW),
            next_review(rating="HARD", memory=memory, now=NOW),
        )

    def test_time_zone_of_now_does_not_matter(self) -> None:
        almaty = NOW.astimezone(ZoneInfo("Asia/Almaty"))
        memory = _known(5.0, days_ago=6)
        utc = next_review(rating="GOOD", memory=memory, now=NOW)
        local = next_review(rating="GOOD", memory=memory, now=almaty)
        self.assertEqual(local.next_review_at, utc.next_review_at)
        self.assertEqual(local.interval_days, utc.interval_days)

    def test_naive_time_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            next_review(rating="GOOD", memory=TopicMemory(), now=datetime(2026, 11, 11, 9, 0))

    def test_retention_outside_sane_bounds_falls_back_to_the_default(self) -> None:
        self.assertEqual(clean_retention(0.95), 0.95)
        self.assertEqual(clean_retention("0.85"), 0.85)
        for bad in (1.5, 1.0, 0.2, "x", None):
            self.assertEqual(clean_retention(bad), 0.9, bad)

    def test_setting_text_is_parsed_the_way_people_write_it(self) -> None:
        """Пустая строка или «0,95» в окружении не должны ронять запуск."""
        self.assertEqual(clean_retention(""), 0.9)
        self.assertEqual(clean_retention("   "), 0.9)
        self.assertEqual(clean_retention("0,95"), 0.95)
        self.assertEqual(clean_retention(" 0.85 "), 0.85)


class RetentionSettingTests(TestCase):
    def test_setting_stays_a_raw_string(self) -> None:
        from django.conf import settings

        self.assertIsInstance(settings.FSRS_DESIRED_RETENTION, str)

    def test_setting_with_a_comma_or_empty_works(self) -> None:
        from mind.reviews import base_retention

        with override_settings(FSRS_DESIRED_RETENTION="0,95"):
            self.assertEqual(base_retention(), 0.95)
        with override_settings(FSRS_DESIRED_RETENTION=""):
            self.assertEqual(base_retention(), 0.9)


# ──────────────────────────── С базой ────────────────────────────


def _topic(subject, **fields):
    from mind.models import Topic

    return Topic.objects.create(subject=subject, name=fields.pop("name", "Инерция"), **fields)


def _review_request(topic, rating, email=OWNER):
    from mind.views import TopicViewSet

    request = APIRequestFactory().post(
        f"/api/mind/topics/{topic.pk}/review/", {"rating": rating}, format="json"
    )
    request.user_email = email
    return TopicViewSet.as_view({"post": "review"})(request, pk=topic.pk)


def _get_topic(topic, email=OWNER):
    from mind.views import TopicViewSet

    request = APIRequestFactory().get(f"/api/mind/topics/{topic.pk}/")
    request.user_email = email
    return TopicViewSet.as_view({"get": "retrieve"})(request, pk=topic.pk)


# Тесты ждут умолчание 0,9, а не то, что задано в окружении машины.
@override_settings(FSRS_DESIRED_RETENTION=0.9)
class TopicReviewEndpointTests(TestCase):
    """Вью повторения: FSRS, старые поля и журнал."""

    def setUp(self) -> None:
        from mind.models import Subject

        self.subject = Subject.objects.create(name="Физика", user_email=OWNER)
        self.topic = _topic(self.subject, status="NOT_STARTED")

    def test_review_saves_fsrs_state_and_the_legacy_fields(self) -> None:
        before = timezone.now()
        response = _review_request(self.topic, "GOOD")
        self.assertEqual(response.status_code, 200)

        self.topic.refresh_from_db()
        self.assertAlmostEqual(self.topic.fsrs_stability, DEFAULT_PARAMETERS[2], places=6)
        self.assertIsNotNone(self.topic.fsrs_difficulty)
        self.assertEqual(self.topic.fsrs_state, STATE_REVIEW)
        self.assertEqual((self.topic.fsrs_reps, self.topic.fsrs_lapses), (1, 0))
        self.assertEqual(self.topic.status, "MEDIUM")
        self.assertEqual(self.topic.interval_days, 2)
        self.assertAlmostEqual(self.topic.ease_factor, ease_from_difficulty(self.topic.fsrs_difficulty), places=3)
        self.assertGreaterEqual(self.topic.last_revised_at, before)
        self.assertEqual(self.topic.next_review_at, self.topic.last_revised_at + timedelta(days=2))

        self.assertIn("recall_probability", response.data)
        self.assertEqual(set(response.data["review_intervals"]), set(REVIEW_RATINGS))

    def test_review_writes_an_ungraded_review_event(self) -> None:
        from ai_engine.learning_events import GRADED_RESULTS
        from ai_engine.models import LearningEvent

        _review_request(self.topic, "HARD")

        event = LearningEvent.objects.get()
        self.assertEqual(event.activity, "review")
        self.assertEqual(event.metadata["rating"], "HARD")
        self.assertEqual(event.user_email, OWNER)
        self.assertEqual(str(event.topic_id), str(self.topic.pk))
        self.assertEqual(event.source, "topic_review")
        # Без оценённого результата: повторение не считается практикой в SkillState.
        self.assertEqual(event.result, "")
        self.assertNotIn(event.result, GRADED_RESULTS)
        self.assertEqual(event.metadata["desired_retention"], 0.9)
        self.assertEqual(event.metadata["interval_days"], 1)

    def test_every_review_adds_its_own_event(self) -> None:
        from ai_engine.models import LearningEvent

        for rating in ("AGAIN", "GOOD", "EASY"):
            _review_request(self.topic, rating)
        ratings = list(
            LearningEvent.objects.order_by("created_at").values_list("metadata__rating", flat=True)
        )
        self.assertEqual(ratings, ["AGAIN", "GOOD", "EASY"])
        self.topic.refresh_from_db()
        self.assertEqual(self.topic.fsrs_reps, 3)

    def test_unknown_rating_is_recorded_as_good(self) -> None:
        from ai_engine.models import LearningEvent

        self.assertEqual(_review_request(self.topic, "NONSENSE").status_code, 200)
        self.assertEqual(LearningEvent.objects.get().metadata["rating"], "GOOD")

    def test_someone_elses_topic_cannot_be_reviewed(self) -> None:
        from ai_engine.models import LearningEvent

        self.assertEqual(_review_request(self.topic, "GOOD", email="other@example.com").status_code, 404)
        self.assertFalse(LearningEvent.objects.exists())

    def test_manually_mastered_topic_stays_mastered_after_a_good_review(self) -> None:
        topic = _topic(self.subject, name="Масса", status="MASTERED")
        _review_request(topic, "GOOD")
        topic.refresh_from_db()
        self.assertEqual(topic.status, "MASTERED")

        _review_request(topic, "AGAIN")
        topic.refresh_from_db()
        self.assertEqual(topic.status, "MEDIUM")

    def test_migrated_topic_uses_the_real_pause(self) -> None:
        topic = _topic(
            self.subject,
            name="Импульс",
            status="SUCCESS",
            fsrs_stability=7.0,
            fsrs_difficulty=5.0,
            fsrs_state=STATE_REVIEW,
            fsrs_reps=1,
            last_revised_at=timezone.now() - timedelta(days=7, hours=1),
        )
        _review_request(topic, "GOOD")
        topic.refresh_from_db()
        self.assertGreater(topic.fsrs_stability, 7.0)
        self.assertEqual(topic.fsrs_reps, 2)


class WeakFilterTests(TestCase):
    """`filter=weak` на «Сейчас»: просроченные и не начатые, без старого признака ease < 2."""

    def setUp(self) -> None:
        from mind.models import Subject

        self.subject = Subject.objects.create(name="Физика", user_email=OWNER)

    def _weak_ids(self):
        from mind.views import TopicViewSet

        request = APIRequestFactory().get("/api/mind/topics/", {"filter": "weak"})
        request.user_email = OWNER
        response = TopicViewSet.as_view({"get": "list"})(request)
        return {row["id"] for row in response.data}

    def test_mastered_topic_with_one_past_lapse_is_not_weak(self) -> None:
        # Одно «Не вспомнил» когда-то подняло сложность FSRS до 6,4: ease 1,98.
        mastered = _topic(
            self.subject,
            name="Работа",
            status="MASTERED",
            ease_factor=ease_from_difficulty(6.41),
            fsrs_stability=120.0,
            fsrs_difficulty=6.41,
            fsrs_state=STATE_REVIEW,
            fsrs_reps=9,
            fsrs_lapses=1,
            last_revised_at=timezone.now() - timedelta(days=10),
            next_review_at=timezone.now() + timedelta(days=100),
        )
        overdue = _topic(self.subject, name="Мощность", status="SUCCESS", next_review_at=timezone.now() - timedelta(days=1))
        fresh = _topic(self.subject, name="Энергия", status="NOT_STARTED")

        ids = self._weak_ids()
        self.assertNotIn(str(mastered.pk), ids)
        self.assertIn(str(overdue.pk), ids)
        self.assertIn(str(fresh.pk), ids)


class TopicApiTests(TestCase):
    """Что видит фронтенд: шанс вспомнить для порядка и срок на каждой кнопке."""

    def setUp(self) -> None:
        from mind.models import Subject

        self.subject = Subject.objects.create(name="Алгебра", user_email=OWNER)

    def test_new_topic_has_no_recall_probability(self) -> None:
        topic = _topic(self.subject)
        self.assertIsNone(_get_topic(topic).data["recall_probability"])

    def test_recall_probability_falls_with_time(self) -> None:
        recent = _topic(
            self.subject,
            name="Корни",
            fsrs_stability=10.0,
            fsrs_difficulty=5.0,
            fsrs_state=STATE_REVIEW,
            fsrs_reps=2,
            last_revised_at=timezone.now() - timedelta(days=1),
        )
        old = _topic(
            self.subject,
            name="Степени",
            fsrs_stability=10.0,
            fsrs_difficulty=5.0,
            fsrs_state=STATE_REVIEW,
            fsrs_reps=2,
            last_revised_at=timezone.now() - timedelta(days=20),
        )
        recent_chance = _get_topic(recent).data["recall_probability"]
        old_chance = _get_topic(old).data["recall_probability"]
        self.assertGreater(recent_chance, old_chance)
        self.assertLess(old_chance, 0.9)

    def test_button_intervals_match_what_the_review_then_sets(self) -> None:
        """На кнопке написано то, что сервер потом и поставит."""
        last = timezone.now() - timedelta(days=3, hours=6)
        for rating in REVIEW_RATINGS:
            topic = _topic(
                self.subject,
                name=f"Тема {rating}",
                fsrs_stability=4.0,
                fsrs_difficulty=6.0,
                fsrs_state=STATE_REVIEW,
                fsrs_reps=2,
                last_revised_at=last,
            )
            promised = _get_topic(topic).data["review_intervals"][rating]
            _review_request(topic, rating)
            topic.refresh_from_db()
            self.assertEqual(topic.interval_days, promised, rating)


@override_settings(FSRS_DESIRED_RETENTION=0.9)
class DesiredRetentionTests(TestCase):
    """Перед контрольной повторения уплотняются сами.

    Контрольные берутся из двух мест: `ScheduledTest` (генератор программы) и блоки
    дневника, которые ученик видит на «Сейчас».
    """

    def setUp(self) -> None:
        from ai_engine.models import LearningProgram
        from mind.models import Subject

        self.subject = Subject.objects.create(name="Физика", user_email=OWNER)
        self.other_subject = Subject.objects.create(name="Химия", user_email=OWNER)
        self.program = LearningProgram.objects.create(user_email=OWNER)
        self.topic = _topic(self.subject)
        self.today = timezone.localdate(NOW)

    def _test_on(self, day, *, subject=None, status="SCHEDULED"):
        from ai_engine.models import ScheduledTest

        moment = datetime.combine(day, datetime.min.time(), tzinfo=dt_timezone.utc)
        return ScheduledTest.objects.create(
            program=self.program,
            subject=subject or self.subject,
            scheduled_date=moment,
            topics_covered="[]",
            title="Контрольная",
            status=status,
        )

    def _retention(self):
        from mind.reviews import retention_for

        return retention_for(self.topic, NOW)

    def _diary_block(self, day, *, linked=(), subject_id="", block_type="test", email=OWNER, label=""):
        """Блок недели дневника, как его пишет фронтенд (`DiaryWeek.days`)."""
        import uuid

        from diary.models import DiaryWeek

        monday = day - timedelta(days=day.weekday())
        week, _ = DiaryWeek.objects.get_or_create(
            user_email=email,
            week_start=monday.isoformat(),
            defaults={
                "id": str(uuid.uuid4()),
                "week_end": (monday + timedelta(days=6)).isoformat(),
                "days": [],
            },
        )
        week.days = [
            *week.days,
            {
                "id": str(uuid.uuid4()),
                "date": day.isoformat(),
                "lessons": [
                    {
                        "id": str(uuid.uuid4()),
                        "blockType": block_type,
                        "blockLabel": label,
                        "subjectId": subject_id,
                        # Так блок без предмета собирает фронтенд: подпись или «Тест».
                        "subjectName": label or "Тест",
                        "linkedSubjectIds": [str(value) for value in linked],
                    }
                ],
            },
        ]
        week.save()

    def test_no_test_keeps_the_default(self) -> None:
        self.assertEqual(self._retention(), 0.9)

    def test_test_today_or_within_seven_days_raises_it(self) -> None:
        for offset in (0, 3, 7):
            with self.subTest(offset=offset):
                test = self._test_on(self.today + timedelta(days=offset))
                self.assertEqual(self._retention(), 0.95)
                test.delete()

    def test_far_past_closed_or_foreign_tests_do_not_count(self) -> None:
        self._test_on(self.today + timedelta(days=8))
        self._test_on(self.today - timedelta(days=1))
        self._test_on(self.today + timedelta(days=2), status="COMPLETED")
        self._test_on(self.today + timedelta(days=2), subject=self.other_subject)
        self.assertEqual(self._retention(), 0.9)

    @override_settings(FSRS_DESIRED_RETENTION=0.85)
    def test_setting_changes_the_default(self) -> None:
        self.assertEqual(self._retention(), 0.85)
        self._test_on(self.today + timedelta(days=1))
        self.assertEqual(self._retention(), 0.95)

    @override_settings(FSRS_DESIRED_RETENTION=0.97)
    def test_test_never_lowers_a_higher_setting(self) -> None:
        self._test_on(self.today + timedelta(days=1))
        self.assertEqual(self._retention(), 0.97)

    def test_review_before_a_test_brings_the_topic_back_sooner(self) -> None:
        from ai_engine.models import LearningEvent
        from mind.reviews import review_topic

        memory = dict(
            fsrs_stability=10.0,
            fsrs_difficulty=5.0,
            fsrs_state=STATE_REVIEW,
            fsrs_reps=2,
            last_revised_at=NOW - timedelta(days=10),
        )
        exam_topic = _topic(self.subject, name="Сила", **memory)
        calm_topic = _topic(self.other_subject, name="Моль", **memory)
        self._test_on(self.today + timedelta(days=5))

        exam = review_topic(exam_topic, "GOOD", user_email=OWNER, source="test", now=NOW)
        calm = review_topic(calm_topic, "GOOD", user_email=OWNER, source="test", now=NOW)

        self.assertLess(exam.interval_days, calm.interval_days)
        self.assertEqual(
            LearningEvent.objects.get(topic_id=exam_topic.pk).metadata["desired_retention"], 0.95
        )

    def test_review_ten_days_before_a_test_lands_before_it(self) -> None:
        """S=10, повторил вовремя за 10 дней до контрольной: без правила срок был бы через 32 дня."""
        from mind.reviews import review_topic

        test_day = self.today + timedelta(days=10)
        self._test_on(test_day)
        topic = _topic(
            self.subject,
            name="Ускорение",
            fsrs_stability=10.0,
            fsrs_difficulty=5.0,
            fsrs_state=STATE_REVIEW,
            fsrs_reps=2,
            last_revised_at=NOW - timedelta(days=10),
        )
        outcome = review_topic(topic, "GOOD", user_email=OWNER, source="test", now=NOW)
        topic.refresh_from_db()

        self.assertEqual(outcome.desired_retention, 0.9)
        self.assertEqual(topic.next_review_at.date(), test_day - timedelta(days=1))
        self.assertEqual(topic.interval_days, 9)

    def test_diary_test_in_three_days_brings_the_topic_back_sooner(self) -> None:
        """Контрольные, которые ученик видит на «Сейчас», живут в дневнике."""
        from mind.reviews import review_topic

        memory = dict(
            fsrs_stability=10.0,
            fsrs_difficulty=5.0,
            fsrs_state=STATE_REVIEW,
            fsrs_reps=2,
            last_revised_at=NOW - timedelta(days=10),
        )
        exam_topic = _topic(self.subject, name="Сила", **memory)
        calm_topic = _topic(self.other_subject, name="Моль", **memory)
        self._diary_block(self.today + timedelta(days=3), linked=[self.subject.pk])

        exam = review_topic(exam_topic, "GOOD", user_email=OWNER, source="test", now=NOW)
        calm = review_topic(calm_topic, "GOOD", user_email=OWNER, source="test", now=NOW)

        self.assertEqual((exam.desired_retention, calm.desired_retention), (0.95, 0.9))
        self.assertLess(exam.interval_days, calm.interval_days)

    def test_diary_test_can_name_its_subject_directly(self) -> None:
        self._diary_block(self.today + timedelta(days=1), subject_id=str(self.subject.pk))
        self.assertEqual(self._retention(), 0.95)

    def test_other_diary_blocks_do_not_count(self) -> None:
        self._diary_block(self.today + timedelta(days=2), linked=[self.other_subject.pk])
        self._diary_block(self.today + timedelta(days=9), linked=[self.subject.pk])
        self._diary_block(self.today - timedelta(days=1), linked=[self.subject.pk])
        self._diary_block(self.today + timedelta(days=2), linked=[self.subject.pk], block_type="lesson")
        self._diary_block(
            self.today + timedelta(days=2), linked=[self.subject.pk], email="other@example.com"
        )
        self.assertEqual(self._retention(), 0.9)

    def test_unlinked_diary_test_counts_when_its_label_names_the_subject(self) -> None:
        self._diary_block(self.today + timedelta(days=2), label="  физика ")
        self.assertEqual(self._retention(), 0.95)

    def test_label_must_name_the_subject_exactly(self) -> None:
        from mind.models import Subject

        self._diary_block(self.today + timedelta(days=2), label="Физ")
        self._diary_block(self.today + timedelta(days=2), label="Физика 9")
        # Своя связь блока важнее подписи.
        self._diary_block(self.today + timedelta(days=2), label="Физика", linked=[self.other_subject.pk])
        Subject.objects.create(name="Астрономия", user_email="other@example.com")
        self._diary_block(self.today + timedelta(days=2), label="Астрономия")
        self.assertEqual(self._retention(), 0.9)

    def test_every_test_kind_of_the_diary_counts(self) -> None:
        # Тот же список, что `TEST_BLOCK_TYPES` в src/types/diary.ts.
        for kind in ("test", "weakness-test", "cumulative-test", "error-test", "error-review"):
            with self.subTest(kind=kind):
                from diary.models import DiaryWeek

                DiaryWeek.objects.all().delete()
                self._diary_block(self.today + timedelta(days=4), linked=[self.subject.pk], block_type=kind)
                self.assertEqual(self._retention(), 0.95)

    def test_button_intervals_see_diary_tests_too(self) -> None:
        from mind.srs import memory_of

        today = timezone.localdate()
        self._diary_block(today + timedelta(days=3), linked=[self.subject.pk])
        topic = _topic(
            self.subject,
            name="Давление",
            fsrs_stability=10.0,
            fsrs_difficulty=5.0,
            fsrs_state=STATE_REVIEW,
            fsrs_reps=2,
            last_revised_at=timezone.now() - timedelta(days=10, hours=1),
        )
        promised = _get_topic(topic).data["review_intervals"]["GOOD"]
        expected = next_review(
            rating="GOOD",
            memory=memory_of(topic),
            now=timezone.now(),
            desired_retention=0.95,
            next_test=today + timedelta(days=3),
        )
        self.assertEqual(promised, expected.interval_days)

    def test_button_intervals_use_the_same_retention(self) -> None:
        # Здесь вью берёт настоящее «сейчас», поэтому и контрольная от настоящего дня.
        self._test_on(timezone.localdate() + timedelta(days=5))
        topic = _topic(
            self.subject,
            name="Работа",
            fsrs_stability=10.0,
            fsrs_difficulty=5.0,
            fsrs_state=STATE_REVIEW,
            fsrs_reps=2,
            last_revised_at=timezone.now() - timedelta(days=10, hours=1),
        )
        promised = _get_topic(topic).data["review_intervals"]["GOOD"]
        _review_request(topic, "GOOD")
        topic.refresh_from_db()
        self.assertEqual(topic.interval_days, promised)


class RollingDeployInsertTests(TestCase):
    """Старый веб-контейнер пишет темы, ничего не зная о колонках FSRS.

    Во время выкладки миграцию применяет новый контейнер, а старый ещё
    принимает запросы. Его INSERT перечисляет только прежние колонки, и он не
    должен упасть на NOT NULL: для этого у новых колонок `db_default`.
    """

    OLD_COLUMNS = (
        "id",
        "subject_id",
        "name",
        "status",
        "study_state",
        "picked",
        "order_index",
        "archived",
        "last_revised_at",
        "next_review_at",
        "interval_days",
        "ease_factor",
        "created_at",
        "updated_at",
    )

    def test_insert_without_fsrs_columns_gets_database_defaults(self) -> None:
        from mind.models import Subject, Topic

        subject = Subject.objects.create(name="Физика", user_email=OWNER)
        moment = connection.ops.adapt_datetimefield_value(timezone.now())
        values = (
            "raw-old-container",
            # str(): у объекта из памяти pk — UUID, а колонка строковая.
            str(subject.pk),
            "Инерция",
            "MEDIUM",
            "STUDIED",
            False,
            0,
            False,
            moment,
            moment,
            3,
            2.5,
            moment,
            moment,
        )
        quote = connection.ops.quote_name
        sql = "INSERT INTO {table} ({columns}) VALUES ({marks})".format(
            table=quote(Topic._meta.db_table),
            columns=", ".join(quote(column) for column in self.OLD_COLUMNS),
            marks=", ".join(["%s"] * len(self.OLD_COLUMNS)),
        )
        with connection.cursor() as cursor:
            cursor.execute(sql, values)

        topic = Topic.objects.get(pk="raw-old-container")
        self.assertEqual((topic.fsrs_state, topic.fsrs_reps, topic.fsrs_lapses), (STATE_NEW, 0, 0))
        self.assertIsNone(topic.fsrs_stability)
        self.assertIsNone(topic.fsrs_difficulty)
