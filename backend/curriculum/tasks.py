"""Celery-задачи curriculum.

Модуль намеренно тонкий: вся логика живёт в `services.ingestion`, здесь только
переход через границу брокера и политика повторов.

**Границу пересекает исключительно UUID.** Ни модель, ни байты файла, ни
`Document` в задачу не передаются. Причины две, и обе практические: объект,
сериализованный при постановке, к моменту исполнения уже устарел (обработка
идёт минутами, статус за это время меняется), а PDF на десятки мегабайт в теле
сообщения превратил бы Redis в файловое хранилище.

**Про повторы.** Ретраятся ТОЛЬКО типизированные временные отказы. Битый PDF,
неподдерживаемый формат, неизвестная внутренняя ошибка и ошибка парсера —
постоянные: повтор даст тот же результат, но может второй раз оплатить OCR.
Источник правды — `error_code`, который пайплайн уже записал в job; текст
исключения для классификации не используется. Ошибка публикации в Redis живёт
раньше этой задачи и обрабатывается в `services.dispatch`.
"""

from __future__ import annotations

import logging

from celery import shared_task
from celery.exceptions import Retry
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from ai_engine.usage import (
    AIUsageLimitExceeded,
    usage_reservation,
    usage_scope,
)

from .models import PROCESSING_VERSION, Document, IngestionAttempt, IngestionJob
from .observability import log_ingestion_event
from .services.dispatch import claim_failed_retry, mark_queue_unavailable
from .services.ingestion import ingest_document
from .services.section_profiles import profile_document_sections

logger = logging.getLogger(__name__)

# Коды, при которых повтор имеет смысл. Всё остальное — свойство самого файла
# или конфигурации, и от повтора не изменится.
TRANSIENT_ERROR_CODES = frozenset(
    {
        "storage_unavailable",  # R2 или сеть до него
    }
)

# Сколько раз повторяем. Три — это «пережить перезапуск соседнего сервиса», а не
# «дожать неработающее»: очередь с бесконечными повторами превращается в
# генератор нагрузки на уже упавший сервис.
MAX_RETRIES = 3
# Пауза удваивается: 30 с, 60 с, 120 с. Мгновенный повтор попадает ровно в тот
# же сбой, что и первая попытка.
RETRY_BACKOFF_SECONDS = 30
QUOTA_ERROR_CODE = "ai_usage_limit_exceeded"
QUOTA_ERROR_MESSAGE = (
    "Лимит AI-токенов исчерпан. Дождитесь обновления лимита."
)


