"""Метрики ответа и отбраковка негодного эталона.

Обе части чистые: ни базы, ни сети. Проверяется то, из-за чего оценка стала бы
врать — снисходительное сравнение путей и вопросы, повторяющие заголовок.
"""

from __future__ import annotations

from django.test import SimpleTestCase

from curriculum.answer_eval import AnswerCase, normalize_path, score_answers
from curriculum.gold_set import GoldQuery, dumps, rejection_reason, title_overlap


def case(**kwargs) -> AnswerCase:
    kwargs.setdefault("query", "почему ящик легче толкать")
    kwargs.setdefault("relevant_section_paths", frozenset({"§ 3.13"}))
    return AnswerCase(**kwargs)


class CitationScoreTests(SimpleTestCase):
    def test_цитата_в_нужном_разделе_засчитывается(self):
        self.assertTrue(case(cited_section_paths=("§ 3.13",)).cited_correctly)

    def test_цитата_в_чужом_разделе_не_засчитывается(self):
        self.assertFalse(case(cited_section_paths=("§ 9.1",)).cited_correctly)

    def test_хватает_одного_попадания_из_нескольких(self):
        hit = case(cited_section_paths=("§ 9.1", "§ 3.13", "§ 2.2"))
        self.assertTrue(hit.cited_correctly)

    def test_запись_пути_не_должна_влиять_на_оценку(self):
        """Эталон пишет человек: «§ 3.13», «§3.13» и «3.13» — одно и то же.

        Без нормализации метрика мерила бы аккуратность разметки, а не поиск.
        """
        for written in ("§3.13", "3.13", " § 3.13 "):
            with self.subTest(written=written):
                self.assertTrue(case(cited_section_paths=(written,)).cited_correctly)

    def test_нормализация_пути(self):
        self.assertEqual(normalize_path("§ 3.13"), "3.13")
        self.assertEqual(normalize_path("Глава 2"), "глава2")

    def test_ответ_без_цитат_не_засчитывается(self):
        self.assertFalse(case(cited_section_paths=()).cited_correctly)


class OutsideBookTests(SimpleTestCase):
    def test_ложное_вне_книги_ловится(self):
        """Книга ответ содержит, а система сказала, что нет.

        Прямой признак того, что поиск не донёс материал до модели.
        """
        self.assertTrue(case(outside_book=True).falsely_outside)

    def test_честное_вне_книги_не_штрафуется(self):
        honest = AnswerCase(
            query="кто такой Ньютон",
            relevant_section_paths=frozenset(),
            outside_book=True,
        )
        self.assertFalse(honest.falsely_outside)


class ReportTests(SimpleTestCase):
    def test_доли_считаются(self):
        report = score_answers(
            [
                case(cited_section_paths=("§ 3.13",)),
                case(cited_section_paths=("§ 9.1",)),
                case(cited_section_paths=(), outside_book=True),
                case(cited_section_paths=("§ 3.13",)),
            ]
        )
        self.assertEqual(report.total, 4)
        self.assertEqual(report.citation_hit_rate, 0.5)
        self.assertEqual(report.false_outside_rate, 0.25)
        self.assertEqual(report.without_citations, 1)

    def test_промахи_возвращаются_для_разбора(self):
        report = score_answers(
            [
                case(cited_section_paths=("§ 3.13",)),
                case(cited_section_paths=("§ 9.1",)),
            ]
        )
        self.assertEqual(len(report.misses()), 1)

    def test_пустой_набор_не_делит_на_ноль(self):
        report = score_answers([])
        self.assertEqual(report.citation_hit_rate, 0.0)


class GoldSetTests(SimpleTestCase):
    def test_вопрос_повторяющий_заголовок_отбраковывается(self):
        """Иначе эталон измеряет заголовок, а не поиск.

        Такой вопрос находится лексикой по совпадению слов, и recall выходит
        завышенным — ровно этим болен smoke-набор из заголовков.
        """
        reason = rejection_reason("что такое сила трения", "Сила трения")
        self.assertIn("повторяет заголовок", reason)

    def test_перефразированный_вопрос_проходит(self):
        self.assertEqual(
            rejection_reason(
                "почему тяжёлый ящик легче толкать, чем нести", "Сила трения"
            ),
            "",
        )

    def test_слишком_короткий_вопрос_отбраковывается(self):
        self.assertIn("короткий", rejection_reason("импульс", "Импульс тела"))

    def test_совпадение_считается_по_словам_заголовка(self):
        self.assertEqual(title_overlap("сила трения покоя", "Сила трения"), 1.0)
        self.assertEqual(title_overlap("почему ящик скользит", "Сила трения"), 0.0)

    def test_формат_совпадает_с_тем_что_читает_eval(self):
        import json

        payload = json.loads(
            dumps([GoldQuery(query="почему ящик скользит", section_paths=("§ 3.13",))])
        )
        self.assertEqual(payload[0]["query"], "почему ящик скользит")
        self.assertEqual(payload[0]["relevant_section_paths"], ["§ 3.13"])
