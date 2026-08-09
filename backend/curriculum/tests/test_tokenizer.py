"""Токенайзер и перекрытие фрагментов.

Главный тест здесь — не про размеры, а про безопасность: перекрытие не должно
пересекать границу задачи и решения. Наивное скользящее окно затащило бы текст
решения в фрагмент с `solution_visibility="always"`, и ученик увидел бы ответ
в обычной выдаче (Решения №3 в ROADMAP).
"""

from unittest import mock

from django.test import SimpleTestCase

from curriculum.chunking import (
    DEFAULT_MAX_TOKENS,
    DEFAULT_OVERLAP_TOKENS,
    DEFAULT_TARGET_TOKENS,
    SourceBlock,
    chunk_blocks,
)
from curriculum.tokenizer import (
    HeuristicTokenizer,
    TiktokenTokenizer,
    get_tokenizer,
    set_tokenizer,
)

VERSION = "test-1"


def block(block_id, kind, text, order, *, section="1.1", page=1) -> SourceBlock:
    return SourceBlock(
        block_id=block_id,
        kind=kind,
        text=text,
        page=page,
        reading_order=order,
        section_path=section,
    )


def prose_of(words: int, prefix: str = "слово") -> str:
    """Текст из УНИКАЛЬНЫХ слов.

    Уникальность обязательна: если слова повторяются между блоками, тест на
    накопление перекрытий не отличает «притащено из первого фрагмента» от
    «и так было во втором».
    """
    return " ".join(f"{prefix}{i}" for i in range(words))


class HeuristicTokenizerTests(SimpleTestCase):
    def setUp(self):
        self.tokenizer = HeuristicTokenizer()

    def test_пустой_текст_ноль_токенов(self):
        self.assertEqual(self.tokenizer.count(""), 0)

    def test_счёт_растёт_с_длиной(self):
        self.assertLess(self.tokenizer.count("abcd"), self.tokenizer.count("abcd" * 10))

    def test_хвост_не_режет_слово_пополам(self):
        text = "альфа бета гамма дельта эпсилон"
        tail = self.tokenizer.tail(text, 2)
        self.assertTrue(text.endswith(tail))
        # Обрывок вроде «льта эпсилон» попал бы и в эмбеддинг, и в цитату.
        self.assertTrue(all(word in text.split() for word in tail.split()))

    def test_хвост_короче_запроса_отдаёт_весь_текст(self):
        self.assertEqual(self.tokenizer.tail("коротко", 1000), "коротко")

    def test_нулевой_хвост_пуст(self):
        self.assertEqual(self.tokenizer.tail("что-нибудь", 0), "")


class TiktokenTests(SimpleTestCase):
    def setUp(self):
        set_tokenizer(None)
        self.tokenizer = get_tokenizer()
        if not isinstance(self.tokenizer, TiktokenTokenizer):
            self.skipTest("tiktoken/cl100k_base недоступен в этом окружении")

    def tearDown(self):
        set_tokenizer(None)

    def test_кириллица_считается_дороже_эвристики(self):
        # Ровно ради этого фаза и делалась: эвристика недосчитывает русский
        # почти вдвое, и фрагмент «на 350 токенов» весил около 630.
        russian = "Равномерное прямолинейное движение — это движение с постоянной скоростью тела."
        self.assertGreater(
            self.tokenizer.count(russian), HeuristicTokenizer().count(russian)
        )

    def test_хвост_ровно_в_запрошенное_число_токенов(self):
        text = prose_of(200)
        tail = self.tokenizer.tail(text, 30)
        self.assertEqual(self.tokenizer.count(tail), 30)


class TokenizerFactoryTests(SimpleTestCase):
    def tearDown(self):
        set_tokenizer(None)

    def test_без_tiktoken_остаётся_эвристика(self):
        set_tokenizer(None)
        with mock.patch.dict("sys.modules", {"tiktoken": None}):
            self.assertIsInstance(get_tokenizer(), HeuristicTokenizer)

    def test_недоступная_кодировка_не_роняет_разбиение(self):
        # tiktoken скачивает файл кодировки при первом обращении. В контейнере
        # с закрытым исходящим трафиком это исключение, а не пустой результат.
        set_tokenizer(None)
        import curriculum.tokenizer as module

        fake = mock.Mock()
        fake.get_encoding.side_effect = RuntimeError("нет сети")
        with mock.patch.dict("sys.modules", {"tiktoken": fake}):
            self.assertIsInstance(module._build_tokenizer(), HeuristicTokenizer)

    def test_результат_кэшируется(self):
        set_tokenizer(None)
        self.assertIs(get_tokenizer(), get_tokenizer())


