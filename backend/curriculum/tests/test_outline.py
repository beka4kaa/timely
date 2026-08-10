"""Структура книги: оглавление вместо догадок по телу.

Regression-набор снят с живого дефекта. На «Механике, 10 класс» Мякишева разбор
тела давал 26 «глав», из которых 12 были вопросами к параграфам и обрывками
формул: «Вектор o», «Шарик неподвижен:», «Оба шара имеют одинаковую массу,
тогда». Каждая из них доезжала до планировщика и становилась модулем курса.
"""

from django.test import SimpleTestCase

from curriculum.outline.builder import build_outline
from curriculum.outline.contracts import Role, Source
from curriculum.outline.toc_detector import detect_toc_pages, toc_page_span
from curriculum.outline.toc_parser import parse_toc_lines
from curriculum.outline.verify import find_page_offset

# Оглавление в том виде, в каком его отдаёт экстрактор: неразрывные пробелы,
# точки-выноски через пробел, перенос длинных названий на следующую строку.
TOC_PAGE = """507
Оглавление
Введение
Зарождение и развитие научного взгляда на мир
§ 1. Необходимость познания природы . . . . . . . . . . . . 3
§ 2. Наука для всех  . . . . . . . . . . . . . . . . . . . . . . . . 5
§ 3. Зарождение и развитие современного научного метода
исследования . . . . . . . . . . . . . . . . . . . . . . . . . 8
Основные особенности физического метода
исследования
§ 4. Физика — экспериментальная наука . . . . . . . . . . . 14
Кинематика
Глава 1
Кинематика точки. Основные понятия кинематики
§ 1.1. Движение тела и точки . . . . . . . . . . . . . . . . . . 29
 Упражнение 1 . . . . . . . . . . . . . . . . . . . . . . . . 56
Ответы . . . . . . . . . . . . . . . . . . . . . . . . . . . . 500
"""

# Страница из тела книги: ровно те строки, что раньше становились главами.
BODY_PAGE = """108
1. Вектор o
2. Вектор с
1. Какие гипотезы проверял Галилей?
2. Шарик неподвижен:
3. Оба шара имеют одинаковую массу, тогда
"""


class TocDetectionTests(SimpleTestCase):
    def test_real_toc_page_is_detected(self):
        pages = {1: "обычный текст", 2: TOC_PAGE}
        detected = {page.page_number for page in detect_toc_pages(pages)}
        self.assertIn(2, detected)

    def test_detection_reports_signals_not_just_a_flag(self):
        """Уверенность нужна, чтобы отличить оглавление от таблицы с числами."""
        page = next(p for p in detect_toc_pages({1: TOC_PAGE}) if p.page_number == 1)
        self.assertGreater(page.confidence, 0.5)
        self.assertIn("title_marker", page.signals)
        self.assertIn("monotonic_page_sequence", page.signals)

    def test_body_page_is_not_a_toc(self):
        self.assertEqual(detect_toc_pages({1: BODY_PAGE}), [])

    def test_table_of_numbers_is_not_a_toc(self):
        # Номера справа есть, но они не растут и выносок нет.
        table = "\n".join(f"Опыт {i}   {40 - i}" for i in range(1, 12))
        self.assertEqual(detect_toc_pages({5: table}), [])

    def test_span_is_a_continuous_block(self):
        pages = {1: TOC_PAGE, 2: TOC_PAGE, 7: "проза"}
        self.assertEqual(toc_page_span(pages), [1, 2])


