"""Постановка документа в обработку.

Единственный слой, который знает, КАК запускается ingestion. Всё остальное —
вьюха, тесты, будущая Celery-задача — работает через `enqueue_ingestion` и не
меняется при смене исполнителя.

Зачем это отдельно от `ingest_document`. Сам пайплайн — обычная синхронная
функция, но на четырёхсотстраничном учебнике она не укладывается ни в gunicorn
(`--timeout 200`), ни в Next-прокси (180 с). Поэтому слой dispatch даёт API
асинхронный контракт и передаёт тяжёлую работу Celery-воркеру:

* endpoint отвечает 202 и отдаёт `IngestionJob`, а прогресс забирается опросом;
* исполнитель выбирается здесь: production работает через Celery,
  inline остаётся для локальной разработки и тестов.

Прямой `ingest_document` сохранён для тестов и management-команды.
"""

from __future__ import annotations

import logging
import uuid
from datetime import timedelta

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from ..models import PROCESSING_VERSION, Document, IngestionJob
from ..observability import log_ingestion_event
from .ingestion import ingest_document

logger = logging.getLogger(__name__)

MODE_AUTO = "auto"
MODE_INLINE = "inline"
MODE_CELERY = "celery"

# Сколько job считается живым без смены статуса. Контейнер эфемерный: воркер
# может быть убит в любой момент, и «вечно выполняющийся» джоб заблокировал бы
# документ навсегда.
DEFAULT_STALE_AFTER_SECONDS = 1800
QUEUE_UNAVAILABLE_ERROR_CODE = "queue_unavailable"
QUEUE_UNAVAILABLE_MESSAGE = (
    "Очередь обработки сейчас недоступна. Файл сохранён — попробуйте позже."
)
SUPERSEDED_ERROR_CODE = "superseded"
SUPERSEDED_MESSAGE = "Запущена более новая версия обработки этого документа."


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

    `auto` без брокера даёт `inline` и нужен только local/test.
    Production по умолчанию задаёт `celery` в settings, чтобы пропавший
    Redis-секрет не запустил тяжёлую книгу в web-контейнере.
    """
    raw_mode = mode if mode is not None else getattr(
        settings, "CURRICULUM_INGEST_MODE", MODE_AUTO
    )
    chosen = str(raw_mode).strip().lower()
    if chosen not in {MODE_AUTO, MODE_INLINE, MODE_CELERY}:
        raise ImproperlyConfigured(
            "CURRICULUM_INGEST_MODE должен быть auto, inline или celery; "
            f"получено {raw_mode!r}."
        )
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
    chosen = resolve_mode(mode)
    if chosen == MODE_CELERY:
        # Сериализуем POST'ы одного документа. Без row lock два одновременных
        # клика могут оба пройти `_already_running` и опубликовать две дорогие
        # задачи до того, как увидят `queued` друг друга.
        with transaction.atomic():
            locked_document = Document.objects.select_for_update().get(pk=document.pk)
            job = _get_or_create_job(locked_document, processing_version)
            if _already_running(job):
                _supersede_other_jobs(locked_document, keep=job)
                _log_already_running(locked_document, job)
                return job
            return _dispatch_celery(locked_document, job, processing_version)

    job = _get_or_create_job(document, processing_version)

    if _already_running(job):
        _log_already_running(document, job)
        return job

    return _dispatch_inline(document, job, processing_version, **ingest_kwargs)


def _get_or_create_job(
    document: Document, processing_version: str
) -> IngestionJob:
    job, _ = IngestionJob.objects.get_or_create(
        document=document,
        processing_version=processing_version,
        defaults={
            "user_email": document.user_email,
            "status": Document.Status.UPLOADED,
        },
    )
    return job


def _log_already_running(document: Document, job: IngestionJob) -> None:
    logger.info(
        "Документ %s уже обрабатывается (job %s, статус %s) — не переставляем",
        document.pk,
        job.pk,
        job.status,
    )


def _already_running(job: IngestionJob) -> bool:
    if job.status in (Document.Status.READY, Document.Status.FAILED):
        return False
    if job.status == Document.Status.UPLOADED and job.started_at is None:
        # Только что созданный джоб: его никто ещё не запускал.
        return False
    if job.status == Document.Status.QUEUED:
        # Уже в очереди. Второй клик не должен ставить вторую задачу, но
        # застрявшая очередь обязана разблокироваться по таймауту.
        return not is_stale(job)
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

    Если модуль задачи или брокер недоступны, фиксируем понятную терминальную
    ошибку. На inline здесь не откатываемся: большой учебник снова оказался бы
    в малом web-контейнере — ровно авария, от которой защищает очередь.
    """
    if not getattr(settings, "CELERY_BROKER_URL", ""):
        logger.error(
            "Celery-режим включён без CELERY_BROKER_URL; "
            "документ %s не запущен inline",
            document.pk,
        )
        return mark_queue_unavailable(job)

    try:
        from ..tasks import ingest_document_task
    except ImportError:
        logger.exception(
            "CELERY_BROKER_URL задан, но curriculum.tasks недоступен; "
            "документ %s не поставлен в очередь",
            document.pk,
        )
        return mark_queue_unavailable(job)

    # Производные строки и Document.ingestion_status общие для всех
    # processing_version. Поэтому при деплое новой версии старое
    # поколение тоже нужно загасить, иначе оно сможет позже стереть
    # результат нового. Вызывающий enqueue уже держит document row lock.
    _supersede_other_jobs(document, keep=job)

    # `queued` ставится СРАЗУ, до отправки: между «нажал кнопку» и «воркер
    # взял задачу» может пройти время, и всё это время документ обязан выглядеть
    # как «в очереди», а не как «ничего не происходит».
    mark_queued(
        job,
        increment_retry=(
            job.status == Document.Status.FAILED or is_stale(job)
        ),
    )

    def _send() -> None:
        task_id = uuid.uuid4().hex
        claimed_at = timezone.now()
        claimed = IngestionJob.objects.filter(
            pk=job.pk,
            status=Document.Status.QUEUED,
            celery_task_id="",
        ).update(celery_task_id=task_id, updated_at=claimed_at)
        if not claimed:
            # Другой dispatch/recovery уже сменил поколение job.
            return
        job.celery_task_id = task_id
        job.updated_at = claimed_at
        try:
            ingest_document_task.apply_async(
                args=[str(document.pk)],
                kwargs={"processing_version": processing_version},
                task_id=task_id,
            )
        except Exception:  # noqa: BLE001 — ошибка публикации не должна дать 500
            logger.exception(
                "Документ %s не удалось отправить в очередь", document.pk
            )
            mark_queue_unavailable(job, expected_task_id=task_id)
            return

    # on_commit: воркер не должен увидеть документ раньше, чем транзакция вьюхи
    # зафиксирует его в базе.
    transaction.on_commit(_send)
    return job