class OverlapSafetyTests(SimpleTestCase):
    """Границы, которые перекрытие не пересекает ни при каких размерах."""

    def test_решение_не_протекает_в_соседние_фрагменты(self):
        secret = "ОТВЕТПЯТЬ"
        chunks = chunk_blocks(
            [
                block("b1", "paragraph", prose_of(400), 1),
                block("b2", "exercise", "Найдите ускорение бруска.", 2),
                block("b3", "solution", f"Решение: a = F/m = {secret}.", 3),
                block("b4", "paragraph", prose_of(400), 4),
            ],
            processing_version=VERSION,
            overlap_tokens=100,
        )
        leaked = [
            c for c in chunks
            if secret in c.normalized_text and c.solution_visibility != "restricted"
        ]
        self.assertEqual(leaked, [], "текст решения не может попасть в открытый фрагмент")

    def test_условие_задачи_не_приклеивается_к_прозе(self):
        chunks = chunk_blocks(
            [
                block("b1", "exercise", "Задача 7. Найдите путь.", 1),
                block("b2", "paragraph", prose_of(50), 2),
            ],
            processing_version=VERSION,
            overlap_tokens=100,
        )
        prose = [c for c in chunks if c.chunk_type == "prose"]
        self.assertTrue(prose)
        self.assertNotIn("Задача 7", prose[0].normalized_text)

    def test_перекрытия_между_разделами_нет(self):
        marker = "МАРКЕРПЕРВОГО"
        chunks = chunk_blocks(
            [
                block("b1", "paragraph", f"{prose_of(30)} {marker}", 1, section="1.1"),
                block("b2", "paragraph", prose_of(30), 2, section="1.2"),
            ],
            processing_version=VERSION,
            overlap_tokens=100,
        )
        second = [c for c in chunks if c.section_path == "1.2"][0]
        self.assertNotIn(marker, second.normalized_text)

    def test_заголовок_рвёт_перекрытие(self):
        marker = "МАРКЕРДОЗАГОЛОВКА"
        chunks = chunk_blocks(
            [
                block("b1", "paragraph", f"{prose_of(30)} {marker}", 1),
                block("b2", "heading", "§2 Динамика", 2),
                block("b3", "paragraph", prose_of(30), 3),
            ],
            processing_version=VERSION,
            overlap_tokens=100,
        )
        self.assertNotIn(marker, chunks[-1].normalized_text)


class OverlapBehaviourTests(SimpleTestCase):
    def _long_run(self, overlap: int):
        # Один длинный раздел прозы: он обязан разбиться на несколько фрагментов.
        # У каждого блока свой префикс слов — см. `prose_of`.
        blocks = [
            block(f"b{i}", "paragraph", prose_of(120, f"блок{i}сл"), i)
            for i in range(1, 9)
        ]
        return chunk_blocks(
            blocks,
            processing_version=VERSION,
            target_tokens=200,
            max_tokens=260,
            overlap_tokens=overlap,
        )

    def test_длинная_проза_разбивается_на_несколько_фрагментов(self):
        chunks = self._long_run(0)
        self.assertGreater(len(chunks), 1)

    def test_соседние_фрагменты_перекрываются(self):
        without = self._long_run(0)
        with_overlap = self._long_run(50)
        self.assertEqual(len(without), len(with_overlap))
        # Первый фрагмент не трогается: перекрывать ему нечего.
        self.assertEqual(without[0].normalized_text, with_overlap[0].normalized_text)
        # Каждый следующий стал длиннее и начинается хвостом предыдущего.
        for index in range(1, len(with_overlap)):
            self.assertGreater(
                len(with_overlap[index].normalized_text),
                len(without[index].normalized_text),
            )
            tail_word = without[index - 1].normalized_text.split()[-1]
            self.assertIn(tail_word, with_overlap[index].normalized_text)

    def test_перекрытия_не_накапливаются(self):
        # Третий фрагмент не должен тащить текст первого: хвост берётся от
        # ИСХОДНОГО соседа, а не от уже дополненного.
        chunks = self._long_run(50)
        self.assertGreaterEqual(len(chunks), 3)
        first_word = chunks[0].normalized_text.split()[0]
        self.assertNotIn(first_word, chunks[2].normalized_text)

    def test_страницы_и_блоки_остаются_своими(self):
        without = self._long_run(0)
        with_overlap = self._long_run(50)
        for a, b in zip(without, with_overlap):
            self.assertEqual(a.block_ids, b.block_ids)
            self.assertEqual((a.page_start, a.page_end), (b.page_start, b.page_end))

    def test_хеш_меняется_вместе_с_текстом(self):
        without = self._long_run(0)
        with_overlap = self._long_run(50)
        self.assertNotEqual(without[1].content_hash, with_overlap[1].content_hash)

    def test_счётчик_токенов_пересчитан_после_перекрытия(self):
        chunks = self._long_run(50)
        tokenizer = get_tokenizer()
        for chunk in chunks:
            self.assertEqual(chunk.token_count, tokenizer.count(chunk.normalized_text))

    def test_результат_детерминирован(self):
        first = self._long_run(50)
        second = self._long_run(50)
        self.assertEqual(
            [c.content_hash for c in first], [c.content_hash for c in second]
        )


class ChunkSizeTests(SimpleTestCase):
    def test_потолок_не_превышается_добавлением_блока(self):
        tokenizer = get_tokenizer()
        blocks = [
            block(f"b{i}", "paragraph", prose_of(60, f"блок{i}сл"), i)
            for i in range(1, 12)
        ]
        chunks = chunk_blocks(
            blocks,
            processing_version=VERSION,
            target_tokens=150,
            max_tokens=200,
            overlap_tokens=0,
        )
        for chunk in chunks:
            # Единственное исключение — блок, который сам по себе больше
            # потолка: разрезать его чанкер не станет, это механическая нарезка.
            if len(chunk.block_ids) > 1:
                self.assertLessEqual(tokenizer.count(chunk.normalized_text), 200)

    def test_дефолты_согласованы_между_собой(self):
        self.assertLess(DEFAULT_TARGET_TOKENS, DEFAULT_MAX_TOKENS)
        self.assertLess(DEFAULT_OVERLAP_TOKENS, DEFAULT_TARGET_TOKENS)
