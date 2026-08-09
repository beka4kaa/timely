"""Целостность между базами, которую больше не держит СУБД.

Таблица чанков живёт в отдельной базе (`curriculum/routers.py`), поэтому у
`KnowledgeChunk.document_id` нет внешнего ключа и нет каскада. Раньше удаление
документа уносило его чанки автоматически — теперь это делает код здесь.

Без этого обработчика удалённая книга оставляла бы после себя чанки с векторами,
на которые уже никто не сослался: место они занимают, в поиск попадают, а
документа за ними нет. Ровно это ловит `test_delete_cascades_to_all_derived_data`.

Сигнал, а не удаление в сервисе: документ удаляется из вьюхи, из админки, из
management-команды и каскадом вместе с пользователем. Единственное место, через
которое проходят все эти пути, — сам сигнал.
"""

from __future__ import annotations

import logging

from django.db.models.signals import post_delete
from django.dispatch import receiver

from .models import Document, DocumentSection, ExtractedTask, KnowledgeChunk

logger = logging.getLogger(__name__)


def _clear_reference(field: str, value, label: str) -> None:
    """Обнуляет ссылку чанков на удалённую строку.

    Раньше это делал `on_delete=SET_NULL` у внешнего ключа. Ключа больше нет —
    таблица в другой базе, — поэтому обнуляет код. Пропустить этот шаг нельзя:
    чанк с ссылкой на удалённый раздел выглядит как фрагмент с провенансом, а
    указывает в пустоту.
    """
    try:
        KnowledgeChunk.objects.filter(**{field: value}).update(**{field: None})
    except Exception:  # noqa: BLE001 — удаление не должно падать из-за чанков
        logger.exception(
            "Не удалось обнулить %s у чанков после удаления %s %s",
            field,
            label,
            value,
        )


@receiver(post_delete, sender=Document, dispatch_uid="curriculum_delete_chunks")
def delete_chunks_of_document(sender, instance: Document, **kwargs) -> None:
    """Удаляет чанки документа из векторной базы.

    `post_delete`, а не `pre_delete`: если удаление самого документа откатится,
    чанки должны остаться на месте. Порядок «сначала документ, потом его
    производные» здесь безопасен — на чанки больше никто не ссылается.

    Ошибка векторной базы наружу не выпускается. Недоступный домашний ПК не
    должен превращать удаление книги в 500: документ уже удалён, а осиротевшие
    чанки подберёт повторный запуск или отдельная уборка. Молчать при этом
    нельзя — расхождение баз обязано быть видно в логах.
    """
    try:
        deleted, _ = KnowledgeChunk.objects.filter(document_id=instance.pk).delete()
    except Exception:  # noqa: BLE001 — удаление документа не должно падать
        logger.exception(
            "Не удалось удалить чанки документа %s: в векторной базе остались "
            "осиротевшие строки",
            instance.pk,
        )
        return
    if deleted:
        logger.info("Документ %s удалён вместе с %s чанками", instance.pk, deleted)


@receiver(post_delete, sender=DocumentSection, dispatch_uid="curriculum_clear_section")
def clear_section_of_deleted_rows(sender, instance: DocumentSection, **kwargs) -> None:
    """Заменяет прежний `on_delete=SET_NULL` у `KnowledgeChunk.section`."""
    _clear_reference("section_id", instance.pk, "раздела")


@receiver(post_delete, sender=ExtractedTask, dispatch_uid="curriculum_clear_task")
def clear_task_of_deleted_rows(sender, instance: ExtractedTask, **kwargs) -> None:
    """Заменяет прежний `on_delete=SET_NULL` у `KnowledgeChunk.task`."""
    _clear_reference("task_id", instance.pk, "задачи")
