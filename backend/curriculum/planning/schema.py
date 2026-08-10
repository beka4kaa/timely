"""JSON Schema плана курса для strict structured outputs.

Зачем это поверх уже существующего `validate_plan`. Валидатор ловит ошибку
ПОСЛЕ того, как модель отработала: план с русским словом «средняя» вместо
`"medium"` стоит полного вызова, отправляется на починку и стоит второго. Схема
снимает этот класс ошибок на стороне провайдера — до генерации, а не после.

Что схема НЕ заменяет:

* `validate_plan` — галлюцинированные `source_chunk_ids`, циклы в
  `prerequisites`, покрытие оглавления, опасные вставки. Схема про форму, а не
  про смысл;
* `normalize_enum_fields` и таблицы синонимов в `services/plans.py` — роль может
  быть переставлена на модель или провайдера без strict-поддержки, а fake- и
  fixture-провайдеры схему не проходят вовсе.

**Про strict.** Провайдеры реализуют подмножество OpenAI structured outputs, и
там `required` обязан перечислять ВСЕ ключи `properties`, а
`additionalProperties` — быть `false` на каждом уровне. Поэтому «необязательных»
полей здесь нет: то, что модели нечем заполнить, она обязана вернуть пустой
строкой или пустым списком. Проверено живым вызовом
`minimax/minimax-m3` (12 модулей, 37 тем, enum'ы в порядке).
"""

from __future__ import annotations

from typing import Any

# Значения не дублируются, а берутся у валидатора: разъехавшийся enum означает,
# что схема разрешает то, что валидатор запретит, и модель получит отказ за
# ответ, о котором её сами попросили.
from .validation import ALLOWED_BALANCE, ALLOWED_DIFFICULTY, ALLOWED_REVIEW

SCHEMA_NAME = "course_plan"

_TOPIC_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "external_id": {
            "type": "string",
            "description": "Короткий идентификатор темы внутри плана.",
        },
        "title": {"type": "string"},
        "objective": {
            "type": "string",
            "description": "Чему ученик научится в этой теме.",
        },
        "estimated_minutes": {"type": "integer"},
        "difficulty": {"type": "string", "enum": sorted(ALLOWED_DIFFICULTY)},
        "suggested_lesson_count": {"type": "integer"},
        "theory_practice_balance": {
            "type": "string",
            "enum": sorted(ALLOWED_BALANCE),
        },
        "mastery_criteria": {
            "type": "string",
            "description": "Как понять, что тема освоена. Пустая строка допустима.",
        },
        "review_strategy": {"type": "string", "enum": sorted(ALLOWED_REVIEW)},
        "prerequisites": {
            "type": "array",
            "items": {"type": "string"},
            "description": "external_id тем ЭТОГО же плана. Циклы запрещены.",
        },
        "source_chunk_ids": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Только значения из available_chunk_ids.",
        },
        "source_section_ids": {
            "type": "array",
            "items": {"type": "string"},
            "description": (
                "Разделы книги, из которых собрана тема. Только значения из "
                "available_section_ids. Тема, объединяющая три параграфа, "
                "перечисляет все три."
            ),
        },
    },
}
_TOPIC_SCHEMA["required"] = sorted(_TOPIC_SCHEMA["properties"])

_MODULE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "external_id": {"type": "string"},
        "title": {"type": "string"},
        "objective": {"type": "string"},
        "estimated_minutes": {"type": "integer"},
        "completion_criteria": {"type": "string"},
        "milestone": {"type": "string"},
        "topics": {"type": "array", "items": _TOPIC_SCHEMA},
    },
}
_MODULE_SCHEMA["required"] = sorted(_MODULE_SCHEMA["properties"])

COURSE_PLAN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "title": {"type": "string"},
        "objective": {"type": "string"},
        "rationale": {
            "type": "string",
            "description": "Почему программа построена именно так.",
        },
        "modules": {"type": "array", "items": _MODULE_SCHEMA},
    },
}
COURSE_PLAN_SCHEMA["required"] = sorted(COURSE_PLAN_SCHEMA["properties"])
