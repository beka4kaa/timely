"""Извлечение страниц из PDF и разметка текста в блоки."""

from django.test import SimpleTestCase

from curriculum.blocks import PageText, classify_pages
from curriculum.chunking import chunk_blocks, split_tasks_and_solutions
from curriculum.extraction import (
    NATIVE_TEXT_MIN_CHARS,
    PdfExtractionError,
    extract_pages,
    real_page_count,
    render_page_png,
)
from curriculum.tests.pdf_fixtures import (
    TEXTBOOK_PAGE_ONE,
    build_text_pdf,
    scanned_pdf,
    textbook_pdf,
)


class PageExtractionTests(SimpleTestCase):
    def test_extracts_text_of_every_page(self):
        pages = extract_pages(textbook_pdf())
        self.assertEqual(len(pages), 2)
        self.assertEqual([p.page_number for p in pages], [1, 2])
        self.assertIn("Kinematics", pages[0].native_text)
        self.assertIn("Dynamics", pages[1].native_text)

    def test_reports_page_geometry(self):
        page = extract_pages(textbook_pdf())[0]
        self.assertAlmostEqual(page.width, 612.0, places=1)
        self.assertAlmostEqual(page.height, 792.0, places=1)

    def test_normalizes_crlf_from_pdfium(self):
        """pdfium отдаёт `\\r\\n`; хеши блоков не должны от этого зависеть."""
        page = extract_pages(textbook_pdf())[0]
        self.assertNotIn("\r", page.native_text)

    def test_blank_page_needs_ocr(self):
        pages = extract_pages(scanned_pdf())
        self.assertFalse(pages[0].needs_ocr)
        self.assertTrue(pages[1].needs_ocr)
        self.assertEqual(pages[1].native_text_length, 0)

    def test_short_page_needs_ocr(self):
        pdf = build_text_pdf(["x"])
        page = extract_pages(pdf)[0]
        self.assertLess(page.native_text_length, NATIVE_TEXT_MIN_CHARS)
        self.assertTrue(page.needs_ocr)

    def test_max_pages_caps_work(self):
        pages = extract_pages(build_text_pdf(["a" * 200] * 5), max_pages=2)
        self.assertEqual(len(pages), 2)

    def test_rejects_garbage(self):
        with self.assertRaises(PdfExtractionError):
            extract_pages(b"not a pdf at all")

    def test_empty_input_rejected(self):
        with self.assertRaises(PdfExtractionError):
            real_page_count(b"")

    def test_deterministic_across_runs(self):
        pdf = textbook_pdf()
        first = [p.native_text for p in extract_pages(pdf)]
        second = [p.native_text for p in extract_pages(pdf)]
        self.assertEqual(first, second)


class PageCountReconciliationTests(SimpleTestCase):
    def test_real_count_disagrees_with_regex_estimate(self):
        """Регулярочная оценка `upload_validation` может завышать число страниц.

        `minimal_pdf(3)` объявляет `/Count 3`, но pdfium открывает такой файл
        как одну страницу. Поэтому `Document.page_count` перезаписывается
        истинным значением на этапе извлечения, а регулярка остаётся только
        дешёвым гейтом до записи файла в storage.
        """
        from curriculum.tests.test_upload import minimal_pdf
        from curriculum.upload_validation import estimate_page_count

        pdf = minimal_pdf(3)
        self.assertEqual(estimate_page_count(pdf), 3)
        self.assertEqual(real_page_count(pdf), 1)

    def test_real_count_matches_for_valid_pdf(self):
        self.assertEqual(real_page_count(build_text_pdf(["a", "b", "c"])), 3)


class PageRenderTests(SimpleTestCase):
    def test_renders_png(self):
        png = render_page_png(textbook_pdf(), 1)
        self.assertTrue(png.startswith(b"\x89PNG\r\n\x1a\n"))
        self.assertGreater(len(png), 1000)

    def test_render_is_deterministic(self):
        pdf = textbook_pdf()
        self.assertEqual(render_page_png(pdf, 1), render_page_png(pdf, 1))

    def test_out_of_range_page_rejected(self):
        with self.assertRaises(PdfExtractionError):
            render_page_png(textbook_pdf(), 99)

    def test_scale_changes_size(self):
        pdf = textbook_pdf()
        small = render_page_png(pdf, 1, scale=1.0)
        large = render_page_png(pdf, 1, scale=2.0)
        self.assertGreater(len(large), len(small))

    def test_rejects_huge_media_box_before_render_allocation(self):
        hostile = build_text_pdf([""], page_size=(100_000, 100_000))

        with self.assertRaises(PdfExtractionError):
            render_page_png(hostile, 1)
        with self.assertRaises(PdfExtractionError):
            extract_pages(hostile)


