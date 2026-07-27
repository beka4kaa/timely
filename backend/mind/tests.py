"""
Тесты интервального повторения (`mind.srs`).

Зачем именно такой набор: расчёт интервалов перенесён из `TopicViewSet.review` в
чистую функцию, чтобы тем же расчётом пользовался инструмент тьютора
`schedule_review`. Перенос живой логики опасен тем, что ошибка в множителе или
границе не видна глазами и проявится через недели — как «повторения приходят не
тогда». Поэтому ожидаемые значения ниже посчитаны ПО ИСХОДНОМУ коду вью вручную
и записаны рядом комментарием, а не взяты из новой реализации: иначе тест
подтверждал бы сам себя.
"""

from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIRequestFactory

from mind.srs import (
    DEFAULT_EASE_FACTOR,
    MAX_EASE_FACTOR,
    MIN_EASE_FACTOR,
    REVIEW_RATINGS,
    next_review,
)


class NextReviewTests(SimpleTestCase):
    """Таблица «вход → выход», посчитанная по прежнему алгоритму."""

    def test_again_resets_to_tomorrow_and_lowers_ease(self) -> None:
        outcome = next_review(rating="AGAIN", status="SUCCESS", interval_days=10, ease_factor=2.5)
        self.assertEqual(outcome.interval_days, 1)
        self.assertAlmostEqual(outcome.ease_factor, 2.3)
        self.assertEqual(outcome.status, "MEDIUM")

    def test_again_clamps_ease_at_the_floor(self) -> None:
        outcome = next_review(rating="AGAIN", status="MEDIUM", interval_days=3, ease_factor=1.35)
        self.assertAlmostEqual(outcome.ease_factor, MIN_EASE_FACTOR)

    def test_hard_grows_interval_slightly(self) -> None:
        # max(1, int(10 * 1.2)) = 12; ease 2.0 - 0.15 = 1.85; статус не меняется
        outcome = next_review(rating="HARD", status="SUCCESS", interval_days=10, ease_factor=2.0)
        self.assertEqual(outcome.interval_days, 12)
        self.assertAlmostEqual(outcome.ease_factor, 1.85)
        self.assertEqual(outcome.status, "SUCCESS")

    def test_hard_moves_a_new_topic_to_medium(self) -> None:
        outcome = next_review(rating="HARD", status="NOT_STARTED", interval_days=1, ease_factor=2.5)
        self.assertEqual(outcome.interval_days, 1)
        self.assertEqual(outcome.status, "MEDIUM")

    def test_good_first_review_is_tomorrow(self) -> None:
        outcome = next_review(rating="GOOD", status="NOT_STARTED", interval_days=5, ease_factor=2.5)
        self.assertEqual(outcome.interval_days, 1)
        self.assertEqual(outcome.status, "MEDIUM")
        self.assertAlmostEqual(outcome.ease_factor, 2.5)

    def test_good_medium_stays_medium_below_the_threshold(self) -> None:
        # max(2, int(2 * 2.5)) = 5; условие 2 >= 3 неверно → остаётся MEDIUM
        outcome = next_review(rating="GOOD", status="MEDIUM", interval_days=2, ease_factor=2.5)
        self.assertEqual(outcome.interval_days, 5)
        self.assertEqual(outcome.status, "MEDIUM")

    def test_good_medium_promotes_at_three_days(self) -> None:
        # max(2, int(3 * 2.5)) = 7; 3 >= 3 → SUCCESS
        outcome = next_review(rating="GOOD", status="MEDIUM", interval_days=3, ease_factor=2.5)
        self.assertEqual(outcome.interval_days, 7)
        self.assertEqual(outcome.status, "SUCCESS")

    def test_good_success_stays_below_seven_days(self) -> None:
        # max(4, int(5 * 2.0)) = 10; условие 5 >= 7 неверно → остаётся SUCCESS
        outcome = next_review(rating="GOOD", status="SUCCESS", interval_days=5, ease_factor=2.0)
        self.assertEqual(outcome.interval_days, 10)
        self.assertEqual(outcome.status, "SUCCESS")

    def test_good_success_promotes_at_seven_days(self) -> None:
        # max(4, int(7 * 2.0)) = 14; 7 >= 7 → MASTERED
        outcome = next_review(rating="GOOD", status="SUCCESS", interval_days=7, ease_factor=2.0)
        self.assertEqual(outcome.interval_days, 14)
        self.assertEqual(outcome.status, "MASTERED")

    def test_good_mastered_keeps_growing(self) -> None:
        # max(7, int(10 * 2.5)) = 25, статус уже максимальный
        outcome = next_review(rating="GOOD", status="MASTERED", interval_days=10, ease_factor=2.5)
        self.assertEqual(outcome.interval_days, 25)
        self.assertEqual(outcome.status, "MASTERED")

    def test_easy_has_a_seven_day_floor(self) -> None:
        # max(7, int(1 * 2.5 * 1.5)) = max(7, 3) = 7; ease 2.5 + 0.15 = 2.65
        outcome = next_review(rating="EASY", status="NOT_STARTED", interval_days=1, ease_factor=2.5)
        self.assertEqual(outcome.interval_days, 7)
        self.assertAlmostEqual(outcome.ease_factor, 2.65)
        self.assertEqual(outcome.status, "SUCCESS")

    def test_easy_uses_the_old_ease_for_the_interval(self) -> None:
        """Порядок из исходного кода: интервал по старому ease, потом рост.

        Если посчитать интервал уже увеличенным ease, получится 13 вместо 12, и
        расхождение с прежним поведением прошло бы незамеченным.
        """
        # max(7, int(4 * 2.0 * 1.5)) = 12, и только ПОТОМ ease → 2.15
        outcome = next_review(rating="EASY", status="SUCCESS", interval_days=4, ease_factor=2.0)
        self.assertEqual(outcome.interval_days, 12)
        self.assertAlmostEqual(outcome.ease_factor, 2.15)
        self.assertEqual(outcome.status, "MASTERED")

    def test_easy_clamps_ease_at_the_ceiling(self) -> None:
        # max(7, int(10 * 2.9 * 1.5)) = 43; ease 2.9 + 0.15 = 3.05 → потолок 3.0
        outcome = next_review(rating="EASY", status="MASTERED", interval_days=10, ease_factor=2.9)
        self.assertEqual(outcome.interval_days, 43)
        self.assertAlmostEqual(outcome.ease_factor, MAX_EASE_FACTOR)

    def test_missing_interval_and_ease_get_defaults(self) -> None:
        # interval None → 1, ease None → 2.5 ⇒ max(2, int(1 * 2.5)) = 2
        outcome = next_review(rating="GOOD", status="MEDIUM", interval_days=None, ease_factor=None)
        self.assertEqual(outcome.interval_days, 2)
        self.assertAlmostEqual(outcome.ease_factor, DEFAULT_EASE_FACTOR)

    def test_unknown_rating_behaves_as_good_instead_of_crashing(self) -> None:
        """Раньше это был UnboundLocalError: `interval` не присваивался нигде."""
        unknown = next_review(rating="WHATEVER", status="MEDIUM", interval_days=3, ease_factor=2.5)
        good = next_review(rating="GOOD", status="MEDIUM", interval_days=3, ease_factor=2.5)
        self.assertEqual(unknown, good)

    def test_rating_is_case_insensitive(self) -> None:
        self.assertEqual(
            next_review(rating="good", status="MEDIUM", interval_days=3, ease_factor=2.5),
            next_review(rating="GOOD", status="MEDIUM", interval_days=3, ease_factor=2.5),
        )

    def test_every_rating_returns_a_sane_interval(self) -> None:
        for rating in REVIEW_RATINGS:
            for status in ("NOT_STARTED", "MEDIUM", "SUCCESS", "MASTERED"):
                outcome = next_review(
                    rating=rating, status=status, interval_days=4, ease_factor=2.2
                )
                self.assertGreaterEqual(outcome.interval_days, 1, f"{rating}/{status}")
                self.assertGreaterEqual(outcome.ease_factor, MIN_EASE_FACTOR)
                self.assertLessEqual(outcome.ease_factor, MAX_EASE_FACTOR)

    def test_is_pure(self) -> None:
        args = dict(rating="GOOD", status="MEDIUM", interval_days=3, ease_factor=2.5)
        self.assertEqual(next_review(**args), next_review(**args))


