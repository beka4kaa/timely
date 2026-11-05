"""Научная доска выключается одной настройкой.

На старте её в продакшене нет: схема — это несколько проходов модели и генерация
картинки, и за один вопрос уходит на порядок больше токенов, чем в чате. Спрятать
кнопку на клиенте недостаточно: дорогие адреса остаются открытыми, и старая вкладка
или прямой запрос продолжают тратить деньги.
"""

from __future__ import annotations

from django.conf import settings
from rest_framework import status
from rest_framework.exceptions import APIException


class BoardDisabled(APIException):
    status_code = status.HTTP_404_NOT_FOUND
    default_detail = "Научная доска сейчас выключена."
    default_code = "board_disabled"


def require_board() -> None:
    if not settings.BOARD_ENABLED:
        raise BoardDisabled()


class BoardRequiredMixin:
    """Закрывает вьюху, пока доска выключена. Авторизация уже прошла: `initial` родителя."""

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        require_board()
