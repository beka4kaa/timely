"""Celery-задачи curriculum.

Модуль намеренно тонкий: вся логика живёт в `services.ingestion` и
`services.embedding_index`, здесь только переход через границу брокера и
политика повторов. Задач две: обработка книги и починка недостающих векторов.

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
from contextlib import nullcontext
from time import monotonic

from celery import shared_task
from celery.exceptions import Retry, SoftTimeLimitExceeded
from django.db import transaction
from django.utils import timezone

from ai_engine.time_limit import hit_time_limit
from ai_engine.usage import AIUsageLimitExceeded, usage_scope

from .embeddings import EMBEDDING_FEATURE
from .models import PROCESSING_VERSION, Document, IngestionAttempt, IngestionJob
from .observability import log_ingestion_event
from .services.dispatch import (
    RUNNING_STATUSES,
    _stale_after,
    claim_failed_retry,
    is_stale,
    mark_queue_unavailable,
)
from .services.embedding_index import (
    VECTOR_REPAIR_STATUSES,
    IndexOutcome,
    index_document_chunks,
    repair_embedding_provider,
)
from .services.ingestion import (
    TIMED_OUT_ERROR_CODE,
    TIMED_OUT_MESSAGE,
    ingest_document,
)
from .services.pulse import job_pulse

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

# Сколько один запуск починки векторов держит воркер: min(120 с, 0.4 порога
# зависания). Воркер один, а у починки нет пульса: книга, вставшая за ней в
# очередь, без живого джоба через порог выглядела бы зависшей. При пороге 300 с
# это 120 с, и даже с последней пачкой (до 60 с) запуск кончается задолго до
# порога. Остаток книги уходит продолжением в конец очереди.
VECTOR_REPAIR_RUN_SECONDS = 120
VECTOR_REPAIR_RUN_SHARE_OF_STALE = 0.4


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

    # Входного резерва нет (решение 12): книга с текстом лимит не тратит, а
    # распознавание сканов резервирует своё само. Пульс идёт, пока работает
    # конвейер: по нему видно, что книга жива.
    pulse = (
        job_pulse(queued_job.pk, run_token=run_token) if run_token else nullcontext()
    )
    try:
        with usage_scope(
            user_email=document.user_email,
            feature="curriculum_ingestion",
        ), pulse:
            outcome = ingest_document(
                document,
                processing_version=processing_version,
                run_token=run_token,
            )
    except AIUsageLimitExceeded as exc:
        logger.info(
            "Документ %s остановлен: AI-квота исчерпана (%s)",
            document_id,
            exc.window,
        )
        _mark_quota_denied(
            document,
            processing_version,
            expected_task_id=run_token,
        )
        return
    except SoftTimeLimitExceeded:
        # Запасной путь: предел обычно ловит сам конвейер и пишет `timed_out`
        # с попыткой. Сюда он доходит, только если сработал вне конвейера.
        logger.warning(
            "Документ %s остановлен по пределу времени вне конвейера", document_id
        )
        _mark_unexpected_failure(
            document,
            processing_version,
            expected_task_id=run_token,
            error_code=TIMED_OUT_ERROR_CODE,
            error_message=TIMED_OUT_MESSAGE,
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
    # Главы книги разбираются при составлении программы, а не здесь
    # (решение 14): так их не оплачивает каждая загрузка.
    if job.status != Document.Status.FAILED:
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
    error_code: str = "internal_error",
    error_message: str = "Во время обработки произошла внутренняя ошибка.",
) -> None:
    """Фиксирует безопасную причину, не раскрывая exception пользователю.

    Тем же путём закрывается джоб, до обёртки которого дошёл предел часа: тогда
    причина — `timed_out`.

    Закрытый джоб не трогается: готовая книга остаётся готовой, а точная
    причина провала, которую уже записал конвейер, не становится «внутренней
    ошибкой». Сбой или предел могут прийти и после того, как всё записано.
    """

    now = timezone.now()
    job, _ = IngestionJob.objects.get_or_create(
        document=document,
        processing_version=processing_version,
        defaults={"user_email": document.user_email},
    )
    with transaction.atomic():
        Document.objects.select_for_update().get(pk=document.pk)
        jobs = IngestionJob.objects.filter(pk=job.pk).exclude(
            status__in=(Document.Status.READY, Document.Status.FAILED)
        )
        if expected_task_id:
            jobs = jobs.filter(celery_task_id=expected_task_id)
        changed = jobs.update(
            status=Document.Status.FAILED,
            error_code=error_code,
            error_message=error_message,
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
    """Закрывает джоб этого запуска, если вызов модели получил отказ лимита.

    Закрывается и начатый джоб, а не только ждущий в очереди: иначе он висел
    бы, пока его не признают зависшим (решение 15). Чужое поколение (другой
    `celery_task_id`) не трогаем.
    """

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
            locked.celery_task_id != expected_task_id
            or (
                locked.status != Document.Status.QUEUED
                and locked.status not in RUNNING_STATUSES
            )
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
    name="curriculum.embed_missing_chunks",
    acks_late=True,
    # Повторов нет: остаток заберёт продолжение или следующая починка.
    max_retries=0,
    ignore_result=True,
)
def embed_missing_chunks_task(self, document_id: str):
    """Дописывает векторы кускам готовой книги в PENDING и FAILED (решение 11).

    Ставит её `request_vector_repair` из поиска, не чаще раза в 10 минут на
    книгу. Воркер один, поэтому запуск его не держит (`_RepairStop`): уступает
    книге в очереди, кончается на первой упавшей пачке или когда книга уже не
    готова, и останавливается у границы `_repair_run_seconds()`. Пачка ждёт
    провайдера 60 с и пробует один раз (`repair_embedding_provider`). Если запуск
    остановился по времени или ради книги, успев что-то записать, остаток той
    же книги уходит продолжением в конец очереди.
    """
    stop = _RepairStop(document_id)
    document = Document.objects.filter(
        pk=document_id, ingestion_status=Document.Status.READY
    ).first()
    if document is None:
        # Книгу удалили или поставили на повторную обработку, пока задача
        # ждала в очереди: её старые куски чинить незачем.
        logger.info(
            "Починка векторов документа %s пропущена: книга не готова", document_id
        )
        return
    try:
        with usage_scope(user_email=document.user_email, feature=EMBEDDING_FEATURE):
            outcome = index_document_chunks(
                document,
                provider=repair_embedding_provider(),
                only_statuses=VECTOR_REPAIR_STATUSES,
                should_stop=stop,
            )
        logger.info(
            "Починка векторов документа %s: записано %s, не удалось %s, остановка: %s",
            document_id,
            outcome.touched,
            outcome.failed,
            stop.reason or "нет",
        )
        if stop.continues(outcome):
            _queue_repair_continuation(document_id)
    except SoftTimeLimitExceeded:
        # Записанное остаётся, остаток заберёт следующая починка. Задача
        # выходит сама, не дожидаясь жёсткого предела.
        logger.warning(
            "Починка векторов документа %s остановлена пределом времени", document_id
        )


class _RepairStop:
    """`should_stop` запуска починки: когда отдать воркер.

    Спрашивается перед каждой платной пачкой, причина остаётся в `reason`:

    * `batch_failed` — пачка упала. Провайдер болеет, остаток заберёт следующая
      починка, не раньше чем через 10 минут.
    * `book_not_ready` — книгу удалили или поставили на повторную обработку:
      её куски уходят, и платить за их векторы незачем.
    * `time_is_up` — до границы запуска (`_repair_run_seconds`) осталось
      меньше, чем шла самая долгая пачка этого запуска. Пачка меряется между
      вызовами, поэтому первая идёт всегда: без неё запуск ничего бы не сделал.
    * `book_waiting` — в очереди книга, которую `dispatch.is_stale` ещё
      прикрывает (`_a_book_waits_for_the_worker`).
    """

    def __init__(self, document_id: str) -> None:
        self.reason = ""
        self._document_id = document_id
        # Порог читается при запуске: его задаёт окружение.
        self._budget = _repair_run_seconds()
        self._started = monotonic()
        self._previous: float | None = None
        self._longest_batch = 0.0

    def __call__(self, outcome: IndexOutcome) -> bool:
        if outcome.failed:
            self.reason = "batch_failed"
            return True
        if not Document.objects.filter(
            pk=self._document_id, ingestion_status=Document.Status.READY
        ).exists():
            self.reason = "book_not_ready"
            return True
        now = monotonic()
        if self._previous is not None:
            self._longest_batch = max(self._longest_batch, now - self._previous)
            if now - self._started + self._longest_batch > self._budget:
                self.reason = "time_is_up"
                return True
        self._previous = now
        if _a_book_waits_for_the_worker():
            self.reason = "book_waiting"
            return True
        return False

    def continues(self, outcome: IndexOutcome) -> bool:
        """Продолжение нужно после остановки не из-за сбоя, если запуск что-то записал.

        Запуск, уступивший воркер до первой записи, продолжения не ставит:
        иначе при свежем джобе, чьё сообщение потеряно или отложено повтором,
        два запуска гоняли бы друг друга вхолостую до порога зависания.
        """
        return self.reason in ("time_is_up", "book_waiting") and outcome.touched > 0


def _repair_run_seconds() -> float:
    """Граница одного запуска починки: min(120 с, 0.4 порога зависания)."""

    return min(
        float(VECTOR_REPAIR_RUN_SECONDS),
        VECTOR_REPAIR_RUN_SHARE_OF_STALE * _stale_after().total_seconds(),
    )


def _a_book_waits_for_the_worker() -> bool:
    """В очереди книга, которую `dispatch.is_stale` ещё не считает зависшей.

    Только джобы с токеном задачи: их сообщение ушло в брокер, и воркер до него
    дойдёт. Свежую книгу прикрывает её возраст, а прождавшую дольше порога —
    книга, закончившая недавно. Пока этот щит держится, книгу за починкой
    нельзя пускать к порогу. Без щита (воркер простаивал, сообщение потеряно)
    книга и так зависшая, и уступка ей не поможет.
    """

    waiting = (
        IngestionJob.objects.filter(status=Document.Status.QUEUED)
        .exclude(celery_task_id="")
        .order_by("-updated_at")
    )
    return any(not is_stale(job) for job in waiting)


def _queue_repair_continuation(document_id: str) -> None:
    """Остаток той же книги — в конец очереди, за книгами, что ждут воркер.

    Это продолжение начатой починки, а не новая просьба: десятиминутный ключ
    `request_vector_repair` здесь не проверяется и не продлевается.
    """
    try:
        embed_missing_chunks_task.apply_async(args=[document_id], retry=False)
    except SoftTimeLimitExceeded:
        raise
    except Exception as exc:  # noqa: BLE001 — остаток заберёт следующая починка
        if hit_time_limit(exc):
            raise SoftTimeLimitExceeded() from exc
        logger.warning(
            "Продолжение починки векторов документа %s не поставлено в очередь: %s",
            document_id,
            exc,
        )
