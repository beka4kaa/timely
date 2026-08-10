"""Закладки PDF как структура книги.

Регресс снят с «Hands-On Machine Learning»: у книги 234 закладки с точными
страницами, но их не читали, и главами курса становились подписи врезок
O'Reilly — `WARNING`, `NOTE`, `TIP`.

Тесты без файла и без сети: `nodes_from_bookmarks` работает над тройками
`(уровень, название, страница)`.
"""

from __future__ import annotations

from django.test import SimpleTestCase

from curriculum.outline.builder import build_outline
from curriculum.outline.contracts import Role, Source
from curriculum.outline.embedded import nodes_from_bookmarks

# Верх у O'Reilly плоский: часть и глава — соседи на одном уровне закладок.
FLAT = [
    (0, "Preface", 7),
    (1, "Conventions Used in This Book", 18),
    (0, "I. The Fundamentals of Machine Learning", 23),
    (0, "1. The Machine Learning Landscape", 24),
    (1, "What Is Machine Learning?", 25),
    (1, "Types of Machine Learning Systems", 35),
    (2, "Training Supervision", 35),
    (2, "Batch Versus Online Learning", 48),
    (0, "2. End-to-End Machine Learning Project", 90),
    (1, "Working with Real Data", 91),
    (0, "About the Author", 682),
]

# Вложенное дерево: часть содержит свои главы.
NESTED = [
    (0, "Part I. Foundations", 10),
    (1, "1. Getting Started", 12),
    (2, "Installing the Tools", 13),
    (1, "2. First Steps", 40),
    (0, "Part II. Advanced", 100),
    (1, "3. Going Deeper", 101),
]


class LevelMappingTests(SimpleTestCase):
    def test_плоский_верх_различает_часть_и_главу(self):
        """Обе записи на уровне 0 закладок, но одна — часть, другая — глава.

        Различить их можно только по нумерации: части нумеруют римскими
        цифрами, главы — арабскими.
        """
        by_title = {n.title: n for n in nodes_from_bookmarks(FLAT, total_pages=682)}

        self.assertEqual(by_title["The Fundamentals of Machine Learning"].level, 1)
        self.assertEqual(by_title["The Machine Learning Landscape"].level, 2)
        self.assertEqual(by_title["What Is Machine Learning?"].level, 3)
        self.assertEqual(by_title["Training Supervision"].level, 4)

    def test_вложенное_дерево_сдвигает_уровни(self):
        by_title = {n.title: n for n in nodes_from_bookmarks(NESTED, total_pages=200)}

        self.assertEqual(by_title["Foundations"].level, 1)
        self.assertEqual(by_title["Getting Started"].level, 2)
        self.assertEqual(by_title["Installing the Tools"].level, 3)

    def test_слово_part_сильнее_арабского_номера(self):
        nodes = nodes_from_bookmarks(
            [(0, "Part 2 Neural Networks", 481), (0, "9. Introduction", 482)],
            total_pages=682,
        )
        self.assertEqual(nodes[0].level, 1)
        self.assertEqual(nodes[1].level, 2)


class NumberAndTitleTests(SimpleTestCase):
    def test_номер_отделяется_от_названия(self):
        """Иначе интерфейс покажет «1  1. The Machine Learning Landscape»."""
        node = next(
            n
            for n in nodes_from_bookmarks(FLAT, total_pages=682)
            if n.title == "The Machine Learning Landscape"
        )
        self.assertEqual(node.number_label, "1")

    def test_слово_части_остаётся_в_номере(self):
        nodes = nodes_from_bookmarks(
            [(0, "Part 2 Neural Networks", 1)], total_pages=9
        )
        node = nodes[0]
        self.assertEqual(node.number_label, "Part 2")
        self.assertEqual(node.title, "Neural Networks")

    def test_запись_без_номера_остаётся_как_есть(self):
        node = nodes_from_bookmarks([(0, "Preface", 7)], total_pages=20)[0]
        self.assertEqual(node.number_label, "")
        self.assertEqual(node.title, "Preface")

    def test_номер_без_названия_не_съедается(self):
        """«Глава 1» отдельной строкой — это и есть всё название."""
        node = nodes_from_bookmarks([(0, "Глава 1", 5)], total_pages=50)[0]
        self.assertEqual(node.title, "Глава 1")


