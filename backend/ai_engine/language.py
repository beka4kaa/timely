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
    """Правило для системного промпта. Для русского пусто: промпты и так на русском."""
    if language == "en":
        return (
            "The student's interface is in English. Reply in English, even though these "
            "instructions, the student's data and the books may be in Russian. If the student "
            "writes in another language, reply in that language."
        )
    return ""
