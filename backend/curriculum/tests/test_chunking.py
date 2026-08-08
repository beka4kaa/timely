"""Чанкинг: детерминированность и разделение задач с решениями."""

from django.test import SimpleTestCase

from curriculum.chunking import (
    SourceBlock,
    chunk_blocks,
    compute_content_hash,
    normalize_text,
    split_tasks_and_solutions,
)

VERSION = "1.0.0"


def block(block_id, kind, text, order, page=1, section="1.1", **kwargs):
    return SourceBlock(
        block_id=block_id,
        kind=kind,
        text=text,
        page=page,
        reading_order=order,
        section_path=section,
        **kwargs,
    )


class NormalizationTests(SimpleTestCase):
    def test_collapses_whitespace_and_soft_hyphens(self):
        raw = "Ускорение  \n\t сво­бодного   падения"
        self.assertEqual(normalize_text(raw), "Ускорение свободного падения")

    def test_hash_depends_on_type_and_version(self):
        text = "Определение производной"
        base = compute_content_hash(
            chunk_type="definition", normalized_text=text, processing_version="1.0.0"
        )
        other_type = compute_content_hash(
            chunk_type="prose", normalized_text=text, processing_version="1.0.0"
        )
        other_version = compute_content_hash(
            chunk_type="definition", normalized_text=text, processing_version="2.0.0"
        )
        self.assertNotEqual(base, other_type)
        self.assertNotEqual(base, other_version)


class ChunkingTests(SimpleTestCase):
    def test_definition_theorem_example_are_separate_chunks(self):
        chunks = chunk_blocks(
            [
                block("b1", "definition", "Производная — предел отношения.", 1),
                block("b2", "theorem", "Теорема Лагранжа.", 2),
                block("b3", "example", "Пример 1. Найдём производную.", 3),
            ],
            processing_version=VERSION,
        )
        self.assertEqual(
            [c.chunk_type for c in chunks], ["definition", "theorem", "example"]
        )

    def test_proof_links_to_preceding_theorem(self):
        chunks = chunk_blocks(
            [
                block("b1", "theorem", "Теорема о среднем.", 1),
                block("b2", "paragraph", "Связующий абзац.", 2),
                block("b3", "proof", "Доказательство теоремы.", 3),
            ],
            processing_version=VERSION,
        )
        proof = next(c for c in chunks if c.chunk_type == "proof")
        theorem_index = next(
            i for i, c in enumerate(chunks) if c.chunk_type == "theorem"
        )
        self.assertEqual(proof.parent_index, theorem_index)

    def test_figure_absorbs_its_caption(self):
        chunks = chunk_blocks(
            [
                block("b1", "figure", "Рисунок 3.", 1),
                block("b2", "caption", "Наклонная плоскость под углом 30°.", 2),
            ],
            processing_version=VERSION,
        )
        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].chunk_type, "figure")
        self.assertIn("Наклонная плоскость", chunks[0].normalized_text)
        self.assertEqual(chunks[0].block_ids, ("b1", "b2"))

    def test_task_and_solution_never_share_a_chunk(self):
        chunks = chunk_blocks(
            [
                block("b1", "exercise", "Задача 5. Найдите ускорение.", 1),
                block("b2", "solution", "Решение: a = F/m = 2 м/с².", 2),
            ],
            processing_version=VERSION,
        )
        self.assertEqual(len(chunks), 2)
        task = next(c for c in chunks if c.chunk_type == "task")
        solution = next(c for c in chunks if c.chunk_type == "solution")

        self.assertNotIn("Решение", task.normalized_text)
        self.assertNotIn("a = F/m", task.normalized_text)
        self.assertEqual(solution.solution_visibility, "restricted")
        self.assertEqual(task.solution_visibility, "always")

    def test_prose_is_split_by_section(self):
        chunks = chunk_blocks(
            [
                block("b1", "paragraph", "Первый раздел.", 1, section="1.1"),
                block("b2", "paragraph", "Другой раздел.", 2, section="1.2"),
            ],
            processing_version=VERSION,
        )
        self.assertEqual(len(chunks), 2)
        self.assertEqual([c.section_path for c in chunks], ["1.1", "1.2"])

    def test_heading_closes_prose_but_is_not_a_chunk(self):
        chunks = chunk_blocks(
            [
                block("b1", "paragraph", "До заголовка.", 1),
                block("b2", "heading", "§2 Динамика", 2),
                block("b3", "paragraph", "После заголовка.", 3),
            ],
            processing_version=VERSION,
        )
        self.assertEqual(len(chunks), 2)
        self.assertTrue(all(c.chunk_type == "prose" for c in chunks))

    def test_previous_next_links_are_consistent(self):
        chunks = chunk_blocks(
            [
                block("b1", "definition", "Первое.", 1),
                block("b2", "definition", "Второе.", 2),
                block("b3", "definition", "Третье.", 3),
            ],
            processing_version=VERSION,
        )
        self.assertIsNone(chunks[0].previous_index)
        self.assertEqual(chunks[0].next_index, 1)
        self.assertEqual(chunks[1].previous_index, 0)
        self.assertEqual(chunks[2].next_index, None)

    def test_output_is_deterministic_and_order_independent(self):
        blocks = [
            block("b1", "definition", "Определение.", 1),
            block("b2", "exercise", "Задача.", 2),
            block("b3", "solution", "Решение.", 3),
        ]
        first = chunk_blocks(blocks, processing_version=VERSION)
        # Тот же вход в другом порядке поступления должен дать тот же результат:
        # чанкер сортирует по reading_order сам.
        second = chunk_blocks(list(reversed(blocks)), processing_version=VERSION)

        self.assertEqual(
            [c.content_hash for c in first], [c.content_hash for c in second]
        )
        self.assertEqual([c.chunk_type for c in first], [c.chunk_type for c in second])


class TaskSolutionSplitTests(SimpleTestCase):
    def test_pairs_by_explicit_block_reference(self):
        pairs = split_tasks_and_solutions(
            [
                block("t1", "exercise", "Задача 1.", 1, number_label="1"),
                block("s1", "solution", "Решение 1.", 2, task_block_id="t1"),
            ]
        )
        self.assertEqual(len(pairs), 1)
        self.assertEqual(pairs[0].solution_block_id, "s1")
        self.assertNotIn("Решение", pairs[0].task_text)

    def test_pairs_by_number_when_reference_missing(self):
        pairs = split_tasks_and_solutions(
            [
                block("t1", "exercise", "Задача 12.4.", 1, number_label="12.4"),
                block("s1", "solution", "Решение.", 2, number_label="12.4"),
            ]
        )
        self.assertEqual(pairs[0].solution_block_id, "s1")

    def test_unmatched_solution_is_not_attached_to_wrong_task(self):
        pairs = split_tasks_and_solutions(
            [
                block("t1", "exercise", "Задача 1.", 1, number_label="1"),
                block("s9", "solution", "Решение к задаче 99.", 2, number_label="99"),
            ]
        )
        self.assertEqual(len(pairs), 1)
        self.assertIsNone(pairs[0].solution_block_id)
        self.assertEqual(pairs[0].solution_text, "")
