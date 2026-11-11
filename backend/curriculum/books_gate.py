"""Загрузка и разбор книг выключаются одной настройкой.

На старте книг в продакшене нет: разбор учебника — это OCR страниц, эмбеддинги и
несколько проходов модели. Спрятать кнопку на клиенте недостаточно: адреса остаются
открытыми, и старая вкладка или прямой запрос продолжают тратить деньги. Чтение,
список, статус и удаление уже загруженных книг остаются доступны.
"""

from __future__ import annotations

from django.conf import settings
from rest_framework import status
from rest_framework.exceptions import APIException


class BooksDisabled(APIException):
    status_code = status.HTTP_404_NOT_FOUND
    # Тело в форме остальных ответов этого приложения: {"error", "code"}.
    default_detail = {
        "error": "Загрузка книг сейчас выключена.",
        "code": "books_disabled",
    }
    default_code = "books_disabled"


def require_books() -> None:
    if not settings.BOOKS_ENABLED:
        raise BooksDisabled()