@shared_task(
    bind=True,
    name="curriculum.ingest_document",
    # Подтверждение ПОСЛЕ выполнения позволяет отличить штатное завершение от
    # потерянного процесса. Автоматической доставки после OOM ниже нет.
    acks_late=True,
    # Потерянный воркер не должен отправлять задачу в автоматический reject-цикл:
    # документ остаётся незавершённым, `/status/` покажет stalled, а повторный
    # запуск остаётся осознанным действием пользователя.
    reject_on_worker_lost=False,
    ignore_result=True,
    max_retries=MAX_RETRIES,
)
def ingest_document_task(
    self, document_id: str, processing_version: str = PROCESSING_VERSION
):
    """Обрабатывает документ по идентификатору.

    Результата не возвращает: хранилище результата — это `IngestionJob`, его и
    опрашивает фронтенд. Поэтому и `CELERY_RESULT_BACKEND` в проекте не нужен.

    `ingest_document` сам не выпускает исключения наружу — ошибку он пишет в
    статус `failed` и `error_code`. Поэтому решение о повторе принимается по
    коду в джобе, а не по перехваченному исключению.
    """
    document = Document.objects.filter(pk=document_id).first()
    if document is None:
        # Документ удалили, пока задача ждала в очереди. Это не ошибка.
        logger.info("Документ %s исчез до начала обработки — задача пропущена", document_id)
        return

    task_id = str(self.request.id or "")
    queued_job = IngestionJob.objects.filter(
        document=document,
        processing_version=processing_version,
    ).first()
    run_token = ""
    if task_id:
        if queued_job is None:
            # Production dispatch всегда создаёт job и пишет task id ДО
            # publish. Сообщение без такой строки не имеет fencing-токена
            # и не должно запускать тяжёлый пайплайн.
            logger.warning(
                "Celery-задача %s для документа %s не имеет job — пропускаем",
                task_id,
                document_id,
            )
            return
        # Dispatch пишет id в БД до publish. Если Redis принял
        # сообщение, но продюсер вернул ошибку, job уже закрыт как
        # queue_unavailable. Поздно дошедшая задача не должна его воскрешать.
        if queued_job.celery_task_id != task_id:
            logger.info(
                "Celery-задача %s для документа %s уже заменена — пропускаем",
                task_id,
                document_id,
            )
            return
        run_token = task_id

    try:
        with usage_reservation(
            document.user_email,
            reserved_tokens=max(
                1,
                int(
                    getattr(
                        settings,
                        "CURRICULUM_INGESTION_AI_RESERVATION_TOKENS",
                        8000,
                    )
                ),
            ),
            feature="curriculum_ingestion",
            reservation_kind="admission",
        ):
            with usage_scope(
                user_email=document.user_email,
                feature="curriculum_ingestion",
            ):
                outcome = ingest_document(
                    document,
                    processing_version=processing_version,
                    run_token=run_token,
                )
    except AIUsageLimitExceeded as exc:
        logger.info(
            "Документ %s не запущен: AI-квота исчерпана (%s)",
            document_id,
            exc.window,
        )
        _mark_quota_denied(
            document,
            processing_version,
            expected_task_id=run_token,
        )
        return
    except Exception:  # noqa: BLE001 — воркер не должен падать из-за книги
        # Неизвестное исключение нельзя честно назвать временным. Автоматически
        # повторять его опасно: сбой мог случиться после платного OCR.
        logger.exception("Обработка документа %s упала неожиданно", document_id)
        _mark_unexpected_failure(
            document,
            processing_version,
            expected_task_id=run_token,
        )
        return

    job = outcome.job
    if not outcome.claimed:
        return
    if job.status != Document.Status.FAILED:
        _enqueue_profiling(document_id, processing_version)
        return

    if job.error_code not in TRANSIENT_ERROR_CODES:
        logger.warning(
            "Документ %s: постоянная ошибка %s — повторять бессмысленно",
            document_id,
            job.error_code,
        )
        return

    if self.request.retries >= MAX_RETRIES:
        logger.warning(
            "Документ %s: временная ошибка %s не ушла за %s попыток",
            document_id,
            job.error_code,
            MAX_RETRIES,
        )
        return

    logger.info(
        "Документ %s: временная ошибка %s, повтор %s из %s",
        document_id,
        job.error_code,
        self.request.retries + 1,
        MAX_RETRIES,
    )
    retry_task_id = run_token or job.celery_task_id
    if not _mark_retrying(job, expected_task_id=retry_task_id):
        return
    try:
        raise self.retry(countdown=_countdown(self.request.retries))
    except Retry:
        raise
    except Exception:  # noqa: BLE001 — publish повтора тоже ходит в Redis
        logger.exception(
            "Повтор для документа %s не удалось опубликовать",
            document_id,
        )
        mark_queue_unavailable(
            job,
            expected_task_id=job.celery_task_id or None,
        )
        return


def _countdown(retries: int) -> int:
    """30 с, 60 с, 120 с."""
    return RETRY_BACKOFF_SECONDS * (2**retries)


def _mark_retrying(job: IngestionJob, *, expected_task_id: str) -> bool:
    """Возвращает джоб в очередь, чтобы интерфейс не показывал «Ошибка».

    Пользователю рано видеть отказ: система ещё пытается. Показать ошибку и
    через минуту снова показать прогресс — худший вариант из возможных.
    """
    return claim_failed_retry(job, expected_task_id=expected_task_id)


