"""Защита ИИ в демо: только собранные аккаунты, потолок на адрес и общий бюджет на сутки.

Личность в демо выдаётся без пароля, поэтому лимита одного посетителя мало: можно
завести сколько угодно личностей и спрашивать модель, ни разу не открыв демо. Поэтому
запросы к модели в демо проходят три проверки:

* аккаунт уже собран через `/api/demo/start/`, иначе 403;
* с одного адреса не больше `DEMO_AI_REQUESTS_PER_IP_PER_DAY` запросов в сутки (UTC);
* все аккаунты демо вместе за последние сутки потратили меньше
  `DEMO_DAILY_TOKEN_BUDGET` токенов.

Остальное демо при отказе работает как обычно.
"""

from __future__ import annotations

import re
from datetime import datetime, time, timedelta, timezone as dt_timezone

from django.conf import settings
from django.db.models import Sum
from django.http import JsonResponse
from django.utils import timezone

from accounts.models import CustomUser
from ai_engine.middleware import _is_metered_request
from ai_engine.models import AIUsageEvent

from .limits import client_ip, take_slot

WINDOW = timedelta(hours=24)
BUDGET_MESSAGE = "Демо-лимит ИИ на сегодня закончился. Всё остальное в демо работает, а тьютор вернётся позже."
ADDRESS_MESSAGE = (
    "С этого адреса сегодня было слишком много вопросов к ИИ. Всё остальное в демо работает, "
    "а тьютор вернётся завтра."
)
NOT_STARTED_MESSAGE = "Сначала открой демо: тьютор отвечает только в собранном демо-аккаунте."

# Модель зовут и пути, которых нет в учёте ai_engine: там они считаются внутри вьюх.
EXTRA_PATTERNS = (
    # Помощник плана.
    re.compile(r"^/api/studyplan/chat/stream/?$"),
    # Название чата пишет текстовая модель.
    re.compile(r"^/api/curriculum/chats/[0-9a-fA-F-]+/title/?$"),
    # Расписание по программе, когда задан SCHEDULE_PLANNING_MODEL.
    re.compile(r"^/api/study-schedules/generate/?$"),
)


def is_ai_request(method: str, path: str) -> bool:
    if _is_metered_request(method, path):
        return True
    return method.upper() == "POST" and any(pattern.match(path) for pattern in EXTRA_PATTERNS)


def budget_reset_at(now):
    """Когда расход за сутки опустится ниже бюджета. None — бюджет не исчерпан."""
    since = now - WINDOW
    rows = AIUsageEvent.objects.filter(created_at__gte=since)
    spent = rows.aggregate(total=Sum("billable_tokens"))["total"] or 0
    budget = settings.DEMO_DAILY_TOKEN_BUDGET
    if spent < budget:
        return None
    # Самые старые расходы выходят из окна первыми.
    for created_at, tokens in rows.order_by("created_at").values_list("created_at", "billable_tokens"):
        spent -= tokens
        if spent < budget:
            return created_at + WINDOW
    return now + WINDOW


def _was_seeded(email: str | None) -> bool:
    return bool(email) and CustomUser.objects.filter(email=email, last_login__isnull=False).exists()


def _limit(message: str, window: str, reset_at) -> JsonResponse:
    return JsonResponse(
        {
            "error": message,
            # Тот же код, что у личного лимита: клиент уже умеет его показывать.
            "code": "ai_usage_limit_exceeded",
            "window": window,
            "reset_at": reset_at.isoformat(),
        },
        status=429,
    )


def refusal(request):
    """Ответ вместо запроса к модели или None, если запрос можно пропустить."""
    if not _was_seeded(getattr(request, "user_email", None)):
        return JsonResponse({"error": NOT_STARTED_MESSAGE, "code": "demo_not_started"}, status=403)
    now = timezone.now()
    reset_at = budget_reset_at(now)
    if reset_at is not None:
        return _limit(BUDGET_MESSAGE, "demo_day", reset_at)
    day = now.astimezone(dt_timezone.utc).date()
    if not take_slot(f"demo:ai:{client_ip(request)}:{day:%Y%m%d}", settings.DEMO_AI_REQUESTS_PER_IP_PER_DAY, 24 * 3600):
        midnight = datetime.combine(day + timedelta(days=1), time(0), tzinfo=dt_timezone.utc)
        return _limit(ADDRESS_MESSAGE, "demo_ip_day", midnight)
    return None


class DemoDailyBudgetMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if settings.DEMO_MODE and is_ai_request(request.method, request.path):
            answer = refusal(request)
            if answer is not None:
                return answer
        return self.get_response(request)
