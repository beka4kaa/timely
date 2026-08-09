"""Пакет конфигурации проекта.

`celery_app` импортируется здесь, а не где-то ещё: Celery находит приложение по
`config.celery_app`, а декоратор `@shared_task` работает только если приложение
создано к моменту импорта задач. Без этой строки задачи молча регистрируются в
пустоту, и воркер отвечает `Received unregistered task`.

Импорт мягкий: `celery` — зависимость воркера, и web-контейнер обязан
подниматься даже там, где её не поставили.
"""

try:
    from .celery import celery_app
except ImportError:  # pragma: no cover — celery не установлен
    celery_app = None

__all__ = ("celery_app",)
