"""Тесты детерминированного расчёта длительности тем.

Модуль чистый, поэтому и тесты обходятся без базы. Проверяется не «формула
возвращает 70», а свойства, из-за нарушения которых оценка теряет смысл:
объём материала влияет на время, части сходятся в целое, вложенные разделы не
считаются дважды.
"""

from __future__ import annotations

from django.test import SimpleTestCase

from curriculum.planning.duration import (
    FALLBACK_TOPIC_MINUTES,
    MAX_TOPIC_MINUTES,
    MIN_TOPIC_MINUTES,
    covered_pages,
    estimate_topic_minutes,
    split_total,
)


class CoveredPagesTests(SimpleTestCase):
    def test_nested_ranges_are_not_counted_twice(self):
        """Глава и её параграф покрывают страницы главы, а не полторы книги."""
        chapter = (10, 40)
        paragraphs = [(10, 20), (21, 30), (31, 40)]
        self.assertEqual(covered_pages([chapter, *paragraphs]), 31)

    def test_adjacent_ranges_merge(self):
        self.assertEqual(covered_pages([(1, 5), (6, 10)]), 10)

    def test_disjoint_ranges_add_up(self):
        self.assertEqual(covered_pages([(1, 5), (20, 24)]), 10)

    def test_single_page_section(self):
        self.assertEqual(covered_pages([(7, 7)]), 1)

    def test_broken_ranges_are_ignored(self):
        """Раздел без установленных границ не должен ломать расчёт."""
        self.assertEqual(covered_pages([(0, 0), (9, 3), (4, 6)]), 3)

    def test_empty(self):
        self.assertEqual(covered_pages([]), 0)


class EstimateTopicMinutesTests(SimpleTestCase):
    def test_volume_drives_the_estimate(self):
        """Главное свойство: разный объём — разное время.

        Именно этого не делала модель, ставившая 45 минут и двухстраничному
        параграфу, и сорокастраничной главе.
        """
        short = estimate_topic_minutes(page_count=2)
        long = estimate_topic_minutes(page_count=20)
        self.assertLess(short.total, long.total)

    def test_parts_sum_to_total(self):
        for pages in (1, 3, 7, 12, 40, 200):
            with self.subTest(pages=pages):
                duration = estimate_topic_minutes(page_count=pages)
                self.assertEqual(
                    duration.total,
                    duration.theory_minutes
                    + duration.practice_minutes
                    + duration.assessment_minutes,
                )

    def test_payload_total_matches(self):
        payload = estimate_topic_minutes(page_count=8).to_payload()
        self.assertEqual(
            payload["total_minutes"],
            payload["theory_minutes"]
            + payload["practice_minutes"]
            + payload["assessment_minutes"],
        )

    def test_difficulty_raises_time(self):
        easy = estimate_topic_minutes(page_count=10, difficulty="easy")
        hard = estimate_topic_minutes(page_count=10, difficulty="hard")
        self.assertLess(easy.total, hard.total)

    def test_weaker_student_needs_more_time(self):
        confident = estimate_topic_minutes(page_count=10, current_level="advanced")
        beginner = estimate_topic_minutes(page_count=10, current_level="none")
        self.assertLess(confident.total, beginner.total)

    def test_balance_shifts_practice(self):
        theory = estimate_topic_minutes(page_count=10, balance="theory")
        practice = estimate_topic_minutes(page_count=10, balance="practice")
        self.assertEqual(theory.total, practice.total)
        self.assertGreater(theory.theory_minutes, practice.theory_minutes)
        self.assertGreater(practice.practice_minutes, theory.practice_minutes)

    def test_unknown_enum_values_fall_back_to_neutral(self):
        """Валидатор уже нормализует enum'ы, но расчёт не должен падать."""
        odd = estimate_topic_minutes(
            page_count=10, difficulty="средняя", current_level="???", balance="???"
        )
        self.assertEqual(odd, estimate_topic_minutes(page_count=10))

    def test_bounds_are_respected(self):
        self.assertGreaterEqual(estimate_topic_minutes(page_count=1).total, 15)
        self.assertLessEqual(
            estimate_topic_minutes(page_count=500, difficulty="hard").total,
            MAX_TOPIC_MINUTES,
        )

    def test_shortest_topic_equals_the_declared_minimum(self):
        """Проверка не должна раздувать короткую тему.

        Когда пять минут контроля прибавлялись поверх расчёта, тема с
        заявленным минимумом в 15 минут выходила на 20, а весь план — на
        четверть длиннее обещанного.
        """
        self.assertEqual(estimate_topic_minutes(page_count=1).total, MIN_TOPIC_MINUTES)

    def test_every_topic_ends_with_a_check(self):
        for pages in (1, 5, 30):
            with self.subTest(pages=pages):
                self.assertGreaterEqual(
                    estimate_topic_minutes(page_count=pages).assessment_minutes, 5
                )

    def test_check_does_not_eat_the_lesson(self):
        duration = estimate_topic_minutes(page_count=40)
        self.assertLessEqual(duration.assessment_minutes, 20)

    def test_topic_without_pages_gets_default(self):
        """Тема без provenance не должна получить ноль минут.

        Ноль исключил бы её из прогноза сроков: план показал бы, что тему можно
        пройти мгновенно.
        """
        duration = estimate_topic_minutes(page_count=0)
        self.assertEqual(duration.total, FALLBACK_TOPIC_MINUTES)

    def test_negative_pages_treated_as_missing(self):
        self.assertEqual(
            estimate_topic_minutes(page_count=-5).total, FALLBACK_TOPIC_MINUTES
        )

    def test_whole_textbook_stays_plausible(self):
        """Регресс на живых числах.

        «Механика» Мякишева — 142 параграфа примерно по 3 страницы. Прошлый
        план давал 388 часов, что для школьного курса невозможно: это больше
        двух академических лет. Проверяем порядок величины, а не точное число.
        """
        total = sum(
            estimate_topic_minutes(page_count=3).total for _ in range(142)
        )
        self.assertLess(total / 60, 120)
        self.assertGreater(total / 60, 30)


