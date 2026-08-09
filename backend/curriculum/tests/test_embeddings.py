"""Эмбеддинги: провайдер, индексация, поиск.

Тесты идут на SQLite, где нет ни оператора `<=>`, ни HNSW. Поэтому здесь
проверяется всё, что от бэкенда не зависит: контракт провайдера, поведение
индексатора (переиспользование, потолок, изоляция упавшего батча) и выбор
ретривера. Работа самого pgvector — ответственность Postgres и проверяется на
живом сервере, а не здесь.
"""

from unittest import mock

from django.db import connection
from django.test import TestCase, override_settings

from curriculum.embeddings import (
    EmbeddingResult,
    NullEmbeddingProvider,
    OpenAICompatibleEmbeddingProvider,
    estimate_tokens,
    get_embedding_provider,
)
from curriculum.models import EMBEDDING_DIMENSIONS, Document, KnowledgeChunk
from curriculum.retrieval import InMemoryDenseRetriever, get_dense_retriever
from curriculum.services.embedding_index import (
    estimate_document_index,
    index_document_chunks,
)


class FakeEmbeddingProvider:
    """Детерминированный провайдер: вектор зависит только от текста."""

    name = "fake-embedding"
    dimensions = EMBEDDING_DIMENSIONS

    def __init__(self, *, model: str = "fake-model", fail: bool = False) -> None:
        self.model = model
        self.fail = fail
        self.calls: list[list[str]] = []

    def embed(self, texts):
        self.calls.append(list(texts))
        if self.fail:
            return EmbeddingResult(succeeded=False, error="boom")
        vectors = [
            [float(len(text) % 7)] + [0.0] * (EMBEDDING_DIMENSIONS - 1)
            for text in texts
        ]
        return EmbeddingResult(vectors=vectors, model=self.model, succeeded=True)


def make_document(email="a@b.c") -> Document:
    return Document.objects.create(user_email=email, title="Книга", page_count=10)


def make_chunk(document, text, *, content_hash=None) -> KnowledgeChunk:
    return KnowledgeChunk.objects.create(
        document=document,
        normalized_text=text,
        content_hash=content_hash or (text * 64)[:64],
    )


class EmbeddingProviderTests(TestCase):
    def test_ненастроенный_провайдер_не_бросает_и_не_платит(self):
        provider = NullEmbeddingProvider()
        result = provider.embed(["текст"])
        self.assertFalse(result.succeeded)
        self.assertEqual(result.error, "embedding_not_configured")
        self.assertEqual(result.vectors, [])

    @override_settings(CURRICULUM_EMBEDDINGS_ENABLED=True)
    def test_фабрика_требует_и_модель_и_базовый_url(self):
        # Умолчания у базового URL нет намеренно: у разных провайдеров разная
        # размерность (1536 / 1024 / 4096), а в схеме зафиксировано 1536.
        # Молчаливый выбор чужого сервиса = отказ на каждом батче.
        with mock.patch.dict("os.environ", {"EMBEDDING_MODEL": "any-model"}):
            with mock.patch("curriculum.embeddings.EMBEDDING_BASE_URL", ""):
                self.assertIsInstance(get_embedding_provider(), NullEmbeddingProvider)

    @override_settings(CURRICULUM_EMBEDDINGS_ENABLED=True)
    def test_забытый_ключ_даёт_skipped_а_не_поток_401(self):
        # Без ключа сервис ответит 401, батчи пометятся failed, и «не настроено»
        # превратится в «сломалось». Это разные вещи.
        with mock.patch.dict("os.environ", {"EMBEDDING_MODEL": "any-model"}):
            with mock.patch(
                "curriculum.embeddings.EMBEDDING_BASE_URL", "https://example.test/v1"
            ):
                with mock.patch("curriculum.embeddings.EMBEDDING_API_KEY", ""):
                    self.assertIsInstance(get_embedding_provider(), NullEmbeddingProvider)

    @override_settings(CURRICULUM_EMBEDDINGS_ENABLED=True)
    def test_фабрика_отдаёт_реальный_провайдер_при_полной_настройке(self):
        with mock.patch.dict("os.environ", {"EMBEDDING_MODEL": "any-model"}):
            with mock.patch(
                "curriculum.embeddings.EMBEDDING_BASE_URL", "https://example.test/v1"
            ):
                with mock.patch("curriculum.embeddings.EMBEDDING_API_KEY", "sk-test"):
                    provider = get_embedding_provider()
        self.assertIsInstance(provider, OpenAICompatibleEmbeddingProvider)
        self.assertEqual(provider.model, "any-model")

    def test_частичный_ответ_не_считается_успехом(self):
        # Сопоставить два вектора с тремя текстами невозможно, и «на глазок»
        # это делать нельзя: индекс испортится незаметно.
        result = EmbeddingResult(vectors=[[1.0], [2.0]], succeeded=True)
        self.assertFalse(result.matches(["a", "b", "c"]))
        self.assertTrue(result.matches(["a", "b"]))

    def test_оценка_токенов_не_нулевая_для_непустого_текста(self):
        self.assertGreaterEqual(estimate_tokens("а" * 400), 100)
        self.assertEqual(estimate_tokens(""), 1)


