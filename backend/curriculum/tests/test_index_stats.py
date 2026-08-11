"""Диагностика индекса: она должна ловить тихие поломки.

Главная из них — расхождение модели. `PgVectorDenseRetriever` отбирает
фрагменты по точному совпадению `embedding_model`; не совпало — плотный поиск
возвращает пусто, ошибки нет, и снаружи это выглядит просто как «отвечает так
себе».
"""

from __future__ import annotations

from django.test import TestCase

from curriculum.index_stats import collect_index_stats
from curriculum.models import Document, KnowledgeChunk

OWNER = "student@timelyplan.me"
MODEL = "openai/text-embedding-3-small"


def document(**kwargs) -> Document:
    kwargs.setdefault("title", "Механика")
    kwargs.setdefault("language", "ru")
    return Document.objects.create(user_email=OWNER, **kwargs)


def chunk(doc: Document, *, index: int = 0, **kwargs) -> KnowledgeChunk:
    kwargs.setdefault("normalized_text", "Импульс тела")
    kwargs.setdefault("token_count", 500)
    kwargs.setdefault("processing_version", doc.processing_version)
    kwargs.setdefault("section_id", None)
    return KnowledgeChunk.objects.create(
        document_id=doc.pk, content_hash=f"{index:064d}", **kwargs
    )


class HealthyIndexTests(TestCase):
    def setUp(self):
        self.document = document()
        for index in range(3):
            chunk(
                self.document,
                index=index,
                embedding_status=KnowledgeChunk.EmbeddingStatus.READY,
                embedding_model=MODEL,
                section_id="11111111-1111-1111-1111-111111111111",
            )

    def test_здоровый_индекс_без_замечаний(self):
        stats = collect_index_stats(self.document, active_model=MODEL)
        self.assertEqual(stats.problems(), [])
        self.assertTrue(stats.dense_search_works)
        self.assertEqual(stats.searchable_chunks, 3)

    def test_размеры_фрагментов_считаются(self):
        stats = collect_index_stats(self.document, active_model=MODEL)
        self.assertEqual(stats.tokens_median, 500)
        self.assertEqual(stats.tokens_max, 500)


class BrokenIndexTests(TestCase):
    def test_расхождение_модели_видно_явно(self):
        """Тихая поломка: векторы есть, но не той модели.

        Плотный поиск при этом молча возвращает пусто.
        """
        doc = document()
        chunk(
            doc,
            embedding_status=KnowledgeChunk.EmbeddingStatus.READY,
            embedding_model="старая-модель",
            section_id="11111111-1111-1111-1111-111111111111",
        )

        stats = collect_index_stats(doc, active_model=MODEL)

        self.assertFalse(stats.dense_search_works)
        self.assertEqual(stats.searchable_chunks, 0)
        self.assertTrue(
            any("действующей моделью" in problem for problem in stats.problems()),
            stats.problems(),
        )

    def test_книга_без_фрагментов(self):
        stats = collect_index_stats(document(), active_model=MODEL)
        self.assertEqual(stats.total_chunks, 0)
        self.assertTrue(any("не обработана" in p for p in stats.problems()))

    def test_провайдер_не_настроен(self):
        doc = document()
        chunk(doc, section_id="11111111-1111-1111-1111-111111111111")

        stats = collect_index_stats(doc, active_model="")

        self.assertFalse(stats.dense_search_works)
        self.assertTrue(any("не настроен" in p for p in stats.problems()))

    def test_упавшие_фрагменты_видны(self):
        doc = document()
        chunk(
            doc,
            embedding_status=KnowledgeChunk.EmbeddingStatus.FAILED,
            section_id="11111111-1111-1111-1111-111111111111",
        )
        chunk(
            doc,
            index=1,
            embedding_status=KnowledgeChunk.EmbeddingStatus.READY,
            embedding_model=MODEL,
            section_id="11111111-1111-1111-1111-111111111111",
        )

        problems = collect_index_stats(doc, active_model=MODEL).problems()

        self.assertTrue(any("не удалось посчитать" in p for p in problems))

    def test_фрагмент_без_раздела_не_даст_цитаты(self):
        doc = document()
        chunk(
            doc,
            embedding_status=KnowledgeChunk.EmbeddingStatus.READY,
            embedding_model=MODEL,
        )

        stats = collect_index_stats(doc, active_model=MODEL)

        self.assertEqual(stats.unbound_chunks, 1)
        self.assertTrue(any("не привязаны к разделу" in p for p in stats.problems()))

    def test_книга_без_языка_отмечается(self):
        doc = document(language="")
        chunk(
            doc,
            embedding_status=KnowledgeChunk.EmbeddingStatus.READY,
            embedding_model=MODEL,
            section_id="11111111-1111-1111-1111-111111111111",
        )

        problems = collect_index_stats(doc, active_model=MODEL).problems()

        self.assertTrue(any("не проставлен язык" in p for p in problems))

    def test_фрагменты_другой_версии_обработки_не_считаются(self):
        """Иначе диагностика показывает индекс книги, которой уже нет."""
        doc = document()
        chunk(doc, processing_version="0.9.0")

        self.assertEqual(collect_index_stats(doc, active_model=MODEL).total_chunks, 0)
