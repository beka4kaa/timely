"""Схема кусков на настоящем Postgres: таблица, тип вектора и индексы.

На SQLite тесты с базой пропускаются: там нет ни pgvector, ни `to_regclass`.
Разбор версии pgvector базе не нужен и идёт везде.
"""

import importlib
import uuid
from unittest import skipUnless

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import SimpleTestCase, TestCase

from curriculum.embeddings import EmbeddingResult
from curriculum.models import EMBEDDING_DIMENSIONS, Document, KnowledgeChunk
from curriculum.retrieval import PgVectorDenseRetriever
from curriculum.services.chunk_view import as_retrievable


def django_apps_at(app, name):
    """Исторические модели в состоянии после миграции `name` приложения `app`."""
    return MigrationExecutor(connection).loader.project_state((app, name)).apps


class UnitQueryProvider:
    """На любой вопрос отдаёт единичный вектор по первой оси."""

    name = "unit-query"
    model = "unit-model"
    dimensions = EMBEDDING_DIMENSIONS

    def embed(self, texts):
        return EmbeddingResult(
            vectors=[[1.0] + [0.0] * (EMBEDDING_DIMENSIONS - 1) for _ in texts],
            model=self.model,
            succeeded=True,
        )


@skipUnless(connection.vendor == "postgresql", "нужен Postgres")
class VectorSchemaTests(TestCase):
    """Куски создаются только внутри тестов, общего `setUp` с кусками нет.

    После вставки куска в транзакции висят отложенные проверки самоссылок
    `parent`, `previous` и `next`, и тогда `DROP TABLE` падает с
    «pending trigger events».
    """

    def test_missing_chunk_table_is_created_with_both_indexes(self):
        migration = importlib.import_module("curriculum.migrations.0017_chunk_table_if_missing")
        with connection.cursor() as cursor:
            cursor.execute("DROP TABLE curriculum_knowledgechunk CASCADE")
        with connection.schema_editor() as editor:
            migration.ensure_chunk_table(django_apps_at("curriculum", "0016_studymaterial_courseplan_material_and_more"), editor)
        with connection.cursor() as cursor:
            cursor.execute("select to_regclass('public.curriculum_knowledgechunk') is not null")
            self.assertTrue(cursor.fetchone()[0])
            cursor.execute("select indexname from pg_indexes where tablename = 'curriculum_knowledgechunk'")
            names = {row[0] for row in cursor.fetchall()}
        self.assertIn("curriculum_chunk_embedding_hnsw", names)
        self.assertIn("curriculum_chunk_fts_ru_gin", names)

    def test_existing_table_is_left_alone(self):
        KnowledgeChunk.objects.create(document_id=uuid.uuid4(), normalized_text="текст", content_hash="h")
        migration = importlib.import_module("curriculum.migrations.0017_chunk_table_if_missing")
        with connection.schema_editor() as editor:
            migration.ensure_chunk_table(django_apps_at("curriculum", "0016_studymaterial_courseplan_material_and_more"), editor)
        self.assertEqual(KnowledgeChunk.objects.count(), 1)

    def test_embedding_column_is_halfvec(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "select format_type(atttypid, atttypmod) from pg_attribute "
                "where attrelid = 'curriculum_knowledgechunk'::regclass "
                "and attname = 'embedding'"
            )
            self.assertEqual(cursor.fetchone(), ("halfvec(1536)",))

    def test_hnsw_index_uses_halfvec_cosine_ops(self):
        with connection.cursor() as cursor:
            cursor.execute(
                "select indexdef from pg_indexes "
                "where tablename = 'curriculum_knowledgechunk' "
                "and indexname = 'curriculum_chunk_embedding_hnsw'"
            )
            row = cursor.fetchone()
        self.assertIsNotNone(row, "индекса curriculum_chunk_embedding_hnsw нет")
        self.assertIn("halfvec_cosine_ops", row[0])


@skipUnless(connection.vendor == "postgresql", "нужен Postgres")
class DenseSearchTests(TestCase):
    """Плотный поиск по колонке кусков. Куски создаются внутри теста."""

    def test_dense_search_finds_the_nearest_chunk(self):
        provider = UnitQueryProvider()
        document = Document.objects.create(user_email="a@b.c", title="Книга")
        near = KnowledgeChunk.objects.create(
            document_id=document.pk,
            normalized_text="ближний кусок",
            content_hash="near",
            embedding=[1.0] + [0.0] * (EMBEDDING_DIMENSIONS - 1),
            embedding_model=provider.model,
            embedding_status=KnowledgeChunk.EmbeddingStatus.READY,
        )
        far = KnowledgeChunk.objects.create(
            document_id=document.pk,
            normalized_text="дальний кусок",
            content_hash="far",
            embedding=[0.0, 1.0] + [0.0] * (EMBEDDING_DIMENSIONS - 2),
            embedding_model=provider.model,
            embedding_status=KnowledgeChunk.EmbeddingStatus.READY,
        )
        # Порядок кандидатов нарочно обратный: первым кусок ставит расстояние.
        candidates = [as_retrievable(chunk, document) for chunk in (far, near)]

        result = PgVectorDenseRetriever(provider=provider).search(
            "вопрос", candidates, limit=2
        )

        self.assertEqual(
            [chunk.chunk_id for chunk, _ in result], [str(near.pk), str(far.pk)]
        )


class PgvectorVersionTests(SimpleTestCase):
    def test_pgvector_version_is_compared_as_numbers(self):
        migration = importlib.import_module("curriculum.migrations.0018_chunk_embedding_halfvec")
        self.assertEqual(migration.pgvector_version("0.10.0"), (0, 10))
        self.assertLess(migration.pgvector_version("0.6.2"), (0, 7))
        self.assertGreaterEqual(migration.pgvector_version("0.7.0"), (0, 7))