class EmbeddingKillSwitchTests(TestCase):
    def test_под_тест_раннером_провайдер_всегда_заглушка(self):
        # Настройки уже выставлены `config/settings.py` при запуске тестов:
        # прогон не должен ходить в сеть, даже когда `.env` полностью настроен.
        with mock.patch.dict(
            "os.environ", {"EMBEDDING_MODEL": "openai/text-embedding-3-small"}
        ):
            with mock.patch(
                "curriculum.embeddings.EMBEDDING_BASE_URL", "https://openrouter.ai/api/v1"
            ):
                with mock.patch("curriculum.embeddings.EMBEDDING_API_KEY", "sk-real"):
                    self.assertIsInstance(get_embedding_provider(), NullEmbeddingProvider)


class IndexDocumentChunksTests(TestCase):
    def test_считает_векторы_и_ставит_статус_ready(self):
        document = make_document()
        make_chunk(document, "первый")
        make_chunk(document, "второй")

        outcome = index_document_chunks(document, provider=FakeEmbeddingProvider())

        self.assertEqual(outcome.embedded, 2)
        self.assertEqual(outcome.failed, 0)
        rows = KnowledgeChunk.objects.filter(document=document)
        self.assertTrue(all(r.embedding_status == "ready" for r in rows))
        self.assertTrue(all(r.embedded_at is not None for r in rows))
        self.assertTrue(all(r.embedding_model == "fake-model" for r in rows))

    def test_ненастроенный_провайдер_даёт_skipped_а_не_failed(self):
        document = make_document()
        make_chunk(document, "текст")

        outcome = index_document_chunks(document, provider=NullEmbeddingProvider())

        self.assertEqual(outcome.skipped, 1)
        self.assertEqual(outcome.failed, 0)
        self.assertIn("embedding_not_configured", outcome.warnings)
        self.assertEqual(
            KnowledgeChunk.objects.get(document=document).embedding_status, "skipped"
        )

    def test_повторная_загрузка_той_же_книги_не_стоит_ничего(self):
        first = make_document()
        make_chunk(first, "общий текст", content_hash="h" * 64)
        provider = FakeEmbeddingProvider()
        index_document_chunks(first, provider=provider)
        self.assertEqual(len(provider.calls), 1)

        second = make_document()
        make_chunk(second, "общий текст", content_hash="h" * 64)
        outcome = index_document_chunks(second, provider=provider)

        self.assertEqual(outcome.reused, 1)
        self.assertEqual(outcome.embedded, 0)
        self.assertEqual(
            len(provider.calls), 1, "второй книге не потребовалось ни одного вызова"
        )

    def test_вектор_чужой_модели_не_переиспользуется(self):
        # Векторы разных моделей несопоставимы: смешать их в одном индексе
        # значит тихо сломать поиск.
        first = make_document()
        make_chunk(first, "общий текст", content_hash="h" * 64)
        index_document_chunks(first, provider=FakeEmbeddingProvider(model="model-a"))

        second = make_document()
        make_chunk(second, "общий текст", content_hash="h" * 64)
        other = FakeEmbeddingProvider(model="model-b")
        outcome = index_document_chunks(second, provider=other)

        self.assertEqual(outcome.reused, 0)
        self.assertEqual(outcome.embedded, 1)

    def test_упавший_батч_помечает_только_свои_фрагменты(self):
        document = make_document()
        make_chunk(document, "текст")
        outcome = index_document_chunks(
            document, provider=FakeEmbeddingProvider(fail=True)
        )

        self.assertEqual(outcome.failed, 1)
        self.assertEqual(outcome.embedded, 0)
        self.assertEqual(
            KnowledgeChunk.objects.get(document=document).embedding_status, "failed"
        )

    def test_индексация_никогда_не_бросает(self):
        document = make_document()
        make_chunk(document, "текст")

        class Exploding:
            name = "exploding"
            model = "boom"

            def embed(self, texts):
                raise RuntimeError("провайдер взорвался")

        outcome = index_document_chunks(document, provider=Exploding())
        self.assertIn("embedding_index_crashed", outcome.warnings)

    @override_settings(CURRICULUM_MAX_EMBEDDED_CHUNKS=2)
    def test_потолок_отсекает_лишнее_в_skipped(self):
        document = make_document()
        for index in range(5):
            make_chunk(document, f"текст {index}")

        outcome = index_document_chunks(document, provider=FakeEmbeddingProvider())

        self.assertEqual(outcome.embedded, 2)
        self.assertEqual(outcome.skipped, 3)
        self.assertTrue(any(w.startswith("embedding_capped_at_2") for w in outcome.warnings))

    def test_готовые_фрагменты_повторно_не_считаются(self):
        document = make_document()
        make_chunk(document, "текст")
        provider = FakeEmbeddingProvider()
        index_document_chunks(document, provider=provider)

        outcome = index_document_chunks(document, provider=provider)

        self.assertEqual(outcome.considered, 0)
        self.assertEqual(len(provider.calls), 1)


