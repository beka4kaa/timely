"""Эмбеддинги: провайдер, индексация, поиск.

Тесты идут на SQLite, где нет ни оператора `<=>`, ни HNSW. Поэтому здесь
проверяется всё, что от бэкенда не зависит: контракт провайдера, поведение
индексатора (переиспользование, потолок, изоляция упавшего батча) и выбор
ретривера. Работа самого pgvector — ответственность Postgres и проверяется на
живом сервере, а не здесь.
"""

from io import StringIO
from types import SimpleNamespace
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext

from ai_engine.models import AIUsageQuotaState
from ai_engine.usage import AIUsageLimitExceeded, usage_scope

from curriculum.embeddings import (
    EmbeddingResult,
    NullEmbeddingProvider,
    OpenAICompatibleEmbeddingProvider,
    estimate_tokens,
    get_embedding_provider,
)
from curriculum.models import EMBEDDING_DIMENSIONS, Document, KnowledgeChunk
from curriculum.retrieval import (
    InMemoryDenseRetriever,
    PgVectorDenseRetriever,
    RetrievableChunk,
    SimpleLexicalRetriever,
    get_dense_retriever,
    get_lexical_retriever,
)
from curriculum.services import embedding_index as embedding_index_service
from curriculum.services.embedding_index import (
    REUSE_BATCH_SIZE,
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
        document_id=document.pk,
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

    @override_settings(AI_USAGE_ENFORCE_LIMITS=True)
    @mock.patch("ai_engine.usage.reserve_usage_capacity")
    @mock.patch("openai.OpenAI")
    def test_quota_denial_is_not_retried_as_provider_failure(self, openai, reserve):
        reserve.side_effect = AIUsageLimitExceeded(
            window="five_hour",
            reset_at="2026-08-09T12:00:00Z",
        )
        provider = OpenAICompatibleEmbeddingProvider(
            model="model",
            base_url="https://example.test/v1",
            api_key="key",
        )

        with usage_scope(user_email="student@example.com"):
            with self.assertRaises(AIUsageLimitExceeded):
                provider.embed(["текст"])

        openai.return_value.embeddings.create.assert_not_called()

    @override_settings(
        AI_USAGE_ENFORCE_LIMITS=True,
        AI_PLAN_LIMITS={
            "free": {"context": 10000, "five_hour": 10000, "weekly": 10000}
        },
    )
    @mock.patch("openai.OpenAI")
    def test_batch_reservation_lives_through_usage_write(self, openai):
        openai.return_value.embeddings.create.return_value = SimpleNamespace(
            data=[
                SimpleNamespace(
                    index=0,
                    embedding=[0.0] * EMBEDDING_DIMENSIONS,
                )
            ]
        )
        observed = []

        def record(*args, **kwargs):
            state = AIUsageQuotaState.objects.get(user_email="student@example.com")
            observed.append(list(state.reservations.values()))

        provider = OpenAICompatibleEmbeddingProvider(
            model="model",
            base_url="https://example.test/v1",
            api_key="key",
        )
        with mock.patch("ai_engine.usage.record_model_usage", side_effect=record):
            with usage_scope(user_email="student@example.com"):
                result = provider.embed(["x"])

        self.assertTrue(result.succeeded)
        self.assertEqual(observed[0][0]["kind"], "capacity")
        state = AIUsageQuotaState.objects.get(user_email="student@example.com")
        self.assertEqual(state.reservations, {})


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
        rows = KnowledgeChunk.objects.filter(document_id=document.pk)
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
            KnowledgeChunk.objects.get(document_id=document.pk).embedding_status, "skipped"
        )

    @override_settings(CURRICULUM_MAX_EMBEDDED_CHUNKS=1)
    def test_ненастроенный_провайдер_считает_и_потолок_и_выбранные_строки(self):
        document = make_document()
        for index in range(3):
            make_chunk(document, f"текст {index}")

        outcome = index_document_chunks(document, provider=NullEmbeddingProvider())

        self.assertEqual(outcome.skipped, 3)

    @override_settings(CURRICULUM_MAX_EMBEDDED_CHUNKS=1)
    def test_force_reindex_не_стирает_ready_векторы_за_потолком(self):
        document = make_document()
        first = make_chunk(document, "первый")
        second = make_chunk(document, "второй")
        first.page_start = 1
        second.page_start = 2
        first.save(update_fields=["page_start"])
        second.save(update_fields=["page_start"])
        old_vector = [1.0] + [0.0] * (EMBEDDING_DIMENSIONS - 1)
        KnowledgeChunk.objects.filter(pk__in=[first.pk, second.pk]).update(
            embedding=old_vector,
            embedding_model="old-model",
            embedding_status=KnowledgeChunk.EmbeddingStatus.READY,
        )

        outcome = index_document_chunks(
            document,
            provider=FakeEmbeddingProvider(model="new-model"),
            force_reindex=True,
        )

        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(outcome.embedded, 1)
        self.assertEqual(outcome.skipped, 1)
        self.assertEqual(first.embedding_model, "new-model")
        self.assertEqual(second.embedding_status, KnowledgeChunk.EmbeddingStatus.READY)
        self.assertEqual(second.embedding_model, "old-model")
        self.assertIsNotNone(second.embedding)

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

    def test_reuse_читает_векторы_ограниченными_порциями(self):
        source = make_document()
        make_chunk(source, "общий", content_hash="r" * 64)
        index_document_chunks(source, provider=FakeEmbeddingProvider())

        target = make_document()
        for index in range(REUSE_BATCH_SIZE + 1):
            make_chunk(target, f"копия {index}", content_hash="r" * 64)
        provider = FakeEmbeddingProvider()
        with mock.patch.object(
            embedding_index_service,
            "_reuse_map",
            wraps=embedding_index_service._reuse_map,
        ) as reuse:
            outcome = index_document_chunks(target, provider=provider)

        self.assertEqual(outcome.reused, REUSE_BATCH_SIZE + 1)
        self.assertEqual(outcome.embedded, 0)
        self.assertEqual(provider.calls, [])
        self.assertEqual(
            [len(call.args[0]) for call in reuse.call_args_list],
            [REUSE_BATCH_SIZE, 1],
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
            KnowledgeChunk.objects.get(document_id=document.pk).embedding_status, "failed"
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

    def test_индексация_не_прячет_quota_denial_как_warning(self):
        document = make_document()
        make_chunk(document, "текст")

        class Denied:
            name = "denied"
            model = "denied"

            def embed(self, texts):
                raise AIUsageLimitExceeded(
                    window="five_hour",
                    reset_at="2026-08-09T12:00:00Z",
                )

        with self.assertRaises(AIUsageLimitExceeded):
            index_document_chunks(document, provider=Denied())

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

    def test_старый_запуск_не_индексирует_фрагменты_нового_поколения(self):
        document = make_document()
        old_chunk = make_chunk(document, "старое поколение")

        class ReplacingProvider(FakeEmbeddingProvider):
            replacement: KnowledgeChunk | None = None

            def embed(self, texts):
                old_chunk.delete()
                self.replacement = make_chunk(document, "новое поколение")
                return super().embed(texts)

        provider = ReplacingProvider()
        index_document_chunks(
            document,
            provider=provider,
            chunk_ids=(old_chunk.pk,),
        )

        self.assertIsNotNone(provider.replacement)
        replacement = KnowledgeChunk.objects.get(document_id=document.pk)
        self.assertEqual(
            replacement.embedding_status,
            KnowledgeChunk.EmbeddingStatus.PENDING,
        )
        self.assertIsNone(replacement.embedding)


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
                for row in KnowledgeChunk.objects.filter(document_id=document.pk)
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

    def test_ready_другой_модели_снова_попадает_в_оценку(self):
        document = make_document()
        make_chunk(document, "общий", content_hash="m" * 64)
        index_document_chunks(document, provider=FakeEmbeddingProvider(model="old"))

        estimate = estimate_document_index(document, model="new")

        self.assertEqual(estimate.chunks, 1)
        self.assertEqual(estimate.billable_chunks, 1)

    def test_оценка_использует_сохранённый_token_count(self):
        document = make_document()
        chunk = make_chunk(document, "короткий текст")
        chunk.token_count = 777
        chunk.save(update_fields=["token_count"])

        estimate = estimate_document_index(document, model="new")

        self.assertEqual(estimate.approx_tokens, 777)

    def test_оценка_не_выбирает_массивы_embedding(self):
        source = make_document()
        make_chunk(source, "общий", content_hash="v" * 64)
        index_document_chunks(source, provider=FakeEmbeddingProvider())
        target = make_document()
        make_chunk(target, "общий", content_hash="v" * 64)

        with CaptureQueriesContext(connection) as captured:
            estimate = estimate_document_index(target, model="fake-model")

        self.assertEqual(estimate.reusable, 1)
        vector_column = '"curriculum_knowledgechunk"."embedding"'
        for query in captured.captured_queries:
            select_clause = query["sql"].split(" FROM ", 1)[0]
            self.assertNotIn(vector_column, select_clause)


class EmbeddingCommandSafetyTests(TestCase):
    def setUp(self):
        self.document = make_document()
        make_chunk(self.document, "текст для индекса")

    def test_без_execute_всегда_dry_run(self):
        output = StringIO()
        with mock.patch(
            "curriculum.management.commands.curriculum_embed.get_embedding_provider",
            return_value=FakeEmbeddingProvider(),
        ), mock.patch(
            "curriculum.management.commands.curriculum_embed.index_document_chunks"
        ) as index:
            call_command(
                "curriculum_embed", document=str(self.document.pk), stdout=output
            )

        index.assert_not_called()
        self.assertIn("dry-run", output.getvalue())

    def test_execute_уважает_жёсткий_бюджет(self):
        chunk = KnowledgeChunk.objects.get(document_id=self.document.pk)
        chunk.token_count = 1_000_000
        chunk.save(update_fields=["token_count"])
        with mock.patch(
            "curriculum.management.commands.curriculum_embed.get_embedding_provider",
            return_value=FakeEmbeddingProvider(),
        ):
            with self.assertRaises(CommandError):
                call_command(
                    "curriculum_embed",
                    document=str(self.document.pk),
                    execute=True,
                    max_usd=0.001,
                    stdout=StringIO(),
                )

    def test_execute_после_оценки_запускает_ровно_документ(self):
        outcome = SimpleNamespace(
            embedded=1, reused=0, skipped=0, failed=0, warnings=[]
        )
        with mock.patch(
            "curriculum.management.commands.curriculum_embed.get_embedding_provider",
            return_value=FakeEmbeddingProvider(),
        ), mock.patch(
            "curriculum.management.commands.curriculum_embed.index_document_chunks",
            return_value=outcome,
        ) as index:
            call_command(
                "curriculum_embed",
                document=str(self.document.pk),
                execute=True,
                max_usd=1.0,
                stdout=StringIO(),
            )

        self.assertEqual(index.call_args.args[0], self.document)

    def test_reindex_all_не_очищает_строки_до_вызова_провайдера(self):
        chunk = KnowledgeChunk.objects.get(document_id=self.document.pk)
        chunk.embedding = [1.0] + [0.0] * (EMBEDDING_DIMENSIONS - 1)
        chunk.embedding_model = "old-model"
        chunk.embedding_status = KnowledgeChunk.EmbeddingStatus.READY
        chunk.save(
            update_fields=["embedding", "embedding_model", "embedding_status"]
        )
        outcome = SimpleNamespace(
            embedded=1, reused=0, skipped=0, failed=0, warnings=[]
        )
        with mock.patch(
            "curriculum.management.commands.curriculum_embed.get_embedding_provider",
            return_value=FakeEmbeddingProvider(),
        ), mock.patch(
            "curriculum.management.commands.curriculum_embed.index_document_chunks",
            return_value=outcome,
        ) as index:
            call_command(
                "curriculum_embed",
                document=str(self.document.pk),
                execute=True,
                reindex_all=True,
                max_usd=1.0,
                stdout=StringIO(),
            )

        chunk.refresh_from_db()
        self.assertEqual(chunk.embedding_status, KnowledgeChunk.EmbeddingStatus.READY)
        self.assertEqual(chunk.embedding_model, "old-model")
        self.assertIsNotNone(chunk.embedding)
        self.assertTrue(index.call_args.kwargs["force_reindex"])

    def test_budget_arguments_must_be_positive_and_finite(self):
        for option in ("max_usd", "usd_per_million_tokens"):
            for value in (0.0, -1.0, float("nan"), float("inf")):
                with self.subTest(option=option, value=value):
                    with self.assertRaises(CommandError):
                        call_command(
                            "curriculum_embed",
                            document=str(self.document.pk),
                            stdout=StringIO(),
                            **{option: value},
                        )


class DenseRetrieverSelectionTests(TestCase):
    def test_на_sqlite_остаётся_прежняя_заглушка(self):
        # Ровно поэтому `test_retrieval.py` не потребовал ни одной правки.
        self.assertEqual(connection.vendor, "sqlite")
        self.assertIsInstance(get_dense_retriever(), InMemoryDenseRetriever)

    def test_на_sqlite_лексический_поиск_остаётся_детерминированным(self):
        self.assertIsInstance(get_lexical_retriever(), SimpleLexicalRetriever)

    def test_dense_поиск_не_смешивает_векторы_разных_моделей(self):
        provider = FakeEmbeddingProvider(model="current-model")
        candidate = RetrievableChunk(
            chunk_id="11111111-1111-1111-1111-111111111111",
            document_id="d1",
            owner_email="a@b.c",
            chunk_type="prose",
            text="закон Ньютона",
        )
        queryset = mock.MagicMock()
        queryset.exclude.return_value.annotate.return_value.order_by.return_value.values_list.return_value.__getitem__.return_value = []

        with mock.patch.object(KnowledgeChunk.objects, "filter", return_value=queryset) as filtered:
            PgVectorDenseRetriever(provider=provider).search(
                "закон", [candidate], limit=5
            )

        self.assertEqual(filtered.call_args.kwargs["embedding_model"], "current-model")

    def test_dense_поиск_использует_name_если_protocol_не_даёт_model(self):
        class ResultNamedProvider:
            name = "protocol-provider"
            dimensions = EMBEDDING_DIMENSIONS

            def embed(self, texts):
                return EmbeddingResult(
                    vectors=[[0.0] * EMBEDDING_DIMENSIONS],
                    model="canonical-model",
                    succeeded=True,
                )

        candidate = RetrievableChunk(
            chunk_id="22222222-2222-2222-2222-222222222222",
            document_id="d1",
            owner_email="a@b.c",
            chunk_type="prose",
            text="закон Ньютона",
        )
        queryset = mock.MagicMock()
        queryset.exclude.return_value.annotate.return_value.order_by.return_value.values_list.return_value.__getitem__.return_value = []
        with mock.patch.object(
            KnowledgeChunk.objects, "filter", return_value=queryset
        ) as filtered:
            PgVectorDenseRetriever(provider=ResultNamedProvider()).search(
                "закон", [candidate], limit=5
            )

        self.assertEqual(filtered.call_args.kwargs["embedding_model"], "protocol-provider")


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
            document_id=document.pk,
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
