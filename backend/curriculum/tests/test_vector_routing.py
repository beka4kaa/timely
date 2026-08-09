"""Маршрутизация чанков в отдельную базу и целостность без внешних ключей.

Роутер под тест-раннером выключен (см. `VECTOR_DB_CONFIGURED` в настройках):
иначе прогон уходил бы в боевую векторную базу на домашнем ПК. Поэтому тесты
самого роутера включают его обратно через `@override_settings` и проверяют
решения, а не реальные запросы к сети.

Отдельно проверяется то, что раньше держала СУБД: каскад и `SET_NULL`. Внешних
ключей на документ, раздел и задачу больше нет, и вместо них работают сигналы.
"""

from django.test import TestCase, override_settings

from curriculum.models import (
    Document,
    DocumentSection,
    ExtractedTask,
    KnowledgeChunk,
    LearningGoal,
)
from curriculum.routers import VectorDatabaseRouter

OWNER = "student@timelyplan.me"
ALIAS = "vector_db"


def document(title="Механика") -> Document:
    return Document.objects.create(user_email=OWNER, title=title)


def chunk(doc, **kwargs) -> KnowledgeChunk:
    kwargs.setdefault("normalized_text", "Текст фрагмента")
    kwargs.setdefault("content_hash", "a" * 64)
    return KnowledgeChunk.objects.create(document_id=doc.pk, **kwargs)


@override_settings(VECTOR_DB_CONFIGURED=True, VECTOR_DB_ALIAS=ALIAS)
class RouterDecisionTests(TestCase):
    def setUp(self):
        self.router = VectorDatabaseRouter()

    def test_чанки_уходят_в_векторную_базу(self):
        self.assertEqual(self.router.db_for_read(KnowledgeChunk), ALIAS)
        self.assertEqual(self.router.db_for_write(KnowledgeChunk), ALIAS)

    def test_остальные_модели_не_трогаются(self):
        # `None` значит «решай сам»: роутер не должен присваивать базу тому,
        # что его не касается.
        for model in (Document, DocumentSection, ExtractedTask, LearningGoal):
            self.assertIsNone(self.router.db_for_read(model), model.__name__)
            self.assertIsNone(self.router.db_for_write(model), model.__name__)

    def test_связь_между_базами_запрещена_явно(self):
        # Объекты НЕ сохраняются: роутер принимает решение по типу, а запись в
        # боевую векторную базу из тестов недопустима.
        doc = Document(user_email=OWNER, title="Механика")
        row = KnowledgeChunk(document_id=doc.pk, normalized_text="Текст")
        # Возврат None здесь означал бы «разрешено»: забытый внешний ключ ушёл
        # бы тихим запросом не в ту базу вместо явного отказа.
        self.assertIs(self.router.allow_relation(row, doc), False)
        self.assertIs(self.router.allow_relation(doc, row), False)

    def test_связь_внутри_одной_базы_разрешена(self):
        doc = Document(user_email=OWNER, title="Механика")
        first = KnowledgeChunk(document_id=doc.pk, normalized_text="Раз")
        second = KnowledgeChunk(document_id=doc.pk, normalized_text="Два")
        self.assertIsNone(self.router.allow_relation(first, second))
        self.assertIsNone(
            self.router.allow_relation(doc, DocumentSection(document=doc))
        )

    def test_таблица_чанков_создаётся_только_в_векторной_базе(self):
        self.assertIs(
            self.router.allow_migrate(ALIAS, "curriculum", "knowledgechunk"), True
        )
        self.assertIs(
            self.router.allow_migrate("default", "curriculum", "knowledgechunk"), False
        )

    def test_чужим_таблицам_в_векторной_базе_не_место(self):
        # Иначе `migrate --database=vector_db` разложил бы на домашнем ПК всю
        # схему проекта.
        for app, model in (
            ("curriculum", "document"),
            ("ai_engine", "chatsession"),
            ("auth", "user"),
        ):
            self.assertIs(self.router.allow_migrate(ALIAS, app, model), False, model)

    def test_основная_база_остальное_решает_сама(self):
        self.assertIsNone(
            self.router.allow_migrate("default", "curriculum", "document")
        )
        self.assertIsNone(self.router.allow_migrate("default", "auth", "user"))


class RouterDisabledTests(TestCase):
    """Без `VECTOR_DB_URL` приложение остаётся однобазовым."""

    def test_выключенный_роутер_молчит(self):
        router = VectorDatabaseRouter()
        # Под тест-раннером флаг снят настройками — это и есть проверяемое
        # поведение: тесты не должны ходить в боевую векторную базу.
        self.assertIsNone(router.db_for_read(KnowledgeChunk))
        self.assertIsNone(router.db_for_write(KnowledgeChunk))
        self.assertIsNone(router.allow_migrate(ALIAS, "curriculum", "knowledgechunk"))


class IntegrityWithoutForeignKeysTests(TestCase):
    """То, что раньше делала СУБД, теперь делают сигналы."""

    def test_удаление_документа_уносит_чанки(self):
        doc = document()
        other = document("Другая книга")
        chunk(doc, content_hash="b" * 64)
        chunk(doc, content_hash="c" * 64)
        keep = chunk(other, content_hash="d" * 64)

        doc.delete()

        self.assertEqual(KnowledgeChunk.objects.filter(document_id=doc.pk).count(), 0)
        self.assertTrue(KnowledgeChunk.objects.filter(pk=keep.pk).exists())

    def test_удаление_раздела_обнуляет_ссылку_а_не_чанк(self):
        # Раньше это делал `on_delete=SET_NULL`. Фрагмент обязан пережить
        # удаление раздела: текст никуда не делся, потерялась только привязка.
        doc = document()
        section = DocumentSection.objects.create(
            document=doc, path="1.1", title="Скорость", order_index=0
        )
        row = chunk(doc, section_id=section.pk)

        section.delete()

        row.refresh_from_db()
        self.assertIsNone(row.section_id)
        self.assertEqual(row.normalized_text, "Текст фрагмента")

    def test_удаление_задачи_обнуляет_ссылку(self):
        doc = document()
        task = ExtractedTask.objects.create(
            document=doc, statement="Найдите путь", page_start=1
        )
        row = chunk(doc, task_id=task.pk)

        task.delete()

        row.refresh_from_db()
        self.assertIsNone(row.task_id)

    def test_чанк_без_внешних_ключей_допускает_ссылку_в_никуда(self):
        # Прямое следствие переезда: целостность больше не проверяет база.
        # Тест фиксирует это как ОСОЗНАННОЕ свойство, а не случайность.
        doc = document()
        row = chunk(doc)
        self.assertEqual(
            [f.name for f in KnowledgeChunk._meta.get_fields() if f.name == "document"],
            [],
            "внешнего ключа на документ быть не должно",
        )
        self.assertEqual(row.document_id, doc.pk)
