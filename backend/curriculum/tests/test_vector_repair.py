"""Недостающие векторы снова в очередь, не чаще раза в 10 минут (решение 11).

Книга остаётся готовой, даже если часть векторов не записалась: по словам куски
находятся и без них. Когда поиск задевает такую книгу, куски без векторов
снова уходят в очередь, но не чаще раза в 10 минут на книгу, а лежащий брокер
поиск не ломает.

Воркер один (`--concurrency=1`), поэтому починка его не держит: уступает
книге в очереди, кончается на первой упавшей пачке, а один запуск длится не
дольше ~120 с. Остаток книги уходит продолжением в конец очереди.
"""

import tempfile
from datetime import timedelta
from unittest import mock, skipUnless

from celery.exceptions import SoftTimeLimitExceeded
from django.core.cache import cache
from django.db import DatabaseError, connection, transaction
from django.test import SimpleTestCase, TestCase, TransactionTestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from ai_engine.usage import current_usage_context
from curriculum import storage as storage_module
from curriculum.embeddings import NullEmbeddingProvider, OpenAICompatibleEmbeddingProvider
from curriculum.models import Document, DocumentFile, IngestionJob, KnowledgeChunk
from curriculum.ocr import NullOcrProvider
from curriculum.services import dispatch
from curriculum.services import embedding_index as embedding_index_service
from curriculum.services.embedding_index import (
    VECTOR_REPAIR_INTERVAL_SECONDS,
    request_vector_repair,
)
from curriculum.services.ingestion import ingest_document
from curriculum.services.search import SearchRequest, search_chunks
from curriculum.tasks import embed_missing_chunks_task, ingest_document_task
from curriculum.tests.pdf_fixtures import textbook_pdf
from curriculum.tests.test_embeddings import (
    FakeEmbeddingProvider,
    make_chunk,
    make_document,
)
from curriculum.tests.test_vector_reads import chunk_selects_with_vectors

EMAIL = "student@example.com"
OTHER_EMAIL = "other@example.com"
Status = KnowledgeChunk.EmbeddingStatus


def repair_key(document) -> str:
    return f"curriculum:vector-repair:{document.pk}"


class FakeClock:
    """Часы задачи починки: идут, только когда их двигают.

    Сам объект — `time.monotonic` задачи, а `wall` — `timezone.now` для тестов,
    где от времени зависит и `dispatch.is_stale`.
    """

    def __init__(self) -> None:
        self.now = 1000.0
        self.wall = timezone.now()

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds
        self.wall += timedelta(seconds=seconds)


class SlowProvider(FakeEmbeddingProvider):
    """Каждая пачка занимает `seconds` по часам `clock`."""

    def __init__(self, clock: FakeClock, *, seconds: float) -> None:
        super().__init__()
        self.clock = clock
        self.seconds = seconds

    def embed(self, texts):
        self.clock.advance(self.seconds)
        return super().embed(texts)


class _RepairHelpers:
    def setUp(self):
        super().setUp()
        # Публикация починки наблюдается, а не выполняется: брокера в тестах нет.
        self.publish = self._patch("curriculum.tasks.embed_missing_chunks_task.apply_async")

    def _patch(self, target, **kwargs):
        patcher = mock.patch(target, **kwargs)
        patched = patcher.start()
        self.addCleanup(patcher.stop)
        return patched

    def _use_provider(self, provider):
        # Это имя читают и `request_vector_repair`, и `index_document_chunks`
        # в задаче починки (R-U6-1).
        self._patch(
            "curriculum.services.embedding_index.get_embedding_provider",
            return_value=provider,
        )
        return provider

    def _ready_book(self, *statuses: str, text: str = "сила тяжести") -> Document:
        # Со строчной буквы: у кластера Postgres с локалью C русская морфология
        # не опускает регистр кириллицы, и «Сила» не нашлась бы по «сила».
        document = make_document(EMAIL)
        Document.objects.filter(pk=document.pk).update(
            ingestion_status=Document.Status.READY
        )
        document.refresh_from_db()
        for number, status in enumerate(statuses, start=1):
            chunk = make_chunk(document, f"{text}, часть {number}")
            KnowledgeChunk.objects.filter(pk=chunk.pk).update(embedding_status=status)
        return document

    def _statuses(self, document) -> list[str]:
        return list(
            KnowledgeChunk.objects.filter(document_id=document.pk)
            .order_by("normalized_text")
            .values_list("embedding_status", flat=True)
        )

    def _search(self, query: str = "сила"):
        return search_chunks(
            SearchRequest(
                user_email=EMAIL,
                query=query,
                document_ids=[],
                limit=5,
                mode="explain",
            )
        )

    def _book_with_file(self, title: str) -> Document:
        """Книга с настоящим файлом, которую воркер может обработать."""
        storage_module.set_storage(storage_module.LocalFileStorage(tempfile.mkdtemp()))
        self.addCleanup(storage_module.set_storage, None)
        document = Document.objects.create(user_email=EMAIL, title=title)
        pdf = textbook_pdf()
        key = storage_module.build_storage_key(
            user_email=EMAIL, document_id=str(document.pk), filename="book.pdf"
        )
        storage_module.get_storage().save(key, pdf)
        DocumentFile.objects.create(
            document=document,
            original_filename="book.pdf",
            sanitized_filename="book.pdf",
            storage_key=key,
            mime_type="application/pdf",
            byte_size=len(pdf),
            content_hash=storage_module.content_hash(pdf),
        )
        return document