def _mark_unexpected_failure(
    document: Document,
    processing_version: str,
    *,
    expected_task_id: str = "",
) -> None:
    """Фиксирует безопасную причину, не раскрывая exception пользователю."""

    now = timezone.now()
    job, _ = IngestionJob.objects.get_or_create(
        document=document,
        processing_version=processing_version,
        defaults={"user_email": document.user_email},
    )
    with transaction.atomic():
        Document.objects.select_for_update().get(pk=document.pk)
        jobs = IngestionJob.objects.filter(pk=job.pk)
        if expected_task_id:
            jobs = jobs.filter(celery_task_id=expected_task_id)
        changed = jobs.update(
            status=Document.Status.FAILED,
            error_code="internal_error",
            error_message="Во время обработки произошла внутренняя ошибка.",
            finished_at=now,
            updated_at=now,
        )
        if changed:
            Document.objects.filter(pk=document.pk).update(
                ingestion_status=Document.Status.FAILED,
                updated_at=now,
            )


def _mark_quota_denied(
    document: Document,
    processing_version: str,
    *,
    expected_task_id: str = "",
) -> bool:
    """Persist a fenced terminal result when the worker cannot reserve quota."""

    job, _ = IngestionJob.objects.get_or_create(
        document=document,
        processing_version=processing_version,
        defaults={"user_email": document.user_email},
    )
    now = timezone.now()
    with transaction.atomic():
        Document.objects.select_for_update().get(pk=document.pk)
        locked = IngestionJob.objects.select_for_update().get(pk=job.pk)
        if expected_task_id and (
            locked.status != Document.Status.QUEUED
            or locked.celery_task_id != expected_task_id
        ):
            return False
        if locked.status in (Document.Status.READY, Document.Status.FAILED):
            return False

        previous_status = locked.status
        IngestionJob.objects.filter(pk=locked.pk).update(
            status=Document.Status.FAILED,
            error_code=QUOTA_ERROR_CODE,
            error_message=QUOTA_ERROR_MESSAGE,
            celery_task_id="",
            finished_at=now,
            updated_at=now,
        )
        IngestionAttempt.objects.create(
            job=locked,
            from_status=previous_status,
            to_status=Document.Status.FAILED,
            succeeded=False,
            error_code=QUOTA_ERROR_CODE,
            error_message=QUOTA_ERROR_MESSAGE,
            duration_ms=0,
        )
        Document.objects.filter(pk=document.pk).update(
            ingestion_status=Document.Status.FAILED,
            updated_at=now,
        )

    log_ingestion_event(
        "failed",
        document_id=document.pk,
        job_id=job.pk,
        processing_version=processing_version,
        from_status=previous_status,
        to_status=Document.Status.FAILED,
        retry_count=job.retry_count,
        error_code=QUOTA_ERROR_CODE,
    )
    return True


@shared_task(
    bind=True,
    name="curriculum.profile_document_sections",
    acks_late=True,
    reject_on_worker_lost=False,
    ignore_result=True,
    max_retries=0,
)
def profile_document_sections_task(
    self, document_id: str, processing_version: str = PROCESSING_VERSION
):
    """Профилирует разделы обработанной книги.

    Отдельной задачей, а не частью ingestion: профилирование ходит в модель
    десятки раз, и его отказ не должен превращать успешно разобранную книгу в
    непригодную. Без профилей план строится по заголовкам — как строился до
    появления этого шага.

    Повторов нет намеренно. Кэш по содержимому делает следующий запуск дешёвым,
    а профили пересобираются при следующем обращении к книге; автоматический
    повтор здесь означал бы вторую оплату тех же вызовов.
    """
    document = Document.objects.filter(pk=document_id).first()
    if document is None:
        return

    with usage_scope(
        user_email=document.user_email, feature="curriculum_section_profiling"
    ):
        report = profile_document_sections(
            document, processing_version=processing_version
        )

    logger.info(
        "Профилирование документа %s: %s", document_id, report.as_dict()
    )


def _enqueue_profiling(document_id: str, processing_version: str) -> None:
    """Ставит профилирование в очередь. Отказ брокера здесь не критичен.

    Книга уже обработана и пригодна к планированию. Уронить успешную ingestion
    из-за недоступного Redis на необязательном шаге нельзя.
    """
    try:
        profile_document_sections_task.delay(str(document_id), processing_version)
    except Exception as exc:  # noqa: BLE001 — брокер, сеть, конфигурация
        logger.warning(
            "Профилирование документа %s не поставлено в очередь: %s",
            document_id,
            exc,
        )
