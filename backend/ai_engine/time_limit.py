"""Мягкий предел времени задачи Celery внутри чужих исключений.

Celery доставляет мягкий предел сигналом: `SoftTimeLimitExceeded` бросается
там, где сейчас стоит главный поток. У долгой задачи это почти всегда ожидание
ответа модели внутри SDK `openai`, а SDK оборачивает любое исключение запроса в
`APIConnectionError` и кладёт исходное в `__cause__`. Широкий `except` поэтому
видит не предел, а «сбой связи», и задача идёт дальше до жёсткого убийства.
Помощник ищет предел по всей цепочке, чтобы такой `except` мог отдать его
дальше.
"""

from __future__ import annotations

from celery.exceptions import SoftTimeLimitExceeded


def hit_time_limit(exc: BaseException | None) -> bool:
    """`True`, если `exc` — мягкий предел или он есть в `__cause__`/`__context__`."""

    seen: set[int] = set()
    pending = [exc]
    while pending:
        current = pending.pop()
        if current is None or id(current) in seen:
            continue
        if isinstance(current, SoftTimeLimitExceeded):
            return True
        seen.add(id(current))
        pending.append(current.__cause__)
        pending.append(current.__context__)
    return False