class BlockClassificationTests(SimpleTestCase):
    """Разметка русского текста — прямыми вызовами, без PDF.

    Кириллицы в PDF-фикстурах нет (Helvetica её не кодирует), а классификатор
    работает над строкой, так что шрифт здесь ни при чём.
    """

    RUSSIAN_PAGE = """ГЛАВА 1. МЕХАНИКА
1.2 Кинематика точки
Тело движется по прямой с постоянным
ускорением a.
Определение. Скорость есть производная
радиус-вектора по времени.
Теорема 3. Путь равен интегралу скорости.
Доказательство. Следует из определения.
Задача 5. Найдите путь за 3 с.
Решение. s = v0 t + a t^2 / 2.
1.3 Динамика
Второй закон Ньютона связывает силу и
ускорение.
Рис. 4. Схема сил."""

    def _classify(self):
        return classify_pages([PageText(1, self.RUSSIAN_PAGE)], document_id="bk")

    def test_detects_every_marker_kind(self):
        blocks, _ = self._classify()
        kinds = [b.kind for b in blocks]
        for expected in ("definition", "theorem", "proof", "exercise", "solution"):
            self.assertIn(expected, kinds, f"не распознан блок {expected}")

    def test_caption_after_dotted_abbreviation_is_detected(self):
        """«Рис. 4.» должен стать caption.

        Регрессия: в паттернах вида `рис\\.` граница `\\b` после литеральной
        точки не срабатывает никогда (и точка, и пробел — не-словные символы),
        из-за чего подпись молча уезжала в прозу.
        """
        blocks, _ = self._classify()
        captions = [b for b in blocks if b.kind == "caption"]
        self.assertEqual(len(captions), 1)
        self.assertTrue(captions[0].text.startswith("Рис. 4."))

    def test_paragraph_continuation_is_not_a_heading(self):
        """Перенос абзаца не должен становиться разделом.

        Регрессия: эвристика «короткая строка без точки на конце» считала
        заголовком строку «Тело движется по прямой с постоянным», из-за чего
        остаток абзаца приписывался к выдуманному разделу. `section_path`
        уезжает в `CourseSourceBinding`, так что цена ошибки — неверная ссылка
        на источник у темы курса.
        """
        _, sections = self._classify()
        titles = [s.title for s in sections]
        self.assertEqual(titles, ["МЕХАНИКА", "Кинематика точки", "Динамика"])

    def test_section_hierarchy_and_paths(self):
        _, sections = self._classify()
        self.assertEqual(
            [(s.path, s.kind) for s in sections],
            [("1", "chapter"), ("1.2", "section"), ("1.3", "section")],
        )

    def test_blocks_keep_their_real_section(self):
        blocks, _ = self._classify()
        by_kind = {b.kind: b for b in blocks}
        self.assertEqual(by_kind["definition"].section_path, "1.2")
        self.assertEqual(by_kind["caption"].section_path, "1.3")

    def test_solution_links_to_preceding_task(self):
        blocks, _ = self._classify()
        task = next(b for b in blocks if b.kind == "exercise")
        solution = next(b for b in blocks if b.kind == "solution")
        self.assertEqual(solution.task_block_id, task.block_id)

    def test_number_label_taken_only_after_marker(self):
        """У решения нет своего номера.

        Регрессия: номер искался по всей строке, и «Решение. s = v0 t …» давало
        number_label="0", выхваченный из «v0».
        """
        blocks, _ = self._classify()
        by_kind = {b.kind: b for b in blocks}
        self.assertEqual(by_kind["exercise"].number_label, "5")
        self.assertEqual(by_kind["theorem"].number_label, "3")
        self.assertEqual(by_kind["solution"].number_label, "")

    def test_multi_digit_numbers(self):
        blocks, _ = classify_pages([PageText(1, "Задача 12.3. Найдите путь.")])
        self.assertEqual(blocks[0].number_label, "12.3")

    def test_classification_is_deterministic(self):
        first, _ = self._classify()
        second, _ = self._classify()
        self.assertEqual(
            [(b.block_id, b.kind, b.text) for b in first],
            [(b.block_id, b.kind, b.text) for b in second],
        )

    def test_chunk_hashes_stable_across_runs(self):
        blocks, _ = self._classify()
        again, _ = self._classify()
        first = chunk_blocks(list(blocks), processing_version="1.0.0")
        second = chunk_blocks(list(again), processing_version="1.0.0")
        self.assertEqual(
            [c.content_hash for c in first], [c.content_hash for c in second]
        )