class _RepairBase(_RepairHelpers, TestCase):
    pass


@override_settings(CURRICULUM_INGEST_MODE="celery", CELERY_BROKER_URL="redis://stub")
class AutocommitRepairRequestTests(_RepairHelpers, TransactionTestCase):
    """Поиск вне транзакции: починка не открывает своей.

    `TestCase` держит каждый тест в транзакции, поэтому здесь
    `TransactionTestCase`. В autocommit ключ кэша фиксируется до публикации.
    Транзакция вокруг починки держала бы его незафиксированным, пока
    публикация ждёт брокер, и второй вопрос по той же книге ждал бы её.
    """

    def test_outside_a_transaction_the_repair_request_opens_none(self):
        self._use_provider(FakeEmbeddingProvider())
        document = self._ready_book(Status.FAILED)
        # Таблицу кэша `TransactionTestCase` не чистит: ключ убирает тест.
        self.addCleanup(cache.delete, repair_key(document))
        in_a_transaction = []
        self.publish.side_effect = lambda *args, **kwargs: in_a_transaction.append(
            transaction.get_connection().in_atomic_block
        )
        self.assertFalse(transaction.get_connection().in_atomic_block)

        bundle = self._search()

        self.assertTrue(bundle.results)
        self.assertEqual(in_a_transaction, [False])