class TokenVolumeTests(SimpleTestCase):
    """Книги без страниц: EPUB — это поток текста, а не развороты."""

    def test_объём_считается_по_токенам_когда_страниц_нет(self):
        """Регресс: у EPUB `page_start` всегда ноль.

        `covered_pages` давал ноль, и каждая тема электронной книги получала
        умолчание в 45 минут — ровно то число, ради ухода от которого расчёт и
        делался.
        """
        duration = estimate_topic_minutes(page_count=0, content_tokens=6000)
        self.assertNotEqual(duration.total, FALLBACK_TOPIC_MINUTES)
        self.assertGreater(duration.total, 45)

    def test_больше_текста_больше_времени(self):
        short = estimate_topic_minutes(page_count=0, content_tokens=1200)
        long = estimate_topic_minutes(page_count=0, content_tokens=12000)
        self.assertLess(short.total, long.total)

    def test_страницы_важнее_токенов(self):
        """У PDF страницы точнее: они и есть объём материала."""
        with_pages = estimate_topic_minutes(page_count=3, content_tokens=99999)
        self.assertEqual(with_pages, estimate_topic_minutes(page_count=3))

    def test_совсем_короткий_раздел_это_одна_страница(self):
        self.assertEqual(
            estimate_topic_minutes(page_count=0, content_tokens=50),
            estimate_topic_minutes(page_count=1),
        )

    def test_без_страниц_и_без_текста_остаётся_умолчание(self):
        duration = estimate_topic_minutes(page_count=0, content_tokens=0)
        self.assertEqual(duration.total, FALLBACK_TOPIC_MINUTES)


class SplitTotalTests(SimpleTestCase):
    def test_manual_override_is_split_consistently(self):
        duration = split_total(90, "balanced")
        self.assertEqual(duration.total, 90)

    def test_zero_stays_zero(self):
        """Ученик вправе обнулить тему; проверка не должна возвращать 5 минут."""
        duration = split_total(0)
        self.assertEqual(duration.total, 0)
        self.assertEqual(duration.theory_minutes, 0)
