"""Постановка документа в обработку.

Единственный слой, который знает, КАК запускается ingestion. Всё остальное —
вьюха, тесты, будущая Celery-задача — работает через `enqueue_ingestion` и не
меняется при смене исполнителя.

Зачем это отдельно от `ingest_document`. Пайплайн синхронный: на четырёхсотстраничном
учебнике он не укладывается ни в gunicorn (`--timeout 200`), ни в Next-прокси (180 с).
Очереди в проекте пока нет, но контракт API должен быть асинхронным уже сейчас, иначе
фронтенд придётся переписывать дважды. Поэтому:

* endpoint отвечает 202 и отдаёт `IngestionJob`, а прогресс забирается опросом;
* исполнитель выбирается здесь — сегодня inline, после подключения Celery тот же
  код уходит в воркер от одной переменной окружения.

`ingest_document` при этом не тронут: его сигнатура и поведение прежние, и все
существующие вызовы из тестов продолжают работать напрямую.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from ..models import PROCESSING_VERSION, Document, IngestionJob
from .ingestion import ingest_document

logger = logging.getLogger(__name__)

MODE_AUTO = "auto"
MODE_INLINE = "inline"
MODE_CELERY = "celery"

# Сколько job считается живым без смены статуса. Контейнер эфемерный: воркер
# может быть убит в любой момент, и «вечно выполняющийся» джоб заблокировал бы
# документ навсегда.
DEFAULT_STALE_AFTER_SECONDS = 1800


def _stale_after() -> timedelta:
    return timedelta(
        seconds=int(
            getattr(
                settings,
                "CURRICULUM_INGEST_STALE_AFTER_SECONDS",
                DEFAULT_STALE_AFTER_SECONDS,
            )
        )
    )


def resolve_mode(mode: str | None = None) -> str:
    """Как запускать. `auto` смотрит на наличие брокера.

    Пока брокера нет, `auto` всегда даёт `inline`, и это правильный дефолт:
    забытая переменная окружения приводит к работающей обработке, а не к
    документу, который навсегда завис в статусе «загружен».
    """
    chosen = mode or getattr(settings, "CURRICULUM_INGEST_MODE", MODE_AUTO)
    if chosen != MODE_AUTO:
        return chosen
    if getattr(settings, "CELERY_BROKER_URL", ""):
        return MODE_CELERY
    return MODE_INLINE


def is_stale(job: IngestionJob, *, now=None) -> bool:
    """Джоб завис: не терминальный и давно не менялся."""
    if job.status in (Document.Status.READY, Document.Status.FAILED):
        return False
    moment = now or timezone.now()
    last_change = job.updated_at or job.started_at or job.created_at
    return bool(last_change and moment - last_change > _stale_after())


def enqueue_ingestion(
    document: Document,
    *,
    processing_version: str = PROCESSING_VERSION,
    mode: str | None = None,
    **ingest_kwargs,
) -> IngestionJob:
    """Ставит документ в обработку и возвращает job.

    Строка `IngestionJob` существует ДО возврата — иначе фронтенд, получив 202,
    пойдёт опрашивать статус и не найдёт ничего. `ingest_document` делает
    `get_or_create` по той же паре `(документ, версия)`, поэтому второго джоба не
    появляется ни при каком порядке вызовов.
    """
    job, _ = IngestionJob.objects.get_or_create(
        document=document,
        processing_version=processing_version,
        defaults={
            "user_email": document.user_email,
            "status": Document.Status.UPLOADED,
        },
    )

    if _already_running(job):
        # Защита от двойного клика и от повторного опроса «а вдруг не началось».
        logger.info(
            "Документ %s уже обрабатывается (job %s, статус %s) — не переставляем",
            document.pk,
            job.pk,
            job.status,
        )
        return job

    chosen = resolve_mode(mode)
    if chosen == MODE_CELERY:
        return _dispatch_celery(document, job, processing_version)
    return _dispatch_inline(document, job, processing_version, **ingest_kwargs)


def _already_running(job: IngestionJob) -> bool:
    if job.status in (Document.Status.READY, Document.Status.FAILED):
        return False
    if job.status == Document.Status.UPLOADED and job.started_at is None:
        # Только что созданный джоб: его никто ещё не запускал.
        return False
    return not is_stale(job)


def _dispatch_inline(
    document: Document,
    job: IngestionJob,
    processing_version: str,
    **ingest_kwargs,
) -> IngestionJob:
    outcome = ingest_document(
        document, processing_version=processing_version, **ingest_kwargs
    )
    return outcome.job


def _dispatch_celery(
    document: Document, job: IngestionJob, processing_version: str
) -> IngestionJob:
    """Постановка в очередь.

    Если `tasks` ещё нет или celery не установлен, откатываемся на inline и
    громко пишем в лог. Выставленный раньше времени `CELERY_BROKER_URL` не должен
    приводить к документу, который навсегда завис в статусе «загружен».
    """
    try:
        from ..tasks import ingest_document_task
    except ImportError:
        logger.warning(
            "CELERY_BROKER_URL задан, но curriculum.tasks недоступен — "
            "обрабатываем документ %s синхронно",
            document.pk,
        )
        return _dispatch_inline(document, job, processing_version)

    def _send() -> None:
        async_result = ingest_document_task.delay(
            str(document.pk), processing_version=processing_version
        )
        IngestionJob.objects.filter(pk=job.pk).update(
            celery_task_id=str(async_result.id)
        )

    # on_commit: воркер не должен увидеть документ раньше, чем транзакция вьюхи
    # зафиксирует его в базе.
    transaction.on_commit(_send)
    return job
