"""
Типизированные инструменты тьютора (PRODUCT.md §5.7).

Принцип из §5.7: «Каждый инструмент валидирует JSON на backend. Модель не
получает прямого доступа к базе или произвольным системным действиям». Поэтому:

* у каждого инструмента объявлена схема, и аргументы проверяются СТРОГО —
  неизвестное поле, неверный тип или значение вне enum отклоняются, а не
  приводятся молча к чему-то похожему (AGENTS.md: строгая валидация на границе
  LLM → backend);
* инструмент возвращает данные, а не текст: педагогику пишет модель, факты
  считает backend;
* ошибка инструмента — это тоже результат, а не исключение: модель должна
  получить «тема не найдена» и продолжить разговор, а не уронить запрос ученика.

Чистые части (`normalize_answer`, `answers_match`) отделены от работы с БД
специально: сравнение ответов — самое ценное для проверки и не должно требовать
базы.

Чего здесь СОЗНАТЕЛЬНО нет: `search_student_library` и `show_source` (нужен RAG,
Этап 3), `generate_practice` (нужна платформа задач, Этап 4),
`get_prerequisites` (нужен граф §6.2, а `mind.Topic` пока контент на
пользователя), `propose_schedule_change` (Этап 2). Заглушки вместо них были бы
хуже отсутствия: модель звала бы инструмент, который ничего не знает.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, Callable

from django.utils import timezone

from .learning_events import (
    SYSTEMIC_ERROR_COUNT,
    apply_learning_event,
    normalize_error_type,
    refresh_skill_state,
    resolve_display_status,
)
from .models import ACTIVITY_CHOICES, ERROR_TYPE_CHOICES, RESULT_CHOICES, SkillState

logger = logging.getLogger(__name__)

# Сколько раз подряд модель может позвать инструмент в одном сообщении.
# Ограничение существует, потому что модель умеет зацикливаться на «проверю ещё
# раз», а каждый круг — это отдельный оплаченный запрос.
MAX_TOOL_ROUNDS = 3

_ACTIVITY_VALUES = tuple(value for value, _ in ACTIVITY_CHOICES)
_RESULT_VALUES = tuple(value for value, _ in RESULT_CHOICES)
_ERROR_VALUES = tuple(value for value, _ in ERROR_TYPE_CHOICES)


@dataclass(frozen=True)
class ToolContext:
    """Контекст, который инструменту даёт backend, а НЕ модель.

    Модель не может выбрать другого пользователя или другую тему: и то и другое
    приходит из запроса и сессии. Иначе «инструмент» стал бы способом читать
    чужие данные по подсказке в промпте.
    """

    user_email: str = ""
    topic: Any = None
    mode: str = ""


@dataclass(frozen=True)
class TutorTool:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[[dict[str, Any], ToolContext], dict[str, Any]]

    def as_tool(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


class ToolValidationError(ValueError):
    """Аргументы инструмента не прошли проверку."""


# ──────────────────────────────────────────────────────────────────────────────
# Валидация аргументов
# ──────────────────────────────────────────────────────────────────────────────


def validate_args(raw: Any, schema: dict[str, Any]) -> dict[str, Any]:
    """Проверить аргументы по схеме инструмента.

    Умышленно маленький валидатор вместо новой зависимости: нужны ровно четыре
    правила — объект, известные поля, обязательные поля, тип и enum. Всё
    остальное в схемах инструментов не используется.

    Неизвестные поля именно ОТКЛОНЯЮТСЯ, а не игнорируются: молча проглоченное
    поле означает, что модель считает, будто передала нам что-то важное, а мы
    это выбросили — такие расхождения потом ищут в логах часами.
    """
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise ToolValidationError("аргументы должны быть объектом")

    properties: dict[str, Any] = schema.get("properties", {})
    required: list[str] = schema.get("required", [])

    unknown = sorted(set(raw) - set(properties))
    if unknown:
        raise ToolValidationError(f"неизвестные поля: {', '.join(unknown)}")

    missing = [name for name in required if raw.get(name) in (None, "")]
    if missing:
        raise ToolValidationError(f"не хватает обязательных полей: {', '.join(missing)}")

    cleaned: dict[str, Any] = {}
    for name, spec in properties.items():
        if name not in raw or raw[name] is None:
            continue
        value = raw[name]
        expected = spec.get("type")

        if expected == "string":
            if not isinstance(value, str):
                raise ToolValidationError(f"поле {name} должно быть строкой")
            value = value.strip()
        elif expected == "integer":
            # bool — подкласс int в Python, поэтому проверяем отдельно: True в
            # поле hint_level это ошибка модели, а не «уровень 1».
            if isinstance(value, bool) or not isinstance(value, int):
                raise ToolValidationError(f"поле {name} должно быть целым числом")
        elif expected == "number":
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ToolValidationError(f"поле {name} должно быть числом")

        choices = spec.get("enum")
        if choices and value not in choices:
            raise ToolValidationError(
                f"поле {name}: значение {value!r} не входит в допустимые"
            )

        minimum = spec.get("minimum")
        if minimum is not None and isinstance(value, (int, float)) and value < minimum:
            raise ToolValidationError(f"поле {name} не может быть меньше {minimum}")

        cleaned[name] = value

    return cleaned


# ──────────────────────────────────────────────────────────────────────────────
# check_answer: детерминированное сравнение
# ──────────────────────────────────────────────────────────────────────────────

# Юникодные минусы и подобия равенства, которые модель и ученик пишут вперемешку.
_MINUS_VARIANTS = {"−": "-", "–": "-", "—": "-"}
_STRIP_CHARS = re.compile(r"[\s ]+")
_TRAILING_PUNCT = re.compile(r"[.,;:!?)\]]+$")


def normalize_answer(text: Any) -> str:
    """Привести ответ к сравнимому виду. Чистая функция."""
    value = str(text if text is not None else "")
    for bad, good in _MINUS_VARIANTS.items():
        value = value.replace(bad, good)
    value = _STRIP_CHARS.sub("", value)
    value = _TRAILING_PUNCT.sub("", value)
    return value.casefold()


def _as_number(text: str) -> float | None:
    """Число из ответа или None. Запятая как десятичный разделитель — норма."""
    candidate = text.replace(",", ".")
    # Отбрасываем единицы измерения только если остаток — чистое число:
    # «5м» → 5, но «5м2с» числом не считаем.
    match = re.fullmatch(r"[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?", candidate)
    if not match:
        return None
    try:
        return float(candidate)
    except ValueError:
        return None


def answers_match(
    student: Any, expected: Any, tolerance: float = 1e-6
) -> tuple[bool, str]:
    """Совпадают ли ответы. Возвращает (совпало, как сравнивали).

    Числа сравниваются как числа: «0,5», «0.5» и «.5» — один ответ, а
    строковое равенство сказало бы «неверно». Это ровно та проверка, которую
    §3.3 запрещает оставлять на усмотрение модели без верификации.
    """
    student_text = normalize_answer(student)
    expected_text = normalize_answer(expected)

    if not expected_text:
        return False, "нет эталонного ответа"

    student_number = _as_number(student_text)
    expected_number = _as_number(expected_text)

    if student_number is not None and expected_number is not None:
        # Относительный допуск для больших чисел, абсолютный — около нуля.
        scale = max(1.0, abs(expected_number))
        matched = abs(student_number - expected_number) <= tolerance * scale
        return matched, "числовое сравнение"

    return student_text == expected_text, "текстовое сравнение"


# ──────────────────────────────────────────────────────────────────────────────
# Обработчики инструментов
# ──────────────────────────────────────────────────────────────────────────────


def _require_topic(context: ToolContext) -> dict[str, Any] | None:
    """Общая проверка: инструменту нужна тема, а её может не быть."""
    if context.topic is None:
        return {
            "ok": False,
            "error": "no_topic",
            "message": (
                "Тема занятия не определена, поэтому прогресс записать некуда. "
                "Продолжай объяснять, состояние навыка не изменится."
            ),
        }
    return None


def _state_payload(state: SkillState | None, now=None) -> dict[str, Any]:
    if state is None:
        return {"status": "NOT_STARTED", "evidence_count": 0}
    return {
        "status": resolve_display_status(state.status, state.next_review_at, now),
        "mastery_probability": round(state.mastery_probability, 3),
        "confidence": round(state.confidence, 3),
        "success_count": state.success_count,
        "fail_count": state.fail_count,
        "hint_count": state.hint_count,
        "evidence_count": state.evidence_count,
        "common_errors": state.common_errors or {},
        "next_review_at": state.next_review_at.isoformat() if state.next_review_at else None,
    }


def _handle_get_topic_state(args: dict[str, Any], context: ToolContext) -> dict[str, Any]:
    problem = _require_topic(context)
    if problem:
        return problem
    state = SkillState.objects.filter(
        user_email=context.user_email, topic=context.topic
    ).first()
    return {
        "ok": True,
        "topic": getattr(context.topic, "name", ""),
        **_state_payload(state),
    }


def _handle_save_learning_event(args: dict[str, Any], context: ToolContext) -> dict[str, Any]:
    problem = _require_topic(context)
    if problem:
        return problem

    event, state = apply_learning_event(
        user_email=context.user_email,
        topic=context.topic,
        mode=context.mode,
        activity=args.get("activity", "explanation"),
        result=args.get("result", "completed"),
        error_type=args.get("error_type", ""),
        hint_level=args.get("hint_level", 0),
        duration_seconds=args.get("duration_seconds", 0),
        confidence_before=args.get("confidence_before"),
        confidence_after=args.get("confidence_after"),
        source="tutor_tool",
    )
    if event is None:
        return {"ok": False, "error": "not_recorded", "message": "Событие записать не удалось."}
    return {"ok": True, "recorded": True, **_state_payload(state)}


def _handle_classify_error(args: dict[str, Any], context: ToolContext) -> dict[str, Any]:
    """Тип ошибки проходит через перечень §6.8 и проверяется на системность.

    Возвращаем не только нормализованный тип, но и `systemic`: одна ошибка знака
    — случайность, третья подряд — пробел, и следующая интервенция должна быть
    другой (§6.8: «Ошибка определяет следующую учебную интервенцию»).
    """
    normalized = normalize_error_type(args.get("error_type"))
    payload: dict[str, Any] = {
        "ok": True,
        "error_type": normalized,
        "recognized": normalized not in ("", "unknown"),
    }

    if context.topic is not None and context.user_email:
        state = SkillState.objects.filter(
            user_email=context.user_email, topic=context.topic
        ).first()
        seen = (state.common_errors or {}).get(normalized, 0) if state else 0
        payload["times_seen"] = seen
        payload["systemic"] = seen + 1 >= SYSTEMIC_ERROR_COUNT
    return payload


def _handle_schedule_review(args: dict[str, Any], context: ToolContext) -> dict[str, Any]:
    """Назначить следующее повторение тем же расчётом, что и ручное повторение."""
    from mind.srs import next_review  # локальный импорт: ai_engine → mind только здесь

    problem = _require_topic(context)
    if problem:
        return problem

    topic = context.topic
    outcome = next_review(
        rating=args.get("rating", "GOOD"),
        status=getattr(topic, "status", "NOT_STARTED"),
        interval_days=getattr(topic, "interval_days", None),
        ease_factor=getattr(topic, "ease_factor", None),
    )
    now = timezone.now()
    due = now + timedelta(days=outcome.interval_days)

    topic.status = outcome.status
    topic.last_revised_at = now
    topic.next_review_at = due
    topic.ease_factor = outcome.ease_factor
    topic.interval_days = outcome.interval_days
    topic.save()

    # Состояние навыка хранит свою дату повторения: страница слабых тем читает
    # Topic, а тьютор — SkillState, и расходиться они не должны.
    state = refresh_skill_state(user_email=context.user_email, topic=topic)
    if state is not None:
        state.next_review_at = due
        state.save(update_fields=["next_review_at", "updated_at"])

    return {
        "ok": True,
        "interval_days": outcome.interval_days,
        "next_review_at": due.isoformat(),
        "topic_status": outcome.status,
    }


def _handle_check_answer(args: dict[str, Any], context: ToolContext) -> dict[str, Any]:
    tolerance = args.get("tolerance", 1e-6)
    matched, method = answers_match(
        args.get("student_answer", ""), args.get("expected_answer", ""), tolerance
    )
    return {
        "ok": True,
        "correct": matched,
        "method": method,
        "student_answer": str(args.get("student_answer", "")),
        "expected_answer": str(args.get("expected_answer", "")),
    }


# ──────────────────────────────────────────────────────────────────────────────
# Реестр
# ──────────────────────────────────────────────────────────────────────────────

TUTOR_TOOLS: dict[str, TutorTool] = {
    tool.name: tool
    for tool in (
        TutorTool(
            name="get_topic_state",
            description=(
                "Узнать, что ученик уже умеет по текущей теме: статус освоения, "
                "число верных и неверных попыток, типичные ошибки, дату повторения. "
                "Вызывай ПЕРЕД тем как выбрать сложность объяснения или задачи."
            ),
            parameters={"type": "object", "properties": {}},
            handler=_handle_get_topic_state,
        ),
        TutorTool(
            name="save_learning_event",
            description=(
                "Записать в журнал результат учебного действия ученика: решил, ошибся, "
                "повторил, воспользовался подсказкой. Вызывай ПОСЛЕ того как проверил "
                "ответ, один раз на одно действие."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "activity": {
                        "type": "string",
                        "enum": list(_ACTIVITY_VALUES),
                        "description": "Что делал ученик.",
                    },
                    "result": {
                        "type": "string",
                        "enum": list(_RESULT_VALUES),
                        "description": "Чем закончилось.",
                    },
                    "error_type": {
                        "type": "string",
                        "enum": list(_ERROR_VALUES),
                        "description": "Тип ошибки, если результат неверный.",
                    },
                    "hint_level": {
                        "type": "integer",
                        "minimum": 0,
                        "description": "Ступень подсказки, которой воспользовался ученик.",
                    },
                    "duration_seconds": {"type": "integer", "minimum": 0},
                    "confidence_before": {"type": "number"},
                    "confidence_after": {"type": "number"},
                },
                "required": ["activity", "result"],
            },
            handler=_handle_save_learning_event,
        ),
        TutorTool(
            name="classify_error",
            description=(
                "Определить ТИП ошибки ученика из закрытого списка и узнать, повторяется "
                "ли она. Вызывай после неверного ответа: от типа зависит, что делать "
                "дальше — вернуться к основанию или просто пересчитать."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "error_type": {
                        "type": "string",
                        "enum": list(_ERROR_VALUES),
                        "description": "Тип ошибки из списка.",
                    },
                    "evidence": {
                        "type": "string",
                        "description": "Короткая цитата из ответа ученика, по которой видно ошибку.",
                    },
                },
                "required": ["error_type"],
            },
            handler=_handle_classify_error,
        ),
        TutorTool(
            name="schedule_review",
            description=(
                "Назначить следующее повторение темы по тому, насколько уверенно ученик "
                "её воспроизвёл. Вызывай в конце повторения, один раз."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "rating": {
                        "type": "string",
                        "enum": ["AGAIN", "HARD", "GOOD", "EASY"],
                        "description": (
                            "AGAIN — не вспомнил, HARD — с трудом, GOOD — вспомнил, "
                            "EASY — сразу и уверенно."
                        ),
                    }
                },
                "required": ["rating"],
            },
            handler=_handle_schedule_review,
        ),
        TutorTool(
            name="check_answer",
            description=(
                "Сравнить ответ ученика с правильным ТОЧНО, арифметикой, а не на глаз. "
                "Вызывай всегда, когда ответ — число или формула: «0,5» и «0.5» это один "
                "ответ, и решать это должен не ты."
            ),
            parameters={
                "type": "object",
                "properties": {
                    "student_answer": {"type": "string", "description": "Что ответил ученик."},
                    "expected_answer": {"type": "string", "description": "Верный ответ."},
                    "tolerance": {
                        "type": "number",
                        "minimum": 0,
                        "description": "Относительный допуск, по умолчанию 1e-6.",
                    },
                },
                "required": ["student_answer", "expected_answer"],
            },
            handler=_handle_check_answer,
        ),
    )
}


def tool_schemas(names: tuple[str, ...] | list[str]) -> list[dict[str, Any]]:
    """Схемы перечисленных инструментов (неизвестные имена пропускаются)."""
    return [TUTOR_TOOLS[name].as_tool() for name in names if name in TUTOR_TOOLS]


def run_tutor_tool(
    name: str, raw_args: Any, context: ToolContext | None = None
) -> dict[str, Any]:
    """Выполнить инструмент и вернуть результат для модели.

    Никогда не бросает: любая проблема возвращается как `{"ok": False, ...}`,
    потому что этот словарь уходит модели как tool-result. Исключение здесь
    оборвало бы ответ ученику из-за того, что модель неверно заполнила поле.
    """
    tool = TUTOR_TOOLS.get(name)
    if tool is None:
        return {"ok": False, "error": "unknown_tool", "message": f"Инструмент {name} не существует."}

    ctx = context or ToolContext()
    try:
        args = validate_args(raw_args, tool.parameters)
    except ToolValidationError as exc:
        logger.warning("[tutor_tools] %s: невалидные аргументы: %s", name, exc)
        return {"ok": False, "error": "invalid_arguments", "message": str(exc)}

    try:
        return tool.handler(args, ctx)
    except Exception as exc:  # noqa: BLE001 — сбой инструмента не должен рвать урок
        logger.exception("[tutor_tools] %s упал", name)
        return {"ok": False, "error": "tool_failed", "message": str(exc)}


def resolve_topic(user_email: str, topic_name: str) -> Any:
    """Найти тему ученика по названию.

    Ищем только среди тем ЭТОГО пользователя: `mind.Topic` висит на
    `Subject.user_email`, поэтому одноимённые темы у разных учеников — разные
    строки, и брать первую попавшуюся значило бы писать прогресс чужому.
    """
    name = (topic_name or "").strip()
    if not name or not user_email:
        return None
    try:
        from mind.models import Topic

        candidates = Topic.objects.filter(subject__user_email=user_email).order_by("created_at")

        exact = candidates.filter(name=name).first()
        if exact is not None:
            return exact

        # Регистронезависимое сравнение делаем в Python, а НЕ через `name__iexact`.
        # `iexact` на SQLite опирается на LIKE, который приводит регистр только
        # для ASCII: «второй закон ньютона» не находил «Второй закон Ньютона»,
        # хотя на PostgreSQL (это прод) тот же запрос работает. Такая разница
        # между локальной базой и продом — худший вид расхождения, поэтому
        # сравниваем сами и одинаково везде. Тем у одного ученика десятки, цена
        # перебора несопоставима с ценой «на моей машине работало».
        target = name.casefold()
        for topic in candidates:
            if (topic.name or "").strip().casefold() == target:
                return topic
        return None
    except Exception:  # noqa: BLE001 — отсутствие темы не повод ронять чат
        logger.exception("[tutor_tools] не удалось найти тему %r", topic_name)
        return None