class HeadingDetectionTests(SimpleTestCase):
    """Регрессии, снятые с живого учебника.

    «Механика, 10 класс» Мякишева (513 страниц) давала 1151 «раздел». Каждый
    тест ниже — отдельный источник этого мусора. Цена ошибки не косметическая:
    оглавление уходит планировщику как есть, и он честно превращает каждый
    обрывок в тему курса.
    """

    def _titles(self, text: str, page: int = 1) -> list[str]:
        _, sections = classify_pages([PageText(page, text)])
        return [s.title for s in sections]

    def test_footnote_marker_is_not_a_heading(self):
        # «1 Это введение…» — сноска, приклеенная к первой строке абзаца.
        # Голый номер без точки заголовком больше не считается.
        titles = self._titles(
            "1 Это введение при первом чтении может показаться сложным."
        )
        self.assertEqual(titles, [])

    def test_numbered_questions_are_not_headings(self):
        """Список вопросов к параграфу — не оглавление.

        Отличить «3. Динамика» от «3. Почему второй закон…» по словам нельзя, а
        по длине ненадёжно: PDF отдаёт строку уже перенесённой. Зато список
        виден по количеству.
        """
        titles = self._titles(
            "1. Какие гипотезы проверял Галилей?\n"
            "2. Почему второй закон Ньютона называют\n"
            "3. Проведите классификацию движений\n"
            "4. Маховик приобрёл начальную угловую"
        )
        self.assertEqual(titles, [])

    def test_single_numbered_heading_still_works(self):
        # Обратная сторона правила выше: одиночный нумерованный заголовок в
        # книге без «§» обязан выжить.
        self.assertEqual(self._titles("3. Динамика"), ["Динамика"])

    def test_heading_split_across_lines_is_merged(self):
        """PDF разрывает заголовок по строкам вёрстки.

        Без склейки вторая половина становилась отдельным разделом с названием
        вроде «НАУЧНОГО ВЗГЛЯДА НА МИР».
        """
        titles = self._titles("ЗАРОЖДЕНИЕ И РАЗВИТИЕ\nНАУЧНОГО ВЗГЛЯДА НА МИР")
        self.assertEqual(titles, ["ЗАРОЖДЕНИЕ И РАЗВИТИЕ НАУЧНОГО ВЗГЛЯДА НА МИР"])

    def test_front_matter_code_is_not_a_heading(self):
        # «УДК» — три заглавные буквы, то есть формально капс.
        self.assertEqual(self._titles("УДК 373.167.1:53"), [])

    def test_page_number_fragments_are_not_headings(self):
        # «2 2» давало раздел с названием «2» — таких было 23 на книгу.
        self.assertEqual(self._titles("2 2"), [])
        self.assertEqual(self._titles("1 1"), [])

    def test_formula_fragment_is_not_a_heading(self):
        # Заглавные буквы вокруг знака равенства — это формула, а не заголовок.
        self.assertEqual(self._titles("1.20 SOABC = +"), [])

    def test_section_ends_where_the_next_one_starts(self):
        """`end_page` считается по порядку, а не по `path`.

        Пути не уникальны — `_next_sibling_path` повторяет «1» в разных главах.
        Поиск по пути давал разделу на 4-й странице конец от одноимённого
        раздела с 400-й, и почти вся книга заявляла диапазон «3–400».
        """
        _, sections = classify_pages(
            [
                PageText(1, "§ 1. ПЕРВЫЙ"),
                PageText(2, "Обычный текст параграфа."),
                PageText(3, "§ 2. ВТОРОЙ"),
                PageText(9, "Ещё текст."),
            ]
        )
        self.assertEqual(
            [(s.title, s.start_page, s.end_page) for s in sections],
            [("ПЕРВЫЙ", 1, 3), ("ВТОРОЙ", 3, 9)],
        )


class SolutionSeparationTests(SimpleTestCase):
    """Самое важное свойство: решение не склеивается с условием."""

    def test_solution_chunk_is_restricted(self):
        blocks, _ = classify_pages([PageText(1, TEXTBOOK_PAGE_ONE)])
        chunks = chunk_blocks(list(blocks), processing_version="1.0.0")
        solutions = [c for c in chunks if c.chunk_type == "solution"]
        self.assertEqual(len(solutions), 1)
        self.assertEqual(solutions[0].solution_visibility, "restricted")

    def test_no_chunk_holds_both_statement_and_solution(self):
        """Регрессия на разбиении по пустым строкам.

        Экстрактор PDF не ставит пустых строк между абзацами, и группировка «по
        пустой строке» возвращала всю страницу одним блоком `paragraph` —
        вместе с условием задачи И её решением. Такой чанк ушёл бы с
        `solution_visibility="always"`, то есть решение утекло бы ученику.
        """
        blocks, _ = classify_pages([PageText(1, TEXTBOOK_PAGE_ONE)])
        chunks = chunk_blocks(list(blocks), processing_version="1.0.0")
        for chunk in chunks:
            if chunk.solution_visibility == "always":
                self.assertNotIn("s = v0 t", chunk.normalized_text)

    def test_task_solution_pairs_stay_separate(self):
        blocks, _ = classify_pages([PageText(1, TEXTBOOK_PAGE_ONE)])
        pairs = split_tasks_and_solutions(blocks)
        self.assertEqual(len(pairs), 1)
        pair = pairs[0]
        self.assertIn("Find the path", pair.task_text)
        self.assertIn("s = v0 t", pair.solution_text)
        self.assertNotIn("s = v0 t", pair.task_text)