class TopicReviewEndpointTests(TestCase):
    """Вью повторения продолжает работать, теперь через общий расчёт."""

    def setUp(self) -> None:
        from mind.models import Subject, Topic

        self.subject = Subject.objects.create(name="Физика", user_email="student@example.com")
        self.topic = Topic.objects.create(
            subject=self.subject,
            name="Инерция",
            status="MEDIUM",
            interval_days=3,
            ease_factor=2.5,
        )

    def _review(self, rating: str):
        from mind.views import TopicViewSet

        request = APIRequestFactory().post(
            f"/api/topics/{self.topic.pk}/review/", {"rating": rating}, format="json"
        )
        return TopicViewSet.as_view({"post": "review"})(request, pk=self.topic.pk)

    def test_review_persists_the_computed_outcome(self) -> None:
        before = timezone.now()
        response = self._review("GOOD")
        self.assertEqual(response.status_code, 200)

        self.topic.refresh_from_db()
        expected = next_review(rating="GOOD", status="MEDIUM", interval_days=3, ease_factor=2.5)
        self.assertEqual(self.topic.interval_days, expected.interval_days)
        self.assertEqual(self.topic.status, expected.status)
        self.assertAlmostEqual(self.topic.ease_factor, expected.ease_factor)
        self.assertIsNotNone(self.topic.next_review_at)
        self.assertGreaterEqual(self.topic.next_review_at, before)
        self.assertIsNotNone(self.topic.last_revised_at)

    def test_unknown_rating_no_longer_raises(self) -> None:
        self.assertEqual(self._review("NONSENSE").status_code, 200)
