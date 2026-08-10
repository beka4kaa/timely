"""JSON Schema профиля раздела для strict structured outputs.

Как и в схеме плана: `required` перечисляет все ключи, `additionalProperties`
всюду `false`. Провайдеры принимают только такое подмножество, а «необязательное
поле» модель обязана вернуть пустым списком или пустой строкой.

Статистику содержимого модель не заполняет — число задач и формул считает
backend по своим же таблицам. Спрашивать это у модели значит просить её
пересчитать то, что у нас лежит строками.
"""

from __future__ import annotations

from typing import Any

from ..planning.validation import ALLOWED_DIFFICULTY

SCHEMA_NAME = "section_profile"

SECTION_PROFILE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "summary": {
            "type": "string",
            "description": "Одно-два предложения: о чём раздел.",
        },
        "concepts": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Понятия, которые раздел ВВОДИТ. Не всё упомянутое.",
        },
        "skills": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "Что ученик сможет ДЕЛАТЬ после раздела. Формулировка через "
                "действие: «находить работу постоянной силы»."
            ),
        },
        "prerequisites": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Что нужно знать ДО раздела. Понятия, не разделы.",
        },
        "difficulty": {"type": "string", "enum": sorted(ALLOWED_DIFFICULTY)},
        "is_teachable": {
            "type": "boolean",
            "description": (
                "false, если раздел не учебный: список ответов, таблицы "
                "констант, предметный указатель, только упражнения без теории."
            ),
        },
    },
}
SECTION_PROFILE_SCHEMA["required"] = sorted(SECTION_PROFILE_SCHEMA["properties"])
