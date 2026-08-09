"""Celery-задачи curriculum.

Модуль намеренно тонкий: вся логика живёт в `services.ingestion`, здесь только
переход через границу брокера.

**Границу пересекает исключительно UUID.** Ни модель, ни байты файла, ни
`Document` в задачу не передаются. Причины две, и обе практические: объект,
сериализованный при постановке, к моменту исполнения уже устарел (обработка
идёт минутами, статус за это время меняется), а PDF на десятки мегабайт в теле
сообщения превратил бы Redis в файловое хранилище.

Ретраев здесь нет и не должно быть. Повторный запуск обработки — это осознанное
действие пользователя через `POST /documents/{id}/ingest/`, у которого своя
защита от гонок в `services.dispatch`. Автоматический ретрай платного пайплайна
(OCR — это vision-вызовы) означал бы удвоение счёта за каждый сетевой сбой.
"""

from __future__ import annotations

import logging

from celery import shared_task

from .models import PROCESSING_VERSION, Document
from .services.ingestion import ingest_document

logger = logging.getLogger(__name__)


@shared_task(
    name="curriculum.ingest_document",
    # Подтверждение ПОСЛЕ выполнения: если воркера убьют посреди обработки
    # (контейнер эфемерный), сообщение вернётся в очередь, а не исчезнет.
    acks_late=True,
    # Потерянный воркер не должен отправлять задачу в reject-цикл: документ
    # остаётся в незавершённом статусе, и его подхватит проверка на «зависший
    # джоб» в `dispatch.is_stale`.
    reject_on_worker_lost=False,
    ignore_result=True,
)
def ingest_document_task(document_id: str, processing_version: str = PROCESSING_VERSION):
    """Обрабатывает документ по идентификатору.

    Результата не возвращает: хранилище результата — это `IngestionJob`, его и
    опрашивает фронтенд. Поэтому и `CELERY_RESULT_BACKEND` в проекте не нужен.

    `ingest_document` сам не выпускает исключения наружу: ошибку он пишет в
    статус `failed` и `error_code` джоба. Широкий `except` ниже страхует от
    сбоя ВНЕ пайплайна (например, обрыв соединения с базой при записи джоба) —
    воркер не должен умирать из-за одной проблемной книги.
    """
    document = Document.objects.filter(pk=document_id).first()
    if document is None:
        # Документ удалили, пока задача ждала в очереди. Это не ошибка.
        logger.info("Документ %s исчез до начала обработки — задача пропущена", document_id)
        return

    try:
        ingest_document(document, processing_version=processing_version)
    except Exception:  # noqa: BLE001 — воркер не должен падать из-за одной книги
        logger.exception("Обработка документа %s упала неожиданно", document_id)