@override_settings(CURRICULUM_INGEST_MODE="celery", CELERY_BROKER_URL="redis://stub")
class SearchRequestsRepairTests(_RepairBase):
    def setUp(self):
        super().setUp()
        self.provider = self._use_provider(FakeEmbeddingProvider())

    def test_search_requeues_missing_vectors_once_per_ten_minutes(self):
        document = self._ready_book(Status.FAILED)

        with CaptureQueriesContext(connection) as ctx:
            self._search()
        # Починка читает только id и статусы: векторы в поиск не возвращаются.
        self.assertEqual(chunk_selects_with_vectors(ctx.captured_queries), [])
        self._search()

        self.assertEqual(self.publish.call_count, 1)
        self.assertEqual(
            self.publish.call_args.kwargs,
            {"args": [str(document.pk)], "retry": False},
        )

        cache.delete(f"curriculum:vector-repair:{document.pk}")
        self._search()
        self.assertEqual(self.publish.call_count, 2)

    def test_the_key_lives_ten_minutes(self):
        document = self._ready_book(Status.PENDING)

        with mock.patch(
            "curriculum.services.embedding_index.cache.add", wraps=cache.add
        ) as add:
            self.assertEqual(request_vector_repair([str(document.pk)]), [str(document.pk)])

        add.assert_called_once_with(repair_key(document), "1", timeout=600)
        self.assertEqual(VECTOR_REPAIR_INTERVAL_SECONDS, 600)

    def test_skipped_chunks_are_not_requeued(self):
        # SKIPPED — потолок или выключенный провайдер: их забирает
        # `curriculum_embed`, а не поиск.
        document = self._ready_book(Status.SKIPPED, Status.READY)

        self._search()

        self.publish.assert_not_called()
        self.assertIsNone(cache.get(repair_key(document)))

    def test_a_book_still_in_processing_is_not_requeued(self):
        # Куски без векторов у книги в обработке пишет сама обработка.
        document = self._ready_book(Status.PENDING)
        Document.objects.filter(pk=document.pk).update(
            ingestion_status=Document.Status.INDEXING
        )

        self._search()

        self.publish.assert_not_called()
        self.assertIsNone(cache.get(repair_key(document)))

    def test_broker_failure_does_not_break_search(self):
        # Review Focus 2: ученик много раз спрашивает, а брокер лежит.
        self.publish.side_effect = ConnectionError("redis down")
        document = self._ready_book(Status.FAILED)

        with self.assertLogs("curriculum.services.embedding_index", "WARNING") as logs:
            bundle = self._search()

        self.assertTrue(bundle.results)
        self.assertIn("redis down", "\n".join(logs.output))
        # Ключ живёт свои 10 минут: следующий вопрос брокер не ждёт.
        again = self._search()
        self.assertTrue(again.results)
        self.assertEqual(self.publish.call_count, 1)
        self.assertEqual(cache.get(repair_key(document)), "1")

    def test_any_repair_error_leaves_search_working(self):
        # Не только брокер: кэш в базе тоже может отказать.
        self._ready_book(Status.FAILED)

        with mock.patch(
            "curriculum.services.embedding_index.cache.add",
            side_effect=DatabaseError("no such table: cache_table"),
        ), self.assertLogs("curriculum.services.search", "WARNING") as logs:
            bundle = self._search()

        self.assertTrue(bundle.results)
        self.assertIn("cache_table", "\n".join(logs.output))
        self.publish.assert_not_called()

    def test_the_repair_query_returns_one_row_per_book(self):
        document = self._ready_book()
        KnowledgeChunk.objects.bulk_create(
            [
                KnowledgeChunk(
                    document_id=document.pk,
                    normalized_text=f"сила, часть {number}",
                    content_hash=f"{number:064d}",
                    page_start=number,
                    embedding_status=Status.FAILED,
                )
                for number in range(30)
            ]
        )

        rows = list(embedding_index_service._books_missing_vectors([str(document.pk)]))

        # Строка на книгу, а не на кусок: каждый вопрос по книге ходит сюда.
        self.assertEqual(rows, [document.pk])

    def test_a_held_key_costs_no_insert(self):
        # Иначе каждый вопрос в течение 10 минут ронял бы INSERT в кэш, а
        # Postgres писал бы ошибку дубликата ключа в свой лог.
        document = self._ready_book(Status.FAILED)
        self.assertTrue(cache.add(repair_key(document), "1", timeout=600))

        with CaptureQueriesContext(connection) as ctx:
            self.assertEqual(request_vector_repair([str(document.pk)]), [])

        inserts = [
            query["sql"]
            for query in ctx.captured_queries
            if query["sql"].lstrip().upper().startswith("INSERT")
        ]
        self.assertEqual(inserts, [])
        self.publish.assert_not_called()

    def test_after_a_broker_failure_the_other_books_wait(self):
        # Попытка публикации ждёт соединения с брокером: на лежащем брокере
        # вопрос по библиотеке не должен ждать её по разу на каждую книгу.
        self.publish.side_effect = ConnectionError("redis down")
        first = self._ready_book(Status.FAILED)
        second = self._ready_book(Status.FAILED, text="закон ома")

        with self.assertLogs("curriculum.services.embedding_index", "WARNING") as logs:
            queued = request_vector_repair([str(first.pk), str(second.pk)])

        self.assertEqual(queued, [])
        self.assertEqual(self.publish.call_count, 1)
        self.assertEqual(len(logs.records), 1)
        # Взятый ключ живёт свои 10 минут, вторую книгу попробует следующий вопрос.
        self.assertEqual(cache.get(repair_key(first)), "1")
        self.assertIsNone(cache.get(repair_key(second)))

    @skipUnless(
        connection.vendor == "postgresql",
        "SQLite не обрывает транзакцию на ошибке запроса",
    )
    def test_a_cache_sql_error_leaves_the_callers_transaction_usable(self):
        # Кэш — таблица в той же базе. Ошибка её запроса на Postgres обрывает
        # всю транзакцию, и поиск, вызванный внутри `atomic()`, упал бы на
        # следующем же запросе.
        self._ready_book(Status.FAILED)
        with connection.cursor() as cursor:
            cursor.execute('ALTER TABLE "cache_table" RENAME TO "cache_table_away"')

        with transaction.atomic():
            with self.assertLogs("curriculum.services.search", "WARNING") as logs:
                bundle = self._search()
            self.assertTrue(bundle.results)
            self.assertTrue(Document.objects.filter(user_email=EMAIL).exists())

        self.assertIn("cache_table", "\n".join(logs.output))
        self.publish.assert_not_called()

    @override_settings(CURRICULUM_INGEST_MODE="celery", CELERY_BROKER_URL="")
    def test_no_broker_url_means_no_repair(self):
        document = self._ready_book(Status.FAILED)

        self._search()

        self.publish.assert_not_called()
        self.assertIsNone(cache.get(f"curriculum:vector-repair:{document.pk}"))

    def test_repair_needs_celery_mode_and_a_provider(self):
        document = self._ready_book(Status.FAILED)

        with self.subTest("inline"), override_settings(CURRICULUM_INGEST_MODE="inline"):
            self.assertEqual(request_vector_repair([str(document.pk)]), [])
        with self.subTest("no provider"), mock.patch(
            "curriculum.services.embedding_index.get_embedding_provider",
            return_value=NullEmbeddingProvider(),
        ):
            self.assertEqual(request_vector_repair([str(document.pk)]), [])

        self.publish.assert_not_called()
        self.assertIsNone(cache.get(repair_key(document)))


