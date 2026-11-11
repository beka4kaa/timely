"""Целостность кусков, которую не держит СУБД.

У `KnowledgeChunk.document_id`, `section_id` и `task_id` нет внешних ключей и
нет каскада. Удаление документа уносит его куски, удаление раздела или задачи
обнуляет ссылку: это делает код здесь.

Без этого обработчика удалённая книга оставляла бы после себя чанки с векторами,
на которые уже никто не сослался: место они занимают, в поиск попадают, а
документа за ними нет. Ровно это ловит `test_delete_cascades_to_all_derived_data`.

Сигнал, а не удаление в сервисе: документ удаляется из вьюхи, из админки, из
management-команды и каскадом вместе с пользователем. Единственное место, через
которое проходят все эти пути, — сам сигнал.
"""

from __future__ import annotations

import logging

from django.db import transaction
from django.db.models.signals import post_delete
from django.dispatch import receiver

from .models import Document, DocumentFile, DocumentSection, ExtractedTask, KnowledgeChunk
from .storage import get_storage_for

logger = logging.getLogger(__name__)


def _clear_reference(field: str, value) -> None:
    """Обнуляет ссылку чанков на удалённую строку.

    Раньше это делал `on_delete=SET_NULL` у внешнего ключа. Ключа больше нет,
    поэтому обнуляет код. Пропустить этот шаг нельзя: чанк с ссылкой на
    удалённый раздел выглядит как фрагмент с провенансом, а указывает в пустоту.
    """
    KnowledgeChunk.objects.filter(**{field: value}).update(**{field: None})


@receiver(post_delete, sender=Document, dispatch_uid="curriculum_delete_chunks")
def delete_chunks_of_document(sender, instance: Document, **kwargs) -> None:
    """Удаляет куски документа: внешнего ключа на документ у них нет.

    `post_delete`, а не `pre_delete`: если удаление самого документа откатится,
    чанки должны остаться на месте. Порядок «сначала документ, потом его
    производные» здесь безопасен — на чанки больше никто не ссылается.

    Удаление кусков идёт в той же транзакции, что и удаление документа: если оно
    упадёт, откатится всё удаление, и книга останется целой.
    """
    deleted, _ = KnowledgeChunk.objects.filter(document_id=instance.pk).delete()
    if deleted:
        logger.info("Документ %s удалён вместе с %s чанками", instance.pk, deleted)


@receiver(post_delete, sender=DocumentSection, dispatch_uid="curriculum_clear_section")
def clear_section_of_deleted_rows(sender, instance: DocumentSection, **kwargs) -> None:
    """Заменяет прежний `on_delete=SET_NULL` у `KnowledgeChunk.section`."""
    _clear_reference("section_id", instance.pk)


@receiver(post_delete, sender=ExtractedTask, dispatch_uid="curriculum_clear_task")
def clear_task_of_deleted_rows(sender, instance: ExtractedTask, **kwargs) -> None:
    """Заменяет прежний `on_delete=SET_NULL` у `KnowledgeChunk.task`."""
    _clear_reference("task_id", instance.pk)


def _delete_stored_file(storage_backend: str, storage_key: str, document_id) -> None:
    """Удаляет файл из его хранилища. Сбой только в лог: книги уже нет."""
    try:
        get_storage_for(storage_backend).delete(storage_key)
    except Exception:  # noqa: BLE001
        logger.warning(
            "curriculum_file_delete_failed backend=%s key=%s document=%s",
            storage_backend, storage_key, document_id,
            exc_info=True,
        )


@receiver(post_delete, sender=DocumentFile, dispatch_uid="curriculum_delete_file")
def delete_file_of_document(sender, instance: DocumentFile, **kwargs) -> None:
    """Удаляет файл книги из хранилища после коммита удаления строки.

    До коммита нельзя: если удаление откатится, книга останется без файла.
    Значения берутся сразу, потому что к моменту коммита экземпляр может быть
    уже не нужен вызывающему коду.
    """
    backend, key, document_id = (
        instance.storage_backend, instance.storage_key, instance.document_id,
    )
    transaction.on_commit(lambda: _delete_stored_file(backend, key, document_id))