class EstimateTests(TestCase):
    def test_оценка_ничего_не_меняет_и_никуда_не_ходит(self):
        document = make_document()
        make_chunk(document, "а" * 400)
        make_chunk(document, "б" * 400)

        estimate = estimate_document_index(document, model="fake-model")

        self.assertEqual(estimate.chunks, 2)
        self.assertEqual(estimate.billable_chunks, 2)
        self.assertGreater(estimate.approx_tokens, 0)
        self.assertFalse(estimate.capped)
        self.assertTrue(
            all(
                row.embedding_status == "pending"
                for row in KnowledgeChunk.objects.filter(document=document)
            )
        )

    def test_уже_посчитанное_в_оценку_к_оплате_не_входит(self):
        first = make_document()
        make_chunk(first, "общий", content_hash="h" * 64)
        index_document_chunks(first, provider=FakeEmbeddingProvider())

        second = make_document()
        make_chunk(second, "общий", content_hash="h" * 64)
        estimate = estimate_document_index(second, model="fake-model")

        self.assertEqual(estimate.reusable, 1)
        self.assertEqual(estimate.billable_chunks, 0)


class DenseRetrieverSelectionTests(TestCase):
    def test_на_sqlite_остаётся_прежняя_заглушка(self):
        # Ровно поэтому `test_retrieval.py` не потребовал ни одной правки.
        self.assertEqual(connection.vendor, "sqlite")
        self.assertIsInstance(get_dense_retriever(), InMemoryDenseRetriever)


class SearchEndpointTests(TestCase):
    def test_поиск_требует_пользователя(self):
        response = self.client.post(
            "/api/curriculum/search/", {"query": "движение"}, content_type="application/json"
        )
        self.assertEqual(response.status_code, 401)

    def test_пустой_запрос_отклоняется(self):
        response = self.client.post(
            "/api/curriculum/search/",
            {"query": "   "},
            content_type="application/json",
            HTTP_X_USER_EMAIL="a@b.c",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "query_required")

    def test_ответ_не_содержит_векторов(self):
        document = make_document("a@b.c")
        chunk = make_chunk(document, "равномерное прямолинейное движение")
        index_document_chunks(document, provider=FakeEmbeddingProvider())

        response = self.client.post(
            "/api/curriculum/search/",
            {"query": "движение"},
            content_type="application/json",
            HTTP_X_USER_EMAIL="a@b.c",
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertNotIn("embedding", response.content.decode())
        self.assertTrue(body["results"])
        self.assertEqual(body["results"][0]["chunk_id"], str(chunk.pk))
        self.assertIn("citation", body["results"][0])

    def test_чужие_книги_не_ищутся(self):
        other = make_document("someone@else.com")
        make_chunk(other, "равномерное движение")

        response = self.client.post(
            "/api/curriculum/search/",
            {"query": "движение"},
            content_type="application/json",
            HTTP_X_USER_EMAIL="a@b.c",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["results"], [])

    def test_решения_задач_поиском_не_отдаются(self):
        document = make_document("a@b.c")
        KnowledgeChunk.objects.create(
            document=document,
            normalized_text="Решение задачи про движение",
            content_hash="s" * 64,
            chunk_type=KnowledgeChunk.ChunkType.SOLUTION,
            solution_visibility=KnowledgeChunk.SolutionVisibility.RESTRICTED,
        )

        response = self.client.post(
            "/api/curriculum/search/",
            {"query": "движение"},
            content_type="application/json",
            HTTP_X_USER_EMAIL="a@b.c",
        )

        self.assertEqual(response.json()["results"], [])