class ContextRecordingProvider(FakeEmbeddingProvider):
    """Запоминает, на чей счёт и под какой меткой идёт расход."""

    def __init__(self) -> None:
        super().__init__()
        self.contexts: list[tuple[str, str]] = []

    def embed(self, texts):
        context = current_usage_context()
        self.contexts.append((context.user_email, context.feature))
        return super().embed(texts)


@override_settings(
    CURRICULUM_INGEST_MODE="celery",
    CELERY_BROKER_URL="redis://stub",
    CURRICULUM_INGEST_STALE_AFTER_SECONDS=300,
)
class RepairTaskTests(_RepairBase):
    def _repair(self, document) -> None:
        embed_missing_chunks_task.apply(args=[str(document.pk)]).get()

    def test_repair_task_embeds_only_pending_and_failed(self):
        provider = self._use_provider(ContextRecordingProvider())
        document = self._ready_book()
        pending = make_chunk(document, "Ждёт вектора")
        failed = make_chunk(document, "Вектор не записался")
        skipped = make_chunk(document, "За потолком")
        old_model = make_chunk(document, "Посчитан старой моделью")
        KnowledgeChunk.objects.filter(pk=failed.pk).update(embedding_status=Status.FAILED)
        KnowledgeChunk.objects.filter(pk=skipped.pk).update(embedding_status=Status.SKIPPED)
        KnowledgeChunk.objects.filter(pk=old_model.pk).update(
            embedding_status=Status.READY, embedding_model="old-model"
        )

        self._repair(document)

        statuses = dict(
            KnowledgeChunk.objects.filter(document_id=document.pk).values_list(
                "pk", "embedding_status"
            )
        )
        self.assertEqual(statuses[pending.pk], Status.READY)
        self.assertEqual(statuses[failed.pk], Status.READY)
        self.assertEqual(statuses[skipped.pk], Status.SKIPPED)
        # READY чужой модели — тоже не дело починки: только PENDING и FAILED.
        self.assertEqual(statuses[old_model.pk], Status.READY)
        old_model.refresh_from_db()
        self.assertEqual(old_model.embedding_model, "old-model")
        self.assertEqual(
            sorted(text for call in provider.calls for text in call),
            ["Вектор не записался", "Ждёт вектора"],
        )
        self.assertEqual(provider.contexts, [(EMAIL, "curriculum_embedding")])
        # Всё дописано: продолжать нечего.
        self.publish.assert_not_called()

    def test_repair_stops_at_the_first_failed_batch(self):
        provider = self._use_provider(FakeEmbeddingProvider(fail=True))
        document = self._ready_book(Status.FAILED, Status.FAILED, Status.FAILED)

        with mock.patch("curriculum.services.embedding_index.EMBEDDING_BATCH_SIZE", 1):
            self._repair(document)

        self.assertEqual(len(provider.calls), 1)
        self.assertEqual(self._statuses(document), [Status.FAILED] * 3)
        # Провайдер болеет: остаток заберёт следующая починка, не раньше чем
        # через 10 минут.
        self.publish.assert_not_called()

    def test_a_failed_batch_after_some_work_does_not_continue(self):
        class FailsSecond(FakeEmbeddingProvider):
            def embed(self, texts):
                self.fail = bool(self.calls)
                return super().embed(texts)

        provider = self._use_provider(FailsSecond())
        document = self._ready_book(Status.FAILED, Status.FAILED, Status.FAILED)

        with mock.patch("curriculum.services.embedding_index.EMBEDDING_BATCH_SIZE", 1):
            self._repair(document)

        self.assertEqual(len(provider.calls), 2)
        self.assertEqual(
            sorted(self._statuses(document)),
            [Status.FAILED, Status.FAILED, Status.READY],
        )
        # Записанное не делает продолжение законным: провайдер болеет, остаток
        # ждёт следующую починку.
        self.publish.assert_not_called()

    @override_settings(CURRICULUM_INGEST_STALE_AFTER_SECONDS=300)
    def test_repair_gives_way_to_a_queued_book(self):
        provider = self._use_provider(FakeEmbeddingProvider())
        document = self._ready_book(Status.FAILED)
        other = Document.objects.create(user_email=OTHER_EMAIL, title="Механика")
        job = IngestionJob.objects.create(
            document=other,
            user_email=OTHER_EMAIL,
            status=Document.Status.QUEUED,
            celery_task_id="waiting",
        )

        self._repair(document)

        self.assertEqual(provider.calls, [])
        self.assertEqual(self._statuses(document), [Status.FAILED])
        # Запуск уступил воркер, ничего не записав: продолжение не нужно, иначе
        # два сообщения гоняли бы друг друга, пока джоб в очереди свежий.
        self.publish.assert_not_called()

        # Джоб, которого `is_stale` уже не прикрывает (потерянное сообщение),
        # починку не держит.
        IngestionJob.objects.filter(pk=job.pk).update(
            updated_at=timezone.now() - timedelta(hours=1)
        )
        self._repair(document)

        self.assertEqual(self._statuses(document), [Status.READY])

    def test_a_queued_job_without_a_task_token_does_not_hold_the_repair(self):
        # Сообщение такого джоба в брокер не уходило: воркер до него не дойдёт.
        provider = self._use_provider(FakeEmbeddingProvider())
        document = self._ready_book(Status.FAILED)
        other = Document.objects.create(user_email=OTHER_EMAIL, title="Механика")
        IngestionJob.objects.create(
            document=other, user_email=OTHER_EMAIL, status=Document.Status.QUEUED
        )

        self._repair(document)

        self.assertEqual(len(provider.calls), 1)
        self.assertEqual(self._statuses(document), [Status.READY])

    def test_stacked_repairs_give_way_to_a_shielded_book(self):
        # Сценарий проверки: долгая книга только что кончилась, книга за ней
        # уже прождала дольше порога, а между ними в очереди три починки. Щит
        # от законченной книги держится 300 с, три запуска по 120 с его
        # пережили бы. Первая же починка уступает книге, и та не зависает.
        clock = FakeClock()
        self._patch("curriculum.tasks.monotonic", new=clock)
        self._patch("django.utils.timezone.now", new=lambda: clock.wall)
        provider = self._use_provider(SlowProvider(clock, seconds=30))
        self._patch("curriculum.services.embedding_index.EMBEDDING_BATCH_SIZE", new=1)
        finished = Document.objects.create(user_email=OTHER_EMAIL, title="Долгая книга")
        finished_job = IngestionJob.objects.create(
            document=finished, user_email=OTHER_EMAIL, status=Document.Status.READY
        )
        IngestionJob.objects.filter(pk=finished_job.pk).update(finished_at=clock.wall)
        waiting = Document.objects.create(user_email=OTHER_EMAIL, title="Механика")
        job = IngestionJob.objects.create(
            document=waiting,
            user_email=OTHER_EMAIL,
            status=Document.Status.QUEUED,
            celery_task_id="waiting",
        )
        IngestionJob.objects.filter(pk=job.pk).update(
            updated_at=clock.wall - timedelta(seconds=400)
        )
        # Тексты у книг разные, иначе векторы переиспользуются даром.
        books = [
            self._ready_book(*[Status.FAILED] * 8, text=f"сила, книга {number}")
            for number in range(3)
        ]

        trace = []
        for book in books:
            self._repair(book)
            job.refresh_from_db()
            trace.append((len(provider.calls), dispatch.is_stale(job)))

        self.assertEqual(trace, [(0, False)] * 3)
        self.publish.assert_not_called()

    @override_settings(CURRICULUM_INGEST_STALE_AFTER_SECONDS=100)
    def test_a_shorter_stale_threshold_shortens_the_run(self):
        # Граница запуска — min(120 с, 0.4 порога): при пороге 100 с это 40 с.
        clock = FakeClock()
        self._patch("curriculum.tasks.monotonic", new=clock)
        provider = self._use_provider(SlowProvider(clock, seconds=10))
        document = self._ready_book(*[Status.FAILED] * 6)

        with mock.patch("curriculum.services.embedding_index.EMBEDDING_BATCH_SIZE", 1):
            self._repair(document)

        # После четвёртой пачки 40 + 10 > 40: дальше продолжение.
        self.assertEqual(len(provider.calls), 4)
        self.assertEqual(self._statuses(document).count(Status.READY), 4)
        self.assertEqual(self.publish.call_count, 1)

    def test_a_book_deleted_or_requeued_mid_run_stops_the_run(self):
        for change in ("deleted", "requeued"):
            with self.subTest(change):
                document = self._ready_book(*[Status.FAILED] * 3)

                class ChangesTheBook(FakeEmbeddingProvider):
                    def embed(self, texts):
                        if not self.calls:
                            books = Document.objects.filter(pk=document.pk)
                            if change == "deleted":
                                books.delete()
                            else:
                                books.update(ingestion_status=Document.Status.QUEUED)
                        return super().embed(texts)

                provider = ChangesTheBook()
                with mock.patch(
                    "curriculum.services.embedding_index.get_embedding_provider",
                    return_value=provider,
                ), mock.patch(
                    "curriculum.services.embedding_index.EMBEDDING_BATCH_SIZE", 1
                ):
                    embed_missing_chunks_task.apply(args=[str(document.pk)]).get()

                # Векторы чужим или заменяемым кускам больше не оплачиваются.
                self.assertEqual(len(provider.calls), 1)

        self.publish.assert_not_called()

    def test_a_repair_that_gave_way_after_some_work_continues_behind_the_book(self):
        class UploadDuringRepair(FakeEmbeddingProvider):
            """Пока идёт первая пачка, ученик загружает другую книгу."""

            def embed(self, texts):
                if not self.calls:
                    other = Document.objects.create(user_email=OTHER_EMAIL, title="Механика")
                    IngestionJob.objects.create(
                        document=other,
                        user_email=OTHER_EMAIL,
                        status=Document.Status.QUEUED,
                        celery_task_id="uploaded",
                    )
                return super().embed(texts)

        provider = self._use_provider(UploadDuringRepair())
        document = self._ready_book(Status.FAILED, Status.FAILED, Status.FAILED)

        with mock.patch("curriculum.services.embedding_index.EMBEDDING_BATCH_SIZE", 1):
            self._repair(document)

        # Перед второй пачкой в очереди свежий джоб: запуск уступил воркер.
        self.assertEqual(len(provider.calls), 1)
        self.assertEqual(
            sorted(self._statuses(document)),
            [Status.FAILED, Status.FAILED, Status.READY],
        )
        # Запуск успел записать вектор, поэтому остаток встаёт в очередь за
        # книгой, а не ждёт следующего вопроса через 10 минут.
        self.assertEqual(self.publish.call_count, 1)
        self.assertEqual(
            self.publish.call_args.kwargs,
            {"args": [str(document.pk)], "retry": False},
        )

    def test_a_repair_run_stops_at_the_time_limit_and_continues_once(self):
        clock = FakeClock()
        self._patch("curriculum.tasks.monotonic", new=clock)
        provider = self._use_provider(SlowProvider(clock, seconds=50))
        document = self._ready_book(*[Status.FAILED] * 5)
        # Поиск только что поставил эту починку: ключ на 10 минут занят.
        self.assertTrue(cache.add(repair_key(document), "1", timeout=600))

        with mock.patch("curriculum.services.embedding_index.EMBEDDING_BATCH_SIZE", 1):
            self._repair(document)

        # Пачка идёт 50 с. После второй до 120 с осталось 20 с, меньше пачки:
        # запуск остановился на границе.
        self.assertEqual(len(provider.calls), 2)
        self.assertEqual(
            sorted(self._statuses(document)),
            [Status.FAILED] * 3 + [Status.READY] * 2,
        )
        # Продолжение ровно одно и мимо десятиминутного ключа: это не новая
        # просьба, а остаток начатой починки.
        self.assertEqual(self.publish.call_count, 1)
        self.assertEqual(
            self.publish.call_args.kwargs,
            {"args": [str(document.pk)], "retry": False},
        )

    def test_the_first_batch_of_a_run_always_goes(self):
        # Выборка и даровое переиспользование шли дольше всего бюджета. Без
        # первой пачки запуск ничего бы не записал и не продолжился.
        clock = FakeClock()
        self._patch("curriculum.tasks.monotonic", new=clock)
        provider = self._use_provider(SlowProvider(clock, seconds=50))
        real_reuse_map = embedding_index_service._reuse_map

        def slow_reuse_map(*args, **kwargs):
            clock.advance(500)
            return real_reuse_map(*args, **kwargs)

        self._patch(
            "curriculum.services.embedding_index._reuse_map", side_effect=slow_reuse_map
        )
        document = self._ready_book(Status.FAILED, Status.FAILED)

        with mock.patch("curriculum.services.embedding_index.EMBEDDING_BATCH_SIZE", 1):
            self._repair(document)

        self.assertEqual(len(provider.calls), 1)
        self.assertEqual(sorted(self._statuses(document)), [Status.FAILED, Status.READY])
        self.assertEqual(self.publish.call_count, 1)

    def test_a_book_queued_before_the_continuation_is_processed_first(self):
        # Очередь брокера и один воркер: FIFO, по одному сообщению. Починку
        # книги A поиск поставил раньше, чем загрузили книгу B. B прождала в
        # очереди дольше порога, и щита у неё уже нет: воркер простаивал,
        # например его перезапускали. Уступать починке некому, а граница по
        # времени всё равно ставит продолжение в очередь за B.
        queue: list[tuple[str, dict]] = []
        self.publish.side_effect = lambda *args, **kwargs: queue.append(("repair", kwargs))
        self._patch(
            "curriculum.tasks.ingest_document_task.apply_async",
            side_effect=lambda *args, **kwargs: queue.append(("ingest", kwargs)),
        )
        clock = FakeClock()
        self._patch("curriculum.tasks.monotonic", new=clock)
        self._use_provider(SlowProvider(clock, seconds=50))
        self._patch("curriculum.services.embedding_index.EMBEDDING_BATCH_SIZE", new=1)

        book_a = self._ready_book(*[Status.FAILED] * 3)
        self.assertEqual(request_vector_repair([str(book_a.pk)]), [str(book_a.pk)])
        book_b = self._book_with_file("Механика")
        with self.captureOnCommitCallbacks(execute=True):
            job_b = dispatch.enqueue_ingestion(book_b)
        IngestionJob.objects.filter(pk=job_b.pk).update(
            updated_at=timezone.now() - timedelta(seconds=400)
        )
        self.assertEqual([kind for kind, _ in queue], ["repair", "ingest"])

        processed = []
        while queue:
            kind, message = queue.pop(0)
            if kind == "repair":
                embed_missing_chunks_task.apply(args=message["args"]).get()
            else:
                ingest_document_task.apply(
                    args=message["args"],
                    kwargs=message["kwargs"],
                    task_id=message["task_id"],
                ).get()
            book_b.refresh_from_db()
            processed.append(
                (
                    kind,
                    message["args"][0],
                    self._statuses(book_a).count(Status.READY),
                    book_b.ingestion_status,
                )
            )

        self.assertEqual(
            processed,
            [
                ("repair", str(book_a.pk), 2, Document.Status.QUEUED),
                ("ingest", str(book_b.pk), 2, Document.Status.READY),
                ("repair", str(book_a.pk), 3, Document.Status.READY),
            ],
        )
        # Просьба поиска и одно продолжение.
        self.assertEqual(self.publish.call_count, 2)

    def test_a_broker_failure_on_the_continuation_is_only_logged(self):
        clock = FakeClock()
        self._patch("curriculum.tasks.monotonic", new=clock)
        self._use_provider(SlowProvider(clock, seconds=50))
        self.publish.side_effect = ConnectionError("redis down")
        document = self._ready_book(*[Status.FAILED] * 5)

        with mock.patch(
            "curriculum.services.embedding_index.EMBEDDING_BATCH_SIZE", 1
        ), self.assertLogs("curriculum.tasks", "WARNING") as logs:
            self._repair(document)

        self.assertIn("redis down", "\n".join(logs.output))
        self.assertEqual(self.publish.call_count, 1)
        # Записанное остаётся, остаток заберёт следующая починка.
        self.assertEqual(self._statuses(document).count(Status.READY), 2)

    def test_the_time_limit_ends_the_repair_without_a_continuation(self):
        class TimeLimited(FakeEmbeddingProvider):
            def embed(self, texts):
                raise SoftTimeLimitExceeded()

        self._use_provider(TimeLimited())
        document = self._ready_book(Status.FAILED)

        with self.assertLogs("curriculum.tasks", "WARNING"):
            self._repair(document)

        self.assertEqual(self._statuses(document), [Status.FAILED])
        self.publish.assert_not_called()

    def test_a_book_that_is_gone_or_no_longer_ready_is_skipped(self):
        provider = self._use_provider(FakeEmbeddingProvider())
        reprocessing = self._ready_book(Status.FAILED)
        Document.objects.filter(pk=reprocessing.pk).update(
            ingestion_status=Document.Status.QUEUED
        )
        deleted = self._ready_book(Status.FAILED)
        deleted_id = str(deleted.pk)
        deleted.delete()

        self._repair(reprocessing)
        embed_missing_chunks_task.apply(args=[deleted_id]).get()

        self.assertEqual(provider.calls, [])
        self.assertEqual(self._statuses(reprocessing), [Status.FAILED])
        self.publish.assert_not_called()


