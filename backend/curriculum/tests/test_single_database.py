"""Одна база: куски книг лежат в основной, а целостность держат сигналы."""

from unittest import mock

from django.conf import settings
from django.db import DatabaseError, transaction
from django.test import SimpleTestCase, TestCase

from curriculum.models import (
    Document,
    DocumentSection,
    ExtractedTask,
    KnowledgeChunk,
)

OWNER = "student@timelyplan.me"


def document(title="Механика") -> Document:
    return Document.objects.create(user_email=OWNER, title=title)


def chunk(doc, **kwargs) -> KnowledgeChunk:
    kwargs.setdefault("normalized_text", "Текст фрагмента")
    kwargs.setdefault("content_hash", "a" * 64)
    return KnowledgeChunk.objects.create(document_id=doc.pk, **kwargs)


class SingleDatabaseTests(SimpleTestCase):
    def test_only_the_default_database_is_configured(self):
        self.assertEqual(set(settings.DATABASES), {"default"})

    def test_no_database_router(self):
        self.assertEqual(list(settings.DATABASE_ROUTERS), [])


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
        # Внешнего ключа на документ нет намеренно: целостность держат сигналы,
        # а не база.
        doc = document()
        row = chunk(doc)
        self.assertEqual(
            [f.name for f in KnowledgeChunk._meta.get_fields() if f.name == "document"],
            [],
            "внешнего ключа на документ быть не должно",
        )
        self.assertEqual(row.document_id, doc.pk)

    def test_ошибка_удаления_кусков_откатывает_удаление_документа(self):
        doc = document()
        chunk(doc)
        with mock.patch.object(
            KnowledgeChunk.objects, "filter", side_effect=DatabaseError("boom")
        ):
            with self.assertRaises(DatabaseError):
                with transaction.atomic():
                    doc.delete()
        self.assertTrue(Document.objects.filter(pk=doc.pk).exists())
        self.assertEqual(KnowledgeChunk.objects.filter(document_id=doc.pk).count(), 1)