class PageRangeTests(SimpleTestCase):
    def setUp(self):
        self.by_title = {
            n.title: n for n in nodes_from_bookmarks(FLAT, total_pages=682)
        }

    def test_конец_главы_считается_по_следующей_главе(self):
        """Регресс: по ближайшей закладке конец главы — её же первый параграф.

        Глава на семьдесят страниц получала одну, и время по ней считалось как
        за страницу.
        """
        chapter = self.by_title["The Machine Learning Landscape"]
        self.assertEqual((chapter.start_page, chapter.end_page), (24, 89))

    def test_часть_охватывает_свои_главы(self):
        """Часть кончается там, где начинается следующая часть.

        В этой выборке следующей части нет, поэтому часть идёт до конца книги:
        «About the Author» стоит на уровне глав и частью не ограничивается.
        """
        part = self.by_title["The Fundamentals of Machine Learning"]
        self.assertEqual((part.start_page, part.end_page), (23, 682))

    def test_часть_кончается_на_следующей_части(self):
        nodes = nodes_from_bookmarks(NESTED, total_pages=200)
        first = next(n for n in nodes if n.title == "Foundations")
        self.assertEqual((first.start_page, first.end_page), (10, 99))

    def test_последняя_запись_доходит_до_конца_книги(self):
        self.assertEqual(self.by_title["About the Author"].end_page, 682)

    def test_раздел_кончается_перед_следующим(self):
        section = self.by_title["What Is Machine Learning?"]
        self.assertEqual((section.start_page, section.end_page), (25, 34))

    def test_печатный_номер_не_придумывается(self):
        """Закладка указывает на страницу PDF, а не на напечатанную в книге."""
        self.assertIsNone(self.by_title["Preface"].printed_page)


class BuildOutlineTests(SimpleTestCase):
    def test_закладки_побеждают_разбор_тела(self):
        body = "WARNING\nNOTE\nTIP\n1. Вектор o\n"
        outline = build_outline(
            {1: body},
            embedded=nodes_from_bookmarks(FLAT, total_pages=682),
        )
        self.assertEqual(outline.source, Source.PDF_OUTLINE)
        titles = {node.title for node in outline.nodes}
        self.assertNotIn("WARNING", titles)
        self.assertIn("The Machine Learning Landscape", titles)

    def test_служебные_разделы_не_попадают_в_программу(self):
        """«About the Author» и «Preface» — не учебный материал."""
        outline = build_outline(
            {}, embedded=nodes_from_bookmarks(FLAT, total_pages=682)
        )
        teachable = {node.title for node in outline.teachable()}

        self.assertNotIn("About the Author", teachable)
        self.assertNotIn("Preface", teachable)
        self.assertIn("What Is Machine Learning?", teachable)

    def test_структура_из_закладок_считается_подтверждённой(self):
        outline = build_outline(
            {}, embedded=nodes_from_bookmarks(FLAT, total_pages=682)
        )
        self.assertTrue(all(node.verified for node in outline.nodes))

    def test_без_закладок_работает_прежний_путь(self):
        outline = build_outline({1: "проза без структуры"}, embedded=[])
        self.assertEqual(outline.source, Source.HEURISTIC)

    def test_роли_расставляются(self):
        outline = build_outline(
            {}, embedded=nodes_from_bookmarks(FLAT, total_pages=682)
        )
        by_title = {node.title: node for node in outline.nodes}
        self.assertEqual(
            by_title["The Fundamentals of Machine Learning"].role, Role.PART
        )
        self.assertEqual(by_title["About the Author"].role, Role.FRONT_MATTER)


class EmptyInputTests(SimpleTestCase):
    def test_пустые_закладки(self):
        self.assertEqual(nodes_from_bookmarks([], total_pages=100), [])

    def test_закладка_без_названия_пропускается(self):
        nodes = nodes_from_bookmarks([(0, "   ", 5), (0, "Глава", 6)], total_pages=50)
        self.assertEqual([n.title for n in nodes], ["Глава"])