class TocParsingTests(SimpleTestCase):
    def setUp(self):
        self.nodes = parse_toc_lines(TOC_PAGE.split("\n"))
        self.by_title = {node.title: node for node in self.nodes}

    def test_running_number_and_marker_are_dropped(self):
        titles = set(self.by_title)
        self.assertNotIn("507", titles)
        self.assertNotIn("Оглавление", titles)

    def test_wrapped_entry_keeps_its_page(self):
        """«§ 3. …метода» + «исследования … 8» — одна запись, а не две."""
        node = next(n for n in self.nodes if n.number_label.startswith("§ 3"))
        self.assertIn("исследования", node.title)
        self.assertEqual(node.printed_page, 8)

    def test_wrapped_container_title_is_joined(self):
        # Продолжение со строчной буквы — перенос, а не новый раздел.
        self.assertIn(
            "Основные особенности физического метода исследования", self.by_title
        )

    def test_container_does_not_swallow_the_next_paragraph(self):
        """Регрессия: «Введение» съедало «§ 1.» вместе с его страницей."""
        introduction = self.by_title["Введение"]
        self.assertIsNone(introduction.printed_page)
        first = next(n for n in self.nodes if n.number_label.startswith("§ 1."))
        self.assertEqual(first.printed_page, 3)
        self.assertEqual(first.title, "Необходимость познания природы")

    def test_part_and_chapter_are_distinguished(self):
        # Контейнер, под которым сразу другой контейнер, — часть; контейнер, под
        # которым идут разделы, — глава. Вёрстки у нас нет, и это единственный
        # признак, который даёт само оглавление.
        self.assertEqual(self.by_title["Введение"].level, 1)
        self.assertEqual(
            self.by_title["Зарождение и развитие научного взгляда на мир"].level, 2
        )

    def test_sections_hang_under_their_chapter(self):
        chapter = self.by_title["Зарождение и развитие научного взгляда на мир"]
        section = next(n for n in self.nodes if n.number_label.startswith("§ 2"))
        self.assertEqual(self.nodes[section.parent_index].title, chapter.title)
        self.assertGreater(section.level, chapter.level)

    def test_service_roles_are_recognised(self):
        roles = {node.title: node.role for node in self.nodes}
        self.assertEqual(roles["Упражнение"], Role.EXERCISE_SET)
        self.assertEqual(roles["Ответы"], Role.ANSWERS)

    def test_parsing_is_deterministic(self):
        again = parse_toc_lines(TOC_PAGE.split("\n"))
        self.assertEqual(
            [(n.title, n.level, n.printed_page) for n in self.nodes],
            [(n.title, n.level, n.printed_page) for n in again],
        )


class PageOffsetTests(SimpleTestCase):
    def test_offset_needs_several_votes(self):
        """Одно совпадение не доказывает смещение: заголовок бывает в ссылке."""
        nodes = parse_toc_lines(TOC_PAGE.split("\n"))
        offset, votes = find_page_offset(nodes, {4: "Необходимость познания природы"})
        self.assertIsNone(offset)
        self.assertLess(votes, 3)

    def test_offset_is_found_when_confirmed(self):
        nodes = parse_toc_lines(TOC_PAGE.split("\n"))
        # Печатная 3 → PDF 4: обложка и титул тоже занимают листы.
        pages = {
            4: "Необходимость познания природы",
            6: "Наука для всех",
            9: "Зарождение и развитие современного научного метода исследования",
            15: "Физика — экспериментальная наука",
        }
        offset, votes = find_page_offset(nodes, pages)
        self.assertEqual(offset, 1)
        self.assertGreaterEqual(votes, 3)


class OutlineBuildTests(SimpleTestCase):
    def test_body_lines_never_become_chapters(self):
        """Главный регресс: строки из списка упражнений — не главы курса."""
        outline = build_outline({1: TOC_PAGE, 2: BODY_PAGE})
        titles = " ".join(node.title.lower() for node in outline.nodes)
        for junk in ("вектор o", "шарик неподвижен", "оба шара", "гипотезы"):
            self.assertNotIn(junk, titles)

    def test_toc_wins_over_body(self):
        outline = build_outline({1: TOC_PAGE, 2: BODY_PAGE})
        self.assertEqual(outline.source, Source.TABLE_OF_CONTENTS)

    def test_service_sections_are_not_teachable(self):
        outline = build_outline({1: TOC_PAGE})
        teachable = {node.title for node in outline.teachable()}
        self.assertNotIn("Ответы", teachable)
        self.assertNotIn("Упражнение", teachable)
        self.assertIn("Необходимость познания природы", teachable)

    def test_without_toc_structure_is_not_confirmed(self):
        """Без оглавления структура остаётся догадкой и честно помечена такой."""
        outline = build_outline({1: BODY_PAGE}, fallback=[])
        self.assertEqual(outline.source, Source.HEURISTIC)
        self.assertIn("no_toc", outline.signals)
        self.assertFalse(any(node.verified for node in outline.nodes))
