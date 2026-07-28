"""Единый маппинг ошибок LLM-провайдера в HTTP-ответы.

Раньше эта логика была скопирована трижды (chat_views, solve_views, draw_views)
и различала ошибки по подстроке в тексте исключения. Из-за этого 404 «модель не
найдена» и 401 «плохой ключ» приезжали пользователю одинаково — как
«Ошибка AI: <сырой текст провайдера>», а в логах не было ни класса исключения,
ни адреса, куда мы вообще стучались.

Показательный случай: прод отдавал «Модель не ответила вовремя» (504), хотя
модель была жива — запросы просто уходили на недостижимый Tailscale-адрес.
Поэтому здесь мы, во-первых, различаем ошибки по КЛАССУ исключения, а
во-вторых, всегда логируем base_url.
"""

from __future__ import annotations

import logging
from typing import Any

from rest_framework import status
from rest_framework.response import Response

logger = logging.getLogger(__name__)

# openai может быть не установлен в отдельных окружениях (тесты рендерера),
# а импорт на уровне модуля не должен ронять приложение целиком.
try:  # pragma: no cover - тривиальный импорт
    from openai import (
        APIConnectionError,
        APITimeoutError,
        AuthenticationError,
        BadRequestError,
        NotFoundError,
        RateLimitError,
    )
except Exception:  # pragma: no cover - openai недоступен
    APIConnectionError = APITimeoutError = AuthenticationError = ()  # type: ignore[assignment]
    BadRequestError = NotFoundError = RateLimitError = ()  # type: ignore[assignment]


def _as_tuple(exc_type: Any) -> tuple:
    """Пустой плейсхолдер выше — это (), и isinstance с ним всегда False."""
    return exc_type if isinstance(exc_type, tuple) else (exc_type,)


def llm_error_response(exc: Exception, *, base_url: str | None = None, model: str | None = None) -> Response:
    """Ошибки провайдера → понятные HTTP-коды и текст для UI."""
    error_msg = str(exc)
    lowered = error_msg.lower()

    logger.error(
        "[llm] %s при обращении к base_url=%r model=%r: %s",
        type(exc).__name__,
        base_url,
        model,
        error_msg,
    )

    # Сначала по классу исключения — это надёжнее подстроки.
    if isinstance(exc, _as_tuple(RateLimitError)) or "429" in error_msg:
        return Response(
            {"error": "Модель перегружена (rate limit). Подождите немного и попробуйте снова."},
            status=status.HTTP_429_TOO_MANY_REQUESTS,
        )
    if isinstance(exc, _as_tuple(AuthenticationError)):
        return Response(
            {"error": "AI-сервис отклонил ключ доступа. Проверьте настройки сервера."},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    if isinstance(exc, _as_tuple(NotFoundError)):
        return Response(
            {"error": f"Модель {model or ''} недоступна у провайдера. Проверьте настройки сервера.".strip()},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    if isinstance(exc, _as_tuple(APITimeoutError)) or "timeout" in lowered or "timed out" in lowered:
        return Response(
            {"error": "Модель не ответила вовремя. Попробуйте ещё раз."},
            status=status.HTTP_504_GATEWAY_TIMEOUT,
        )
    # APIConnectionError проверяем ПОСЛЕ таймаута: APITimeoutError наследуется
    # от него, и обратный порядок превратил бы любой таймаут в 503.
    if isinstance(exc, _as_tuple(APIConnectionError)) or "connection" in lowered:
        return Response(
            {"error": "Не удалось связаться с моделью (сетевая ошибка). Попробуйте ещё раз."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )
    if isinstance(exc, _as_tuple(BadRequestError)):
        return Response(
            {"error": f"AI-сервис отклонил запрос: {error_msg}"},
            status=status.HTTP_502_BAD_GATEWAY,
        )
    return Response({"error": f"Ошибка AI: {error_msg}"}, status=status.HTTP_502_BAD_GATEWAY)
