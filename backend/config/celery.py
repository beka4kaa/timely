"""Celery-приложение проекта.

Очередь нужна ровно для одного: обработка учебника занимает минуты, а
`gunicorn --timeout 200` и прокси Next (180 с) столько не ждут. Контракт API
асинхронный с самого начала (202 + опрос статуса), поэтому здесь меняется только
исполнитель — ни фронтенд, ни вьюхи не трогаются.

Приложение создаётся ВСЕГДА, даже без брокера: `celery_app` импортируется в
`config/__init__.py`, и падение здесь уронило бы весь Django, включая web-часть,
которой очередь не нужна. Без `CELERY_BROKER_URL` задачи просто никто не
отправляет — за это отвечает `curriculum.services.dispatch.resolve_mode`.
"""

from __future__ import annotations

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

celery_app = Celery("timely")

# Все настройки берутся из Django с префиксом CELERY_ — держать их в двух местах
# значит однажды разойтись.
celery_app.config_from_object("django.conf:settings", namespace="CELERY")

# Задачи ищутся в `<app>/tasks.py` установленных приложений.
celery_app.autodiscover_tasks()


@celery_app.task(bind=True, name="config.debug_task")
def debug_task(self):
    """Проверка живости воркера: `celery -A config call config.debug_task`."""
    return {"request_id": self.request.id, "ok": True}
