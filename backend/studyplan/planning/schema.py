"""JSON Schema ритма для strict structured outputs.

Зачем поверх валидатора: схема снимает класс «модель прислала синоним вместо
значения enum» ДО генерации, а не после неё. Валидатор ловит смысл — выдуманную
тему, практику раньше теории; схема ловит форму.

**Про strict.** Провайдеры реализуют подмножество OpenAI structured outputs, и
там `required` обязан перечислять ВСЕ ключи `properties`, а
`additionalProperties` — быть `false` на каждом уровне. Поэтому необязательных
полей здесь нет: то, чему модели нечего сказать, она возвращает пустой строкой
или пустым списком. Числовых ограничений (`minimum`/`maximum`) тоже нет — их
поддерживают не все провайдеры, а границы всё равно проверяет валидатор.
"""

from __future__ import annotations

from typing import Any

SCHEMA_NAME = "study_pacing"


def _activity_enum() -> list[str]:
    # Значения берутся у модели данных, а не дублируются: разъехавшийся enum
    # означал бы, что схема разрешает то, что валидатор запретит, и модель
    # получит отказ за ответ, о котором её сами попросили.
    from ..models import ActivityType

    return sorted(choice.value for choice in ActivityType)


def build_pacing_schema() -> dict[str, Any]:
    lesson_part: dict[str, Any] = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "activity_type": {"type": "string", "enum": _activity_enum()},
            "duration_minutes": {
                "type": "integer",
                "description": "Длительность части в минутах.",
            },
        },
    }
    lesson_part["required"] = sorted(lesson_part["properties"])

    topic_pacing: dict[str, Any] = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "topic_id": {
                "type": "string",
                "description": "Только значение из topics[].topic_id запроса.",
            },
            "lesson_parts": {"type": "array", "items": lesson_part},
        },
    }
    topic_pacing["required"] = sorted(topic_pacing["properties"])

    weekly_day: dict[str, Any] = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "weekday": {
                "type": "integer",
                "description": "0 — понедельник, 6 — воскресенье.",
            },
            "activity_types": {
                "type": "array",
                "items": {"type": "string", "enum": _activity_enum()},
            },
            "preferred_duration_minutes": {"type": "integer"},
        },
    }
    weekly_day["required"] = sorted(weekly_day["properties"])

    milestone: dict[str, Any] = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "title": {"type": "string"},
            "after_topic_id": {
                "type": "string",
                "description": "Тема, после которой стоит точка контроля. Может быть пустой.",
            },
        },
    }
    milestone["required"] = sorted(milestone["properties"])

    schema: dict[str, Any] = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "weekly_pattern": {"type": "array", "items": weekly_day},
            "topic_pacing": {"type": "array", "items": topic_pacing},
            "milestones": {"type": "array", "items": milestone},
            "buffer_percentage": {
                "type": "number",
                "description": "Доля недели, оставленная пустой: от 0 до 0.5.",
            },
            "rationale": {"type": "string"},
        },
    }
    schema["required"] = sorted(schema["properties"])
    return schema
