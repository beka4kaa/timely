"""Язык ответа модели.

Интерфейс кабинета бывает русским и английским. Выбор приходит заголовком
`X-Timely-Lang` (его ставит src/lib/auth-fetch.ts, только для английского). Промпты
написаны по-русски, поэтому без правила модель склонна отвечать по-русски даже тому,
у кого интерфейс английский.
"""

from __future__ import annotations

LANGUAGE_HEADER = "X-Timely-Lang"
SUPPORTED_LANGUAGES = ("ru", "en")
DEFAULT_LANGUAGE = "ru"


def request_language(request) -> str:
    """Язык интерфейса ученика: «ru» или «en». Нет заголовка или он чужой — русский."""
    value = (request.headers.get(LANGUAGE_HEADER) or "").strip().lower()
    return value if value in SUPPORTED_LANGUAGES else DEFAULT_LANGUAGE


def answer_language_rule(language: str) -> str:
    """Правило для системного промпта. Для русского пусто: промпты и так на русском.

    Отвечать на языке ученика: кто пишет по-русски с английским интерфейсом, ждёт ответа
    по-русски. Интерфейс решает, только если язык сообщения не понять.
    """
    if language == "en":
        return (
            "Reply in the language the student writes in. The student's interface is in English, "
            "so if you cannot tell the language of the message (for example, only numbers or a "
            "command), reply in English. These instructions, the student's data and the books may "
            "be in Russian: that does not choose the language of the reply."
        )
    return ""