def _supersede_other_jobs(document: Document, *, keep: IngestionJob) -> None:
    now = timezone.now()
    others = IngestionJob.objects.filter(document=document).exclude(pk=keep.pk)
    # Даже terminal-статус ещё не означает, что wrapper задачи полностью вышел:
    # после FAILED он решает вопрос о retry, а после READY дописывает метаданные
    # Document. Смена версии обязана сначала отозвать token у ВСЕХ старых jobs.
    others.update(celery_task_id="", updated_at=now)
    others.exclude(
        status__in=(Document.Status.READY, Document.Status.FAILED)
    ).update(
        status=Document.Status.FAILED,
        error_code=SUPERSEDED_ERROR_CODE,
        error_message=SUPERSEDED_MESSAGE,
        celery_task_id="",
        finished_at=now,
        updated_at=now,
    )


def mark_queued(
    job: IngestionJob,
    *,
    increment_retry: bool = False,
) -> IngestionJob:
    """Атомарно переводит job и документ в свежую чистую очередь.

    Пользовательский повтор после ошибки или stale-job учитывается при
    dispatch: к моменту исполнения Celery status уже `queued`, и сам
    ingestion отличить повтор от первой попытки не сможет.
    """

    now = timezone.now()
    previous_status = job.status
    job_update = {
        "status": Document.Status.QUEUED,
        "error_code": "",
        "error_message": "",
        "celery_task_id": "",
        "finished_at": None,
        "updated_at": now,
    }
    if increment_retry:
        job_update["retry_count"] = F("retry_count") + 1
    with transaction.atomic():
        Document.objects.select_for_update().get(pk=job.document_id)
        IngestionJob.objects.filter(pk=job.pk).update(**job_update)
        Document.objects.filter(pk=job.document_id).update(
            ingestion_status=Document.Status.QUEUED,
            updated_at=now,
        )
    job.status = Document.Status.QUEUED
    job.error_code = ""
    job.error_message = ""
    job.celery_task_id = ""
    job.finished_at = None
    job.updated_at = now
    if increment_retry:
        job.retry_count += 1
    log_ingestion_event(
        "queued",
        document_id=job.document_id,
        job_id=job.pk,
        processing_version=job.processing_version,
        from_status=previous_status,
        to_status=Document.Status.QUEUED,
        retry_count=job.retry_count,
    )
    return job


