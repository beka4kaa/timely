"""Удаление посетителей, которые не заходили дольше срока демо."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Q

from accounts.models import CustomUser

from .identity import visitors_q
from .visitor import wipe_user_rows

logger = logging.getLogger("demo.prune")


def _stale(cutoff: datetime) -> Q:
    """Давно не собирался. `last_login` — отметка последней сборки; пусто — ни разу."""
    return Q(last_login__lt=cutoff) | Q(last_login__isnull=True, date_joined__lt=cutoff)


def prune_visitors(now: datetime, *, limit: int | None = None, keep: str | None = None) -> int:
    """Удаляет посетителей, не заходивших дольше `DEMO_VISITOR_TTL_DAYS`, со всеми их строками.

    Мир (учитель и одноклассники) не трогается: его адреса не подходят под шаблон
    посетителя. Строку, которую прямо сейчас пересобирает вход этого посетителя,
    чистка пропускает, а не ждёт: сборка держит её с начала, и ожидание друг друга
    кончилось бы взаимной блокировкой. Ошибка с одним посетителем пишется в лог и не
    мешает остальным. Возвращает, сколько посетителей ушло.
    """
    cutoff = now - timedelta(days=settings.DEMO_VISITOR_TTL_DAYS)
    rows = CustomUser.objects.filter(visitors_q()).filter(_stale(cutoff)).order_by("date_joined")
    if keep:
        rows = rows.exclude(email=keep)
    if limit is not None:
        rows = rows[:limit]
    removed = 0
    for pk in list(rows.values_list("pk", flat=True)):
        try:
            with transaction.atomic():
                # Условие проверяется ещё раз под блокировкой: посетитель мог вернуться.
                user = (
                    CustomUser.objects.select_for_update(skip_locked=True)
                    .filter(visitors_q(), _stale(cutoff), pk=pk)
                    .first()
                )
                if user is None:
                    continue
                wipe_user_rows(user.email, keep_usage=False)
                user.delete()
            removed += 1
        except Exception:  # noqa: BLE001 — чистка не должна ронять вход в демо
            logger.exception("demo.prune_failed user_id=%s", pk)
    return removed
