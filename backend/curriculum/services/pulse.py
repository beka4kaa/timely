"""Пульс обработки книги из фонового потока.

Зависание книги считается по пульсу, а не по общему времени (решение 15):
работающий джоб, который дольше `CURRICULUM_INGEST_STALE_AFTER_SECONDS` не
двигал `updated_at`, считается мёртвым (`dispatch.is_stale`). Раньше пульс
слали только распознавание и векторы, а разбор структуры или запись большой
книги молчали минутами. Поток бьёт сам, какой бы ни была фаза.

Поток пишет только `updated_at` джоба своего запуска (`celery_task_id`) и
блокировку документа не берёт: поколение запуска она защищает в конвейере, а
пульсу ждать долгую запись незачем. Заменённый запуск ничего не обновит, и
поток выйдет. Ошибка базы пульс не гасит: одна оборванная связь иначе сделала бы
живую книгу «прервавшейся» через несколько минут, а перезапуск снова заплатил
бы за распознавание.
"""

from __future__ import annotations

import logging
import threading
from contextlib import contextmanager
from typing import Iterator

from django.conf import settings
from django.db import connection
from django.db.utils import Error as DBError
from django.utils import timezone

from ..models import IngestionJob

logger = logging.getLogger(__name__)

DEFAULT_PULSE_SECONDS = 60
# Сколько блок ждёт поток на выходе. Обычно ждать нечего: удар — один UPDATE.
# Но удар, повисший на мёртвом соединении, не должен держать воркер после конца
# книги. Остановленный поток после такого удара больше не бьёт и выходит сам.
JOIN_TIMEOUT_SECONDS = 10


def _beat(job_id, run_token: str) -> int:
    """Один удар пульса. Возвращает число обновлённых строк: 0 — запуск заменён."""

    return IngestionJob.objects.filter(pk=job_id, celery_task_id=run_token).update(
        updated_at=timezone.now()
    )


def _pulse(job_id, run_token: str, interval: float, stop: threading.Event) -> None:
    try:
        while not stop.wait(interval):
            try:
                # По имени модуля на каждом ударе: так его подменяют тесты.
                beaten = _beat(job_id, run_token)
            except DBError as exc:
                # Любая ошибка базы, `InterfaceError` тоже: он не подкласс
                # `DatabaseError`, а сосед.
                logger.warning(
                    "Пульс джоба %s не записан, следующий через %s с: %s",
                    job_id,
                    interval,
                    exc,
                )
                # Следующий удар откроет свежее соединение.
                connection.close()
                continue
            if not beaten:
                logger.info(
                    "Пульс джоба %s остановлен: запуск %s заменён", job_id, run_token
                )
                return
    except Exception:
        # Пульс гаснет, и через порог книгу сочтут зависшей: причина должна
        # остаться в логе, а не только в stderr потока.
        logger.exception("Пульс джоба %s остановлен неожиданной ошибкой", job_id)
    finally:
        # Соединение этого потока больше никому не нужно.
        connection.close()


@contextmanager
def job_pulse(
    job_id,
    *,
    run_token: str,
    interval_seconds: float | None = None,
) -> Iterator[None]:
    """Пока идёт блок, раз в интервал двигает `updated_at` джоба этого запуска.

    Поток-демон: упавший процесс воркера его не держит. На выходе из блока
    поток останавливается, и блок ждёт его не дольше `JOIN_TIMEOUT_SECONDS`.
    Новых ударов после блока нет, но удар, начатый до выхода, может
    закончиться позже: он пишет только строку своего запуска.
    """

    interval = float(
        interval_seconds
        if interval_seconds is not None
        else getattr(settings, "CURRICULUM_INGEST_PULSE_SECONDS", DEFAULT_PULSE_SECONDS)
    )
    stop = threading.Event()
    thread = threading.Thread(
        target=_pulse,
        args=(job_id, run_token, interval, stop),
        name=f"ingest-pulse-{job_id}",
        daemon=True,
    )
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join(JOIN_TIMEOUT_SECONDS)