REAL_EMBED = OpenAICompatibleEmbeddingProvider.embed


@override_settings(
    CURRICULUM_EMBEDDINGS_ENABLED=True,
    CURRICULUM_INGEST_MODE="celery",
    CELERY_BROKER_URL="redis://stub",
)
class RepairProviderTests(_RepairBase):
    """Настоящая фабрика провайдера, сеть подменена: провайдер завис.

    Починка ждёт пачку 60 с и пробует её один раз: воркер один, а повтор даст
    следующий вопрос или продолжение. Обработка книги ждёт и пробует как раньше.
    """

    def setUp(self):
        super().setUp()
        environ = mock.patch.dict(
            "os.environ", {"EMBEDDING_MODEL": "m", "EMBEDDING_TIMEOUT": "180"}
        )
        environ.start()
        self.addCleanup(environ.stop)
        self._patch("curriculum.embeddings.EMBEDDING_BASE_URL", new="https://example.test/v1")
        self._patch("curriculum.embeddings.EMBEDDING_API_KEY", new="key")
        self.sleep = self._patch("curriculum.embeddings.time.sleep")
        self.create = self._patch("openai.OpenAI").return_value.embeddings.create
        self.create.side_effect = RuntimeError("провайдер завис")
        # Видно, какой провайдер на деле считал векторы, и его настройки.
        spy = mock.patch.object(
            OpenAICompatibleEmbeddingProvider, "embed", autospec=True, side_effect=REAL_EMBED
        )
        self.embed = spy.start()
        self.addCleanup(spy.stop)

    def test_the_repair_waits_sixty_seconds_and_tries_once(self):
        document = self._ready_book(Status.FAILED)

        with self.assertLogs("curriculum.embeddings", "WARNING") as logs:
            embed_missing_chunks_task.apply(args=[str(document.pk)]).get()

        provider = self.embed.call_args.args[0]
        self.assertEqual((provider.timeout_seconds, provider.max_attempts), (60, 1))
        self.create.assert_called_once()
        self.assertEqual(self.create.call_args.kwargs["timeout"], 60)
        self.sleep.assert_not_called()
        self.assertIn("попытка 1/1", "\n".join(logs.output))
        self.assertEqual(self._statuses(document), [Status.FAILED])

    def test_ingestion_keeps_its_timeout_and_three_attempts(self):
        book = self._book_with_file("Механика")

        with self.assertLogs("curriculum", "WARNING"):
            ingest_document(book, ocr_provider=NullOcrProvider())

        provider = self.embed.call_args.args[0]
        self.assertEqual((provider.timeout_seconds, provider.max_attempts), (180, 3))
        self.assertEqual(
            {call.kwargs["timeout"] for call in self.create.call_args_list}, {180}
        )
        self.assertEqual(self.create.call_count, 3 * self.embed.call_count)
        book.refresh_from_db()
        self.assertEqual(book.ingestion_status, Document.Status.READY)


class RepairTaskRegistrationTests(SimpleTestCase):
    def test_the_worker_knows_the_task_by_its_name(self):
        from config import celery_app

        task = celery_app.tasks["curriculum.embed_missing_chunks"]
        self.assertTrue(task.acks_late)
        self.assertEqual(task.max_retries, 0)
        self.assertTrue(task.ignore_result)


class FailedVectorsWarningTests(_RepairBase):
    def test_failed_vectors_are_logged_as_a_warning(self):
        provider = self._use_provider(FakeEmbeddingProvider(fail=True))
        document = self._book_with_file("Механика")

        with self.assertLogs("curriculum.services.ingestion", "WARNING") as logs:
            outcome = ingest_document(document, ocr_provider=NullOcrProvider())

        document.refresh_from_db()
        self.assertEqual(outcome.job.status, Document.Status.READY)
        self.assertEqual(document.ingestion_status, Document.Status.READY)
        self.assertTrue(provider.calls)
        self.assertTrue(
            KnowledgeChunk.objects.filter(
                document_id=document.pk, embedding_status=Status.FAILED
            ).exists()
        )
        self.assertIn(str(document.pk), "\n".join(logs.output))