def claim_failed_retry(job: IngestionJob, *, expected_task_id: str) -> bool:
    """Атомарно захватывает право на automatic retry.

    Между возвратом failed-outcome и `self.retry()` пользователь мог уже
    запустить новое поколение. Переход разрешён только если job всё
    ещё `failed` и принадлежит именно этому Celery task id.
    """

    now = timezone.now()
    with transaction.atomic():
        Document.objects.select_for_update().get(pk=job.document_id)
        changed = IngestionJob.objects.filter(
            pk=job.pk,
            status=Document.Status.FAILED,
            celery_task_id=expected_task_id,
        ).update(
            status=Document.Status.QUEUED,
            error_code="",
            error_message="",
            finished_at=None,
            retry_count=F("retry_count") + 1,
            updated_at=now,
        )
        if changed:
            Document.objects.filter(pk=job.document_id).update(
                ingestion_status=Document.Status.QUEUED,
                updated_at=now,
            )
    if not changed:
        job.refresh_from_db()
        return False
    job.status = Document.Status.QUEUED
    job.error_code = ""
    job.error_message = ""
    job.finished_at = None
    job.retry_count += 1
    job.updated_at = now
    log_ingestion_event(
        "retry_scheduled",
        document_id=job.document_id,
        job_id=job.pk,
        processing_version=job.processing_version,
        from_status=Document.Status.FAILED,
        to_status=Document.Status.QUEUED,
        retry_count=job.retry_count,
    )
    return True


def mark_queue_unavailable(
    job: IngestionJob, *, expected_task_id: str | None = None
) -> IngestionJob:
    """Fail closed: брокера нет, поэтому тяжёлую работу не запускаем в web."""

    now = timezone.now()
    previous_status = job.status
    with transaction.atomic():
        Document.objects.select_for_update().get(pk=job.document_id)
        query = IngestionJob.objects.filter(pk=job.pk)
        if expected_task_id is not None:
            query = query.filter(
                status=Document.Status.QUEUED,
                celery_task_id=expected_task_id,
            )
        changed = query.update(
            status=Document.Status.FAILED,
            error_code=QUEUE_UNAVAILABLE_ERROR_CODE,
            error_message=QUEUE_UNAVAILABLE_MESSAGE,
            celery_task_id="",
            finished_at=now,
            updated_at=now,
        )
        if changed:
            Document.objects.filter(pk=job.document_id).update(
                ingestion_status=Document.Status.FAILED,
                updated_at=now,
            )
    if not changed:
        job.refresh_from_db()
        return job
    job.status = Document.Status.FAILED
    job.error_code = QUEUE_UNAVAILABLE_ERROR_CODE
    job.error_message = QUEUE_UNAVAILABLE_MESSAGE
    job.celery_task_id = ""
    job.finished_at = now
    job.updated_at = now
    log_ingestion_event(
        "failed",
        document_id=job.document_id,
        job_id=job.pk,
        processing_version=job.processing_version,
        from_status=previous_status,
        to_status=Document.Status.FAILED,
        retry_count=job.retry_count,
        error_code=QUEUE_UNAVAILABLE_ERROR_CODE,
    )
    return job
