"""Кто в демо посетитель, а кто часть выдуманного мира.

Адреса посетителей выдаёт фронтенд демо (`visitor-<uuid>@demo.timely-plan.study`),
адреса мира заводит `demo.world`. Модуль ничего не импортирует из приложений, чтобы
`accounts` мог взять отсюда фильтр рейтинга без круговой зависимости.
"""

from __future__ import annotations

import re

from django.db.models import Q

DEMO_DOMAIN = "demo.timely-plan.study"
VISITOR_PREFIX = "visitor-"
VISITOR_RE = re.compile(r"^visitor-[0-9a-f-]{8,64}@demo\.timely-plan\.study$")

TEACHER_EMAIL = f"teacher@{DEMO_DOMAIN}"


def classmate_email(number: int) -> str:
    return f"classmate-{number:02d}@{DEMO_DOMAIN}"


def is_visitor_email(email: str | None) -> bool:
    return bool(email) and bool(VISITOR_RE.match(email))


def visitors_q() -> Q:
    """Строки `CustomUser` всех посетителей демо."""
    return Q(email__startswith=VISITOR_PREFIX, email__endswith=f"@{DEMO_DOMAIN}")
