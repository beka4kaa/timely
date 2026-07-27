"""Adaptive, fail-open intake for a whiteboard lesson plan.

The text model may choose one short semantic follow-up question.  It never
owns UI state or lesson geometry: Django signs the session, validates the
question, and builds the final ``LessonPlan`` deterministically.
"""

from __future__ import annotations

import json
import logging
import re
import time
import uuid
from difflib import SequenceMatcher
from typing import Any

from django.conf import settings
from django.core import signing

from .skills.clarify import _is_other_option
from .text_llm import TextModel

logger = logging.getLogger(__name__)

SESSION_SALT = "timely.planning-intake.v1"
SESSION_MAX_AGE_SECONDS = 2 * 60 * 60
MODEL_OPTION_LIMIT = 3
QUESTION_ID_RE = re.compile(r"^[a-z][a-z0-9_]{1,39}$")

GOALS = {
    "understand": ("Понять тему", "Разобраться в идее и увидеть связи."),
    "solve": ("Решать задачи", "Освоить понятный алгоритм решения."),
    "prepare": ("Подготовиться", "Собрать тему и проверить готовность."),
}
RESULT_TYPES = {
    "understand": "Объяснение на доске",
    "solve_problem": "Решение конкретной задачи",
    "prepare": "Подготовка и проверка",
}
LEVELS = {
    "foundation": "С нуля",
    "school": "Знаком с темой",
    "advanced": "Углублённо",
}
BASE_ANSWER_KEYS = {
    "topic",
    "goal",
    "result_type",
    "level",
    "duration_minutes",
}
DISALLOWED_MODEL_KEYS = {
    "svg",
    "raw_svg",
    "path",
    "path_data",
    "points",
    "coordinates",
    "x",
    "y",
    "html",
}
STYLE_WORDS = {
    "стиль",
    "цвет",
    "палитр",
    "шрифт",
    "оформлен",
    "style",
    "color",
    "font",
    "palette",
}


class PlanningIntakeValidationError(ValueError):
    """Malformed or tampered intake request."""


class PlanningModelOutputError(ValueError):
    """The planning model returned a response outside the strict contract."""


def _setting_bool(name: str, default: bool) -> bool:
    value = getattr(settings, name, default)
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _max_questions() -> int:
    try:
        value = int(getattr(settings, "PLANNING_MAX_QUESTIONS", 4))
    except (TypeError, ValueError):
        value = 4
    return min(4, max(1, value))


def _compact_text(value: Any, limit: int) -> str:
    if not isinstance(value, (str, int, float)):
        return ""
    return " ".join(str(value).split())[:limit]


def _unsafe_text(value: str) -> bool:
    lowered = value.casefold()
    return (
        "<script" in lowered
        or "<svg" in lowered
        or "<html" in lowered
        or "foreignobject" in lowered
        or "javascript:" in lowered
        or "data:" in lowered
        or "http://" in lowered
        or "https://" in lowered
    )


def _sanitize_answers(raw: Any) -> dict[str, str | int]:
    if raw in (None, ""):
        return {}
    if not isinstance(raw, dict):
        raise PlanningIntakeValidationError("answers должен быть объектом")
    if len(raw) > 12:
        raise PlanningIntakeValidationError("Слишком много ответов intake")

    answers: dict[str, str | int] = {}
    for raw_key, raw_value in raw.items():
        key = str(raw_key or "").strip()
        if key not in BASE_ANSWER_KEYS and not QUESTION_ID_RE.fullmatch(key):
            raise PlanningIntakeValidationError(f"Недопустимый id ответа: {key!r}")

        if key == "duration_minutes":
            try:
                duration = int(raw_value)
            except (TypeError, ValueError) as exc:
                raise PlanningIntakeValidationError(
                    "duration_minutes должен быть числом"
                ) from exc
            if not 10 <= duration <= 180:
                raise PlanningIntakeValidationError(
                    "duration_minutes должен быть от 10 до 180"
                )
            answers[key] = duration
            continue

        value = _compact_text(raw_value, 240 if key == "topic" else 120)
        if not value or _unsafe_text(value):
            raise PlanningIntakeValidationError(f"Недопустимое значение {key}")
        answers[key] = value

    goal = answers.get("goal")
    if goal is not None and goal not in GOALS:
        raise PlanningIntakeValidationError("Неизвестная цель урока")
    result_type = answers.get("result_type")
    if result_type is not None and result_type not in RESULT_TYPES:
        raise PlanningIntakeValidationError("Неизвестный тип результата")
    level = answers.get("level")
    if level is not None and level not in LEVELS:
        raise PlanningIntakeValidationError("Неизвестный уровень")
    return answers


def _sanitize_asked_ids(raw: Any) -> list[str]:
    if raw in (None, ""):
        return []
    if not isinstance(raw, list):
        raise PlanningIntakeValidationError("asked_question_ids должен быть массивом")
    result: list[str] = []
    for item in raw[: _max_questions()]:
        question_id = str(item or "").strip()
        if not QUESTION_ID_RE.fullmatch(question_id):
            raise PlanningIntakeValidationError("Некорректный id заданного вопроса")
        if question_id not in result:
            result.append(question_id)
    return result


def _issue_session_id() -> str:
    return signing.dumps(
        {
            "type": "planning_intake",
            "version": 1,
            "nonce": uuid.uuid4().hex,
            "issued_at": int(time.time()),
        },
        salt=SESSION_SALT,
        compress=True,
    )


def _verify_session_id(value: Any) -> str:
    session_id = str(value or "").strip()
    if not session_id:
        return _issue_session_id()
    try:
        payload = signing.loads(
            session_id,
            salt=SESSION_SALT,
            max_age=SESSION_MAX_AGE_SECONDS,
        )
    except signing.BadSignature as exc:
        raise PlanningIntakeValidationError(
            "Сессия планирования недействительна. Начните настройку заново."
        ) from exc
    if (
        not isinstance(payload, dict)
        or payload.get("type") != "planning_intake"
        or payload.get("version") != 1
    ):
        raise PlanningIntakeValidationError("Неверный тип сессии планирования")
    return session_id


def _parse_json_object(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        if start < 0:
            raise PlanningModelOutputError("Planner не вернул JSON")
        try:
            value, _ = json.JSONDecoder().raw_decode(text[start:])
        except json.JSONDecodeError as exc:
            raise PlanningModelOutputError("Planner вернул повреждённый JSON") from exc
    if not isinstance(value, dict):
        raise PlanningModelOutputError("Planner должен вернуть JSON-объект")
    return value


def _walk_for_unsafe_geometry(value: Any) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).casefold()
            if normalized in DISALLOWED_MODEL_KEYS:
                raise PlanningModelOutputError(
                    f"Planner не может задавать геометрию: {key}"
                )
            _walk_for_unsafe_geometry(child)
    elif isinstance(value, list):
        for child in value:
            _walk_for_unsafe_geometry(child)
    elif isinstance(value, str) and _unsafe_text(value):
        raise PlanningModelOutputError("Planner вернул небезопасный текст")


def _normalized_label(value: str) -> str:
    return re.sub(r"[^a-zа-яё0-9]+", " ", value.casefold()).strip()


def _validate_question(
    payload: dict[str, Any],
    *,
    answers: dict[str, str | int],
    asked_ids: list[str],
) -> dict[str, Any] | None:
    _walk_for_unsafe_geometry(payload)
    if set(payload) - {"status", "question"}:
        raise PlanningModelOutputError("Planner вернул неизвестные поля")
    status_value = payload.get("status")
    if status_value == "complete":
        if payload.get("question") not in (None, {}):
            raise PlanningModelOutputError("Complete-ответ не должен содержать вопрос")
        return None
    if status_value != "question":
        raise PlanningModelOutputError("Неизвестный статус planner")

    raw_question = payload.get("question")
    if not isinstance(raw_question, dict):
        raise PlanningModelOutputError("Поле question обязательно")
    if set(raw_question) - {"id", "text", "options"}:
        raise PlanningModelOutputError("Вопрос содержит неизвестные поля")

    question_id = _compact_text(raw_question.get("id"), 40)
    text = _compact_text(raw_question.get("text"), 180)
    if not QUESTION_ID_RE.fullmatch(question_id):
        raise PlanningModelOutputError("Некорректный id вопроса")
    if question_id in asked_ids or question_id in answers:
        raise PlanningModelOutputError("Planner повторил уже заданный вопрос")
    if not text or _unsafe_text(text):
        raise PlanningModelOutputError("Пустой или небезопасный вопрос")
    if any(word in text.casefold() for word in STYLE_WORDS):
        raise PlanningModelOutputError("Planner спросил про оформление")

    raw_options = raw_question.get("options")
    if not isinstance(raw_options, list):
        raise PlanningModelOutputError("options должен быть массивом")

    options: list[dict[str, str]] = []
    seen_ids: set[str] = set()
    seen_labels: list[str] = []
    for raw_option in raw_options:
        if not isinstance(raw_option, dict):
            raise PlanningModelOutputError("Вариант должен быть объектом")
        if set(raw_option) - {"id", "label", "description"}:
            raise PlanningModelOutputError("Вариант содержит неизвестные поля")
        option_id = _compact_text(raw_option.get("id"), 40)
        label = _compact_text(raw_option.get("label"), 54)
        description = _compact_text(raw_option.get("description"), 120)
        if _is_other_option(label):
            continue
        if not QUESTION_ID_RE.fullmatch(option_id) or not label:
            raise PlanningModelOutputError("Некорректный вариант ответа")
        if _unsafe_text(label) or _unsafe_text(description):
            raise PlanningModelOutputError("Небезопасный текст варианта")
        normalized = _normalized_label(label)
        if option_id in seen_ids or normalized in seen_labels:
            raise PlanningModelOutputError("Дублирующиеся варианты ответа")
        if any(
            SequenceMatcher(None, normalized, previous).ratio() >= 0.9
            for previous in seen_labels
        ):
            raise PlanningModelOutputError(
                "Варианты ответа недостаточно различаются"
            )
        seen_ids.add(option_id)
        seen_labels.append(normalized)
        options.append(
            {
                "id": option_id,
                "label": label,
                **({"description": description} if description else {}),
            }
        )

    if not 2 <= len(options) <= MODEL_OPTION_LIMIT:
        raise PlanningModelOutputError("Planner должен вернуть 2–3 варианта")
    return {"id": question_id, "text": text, "options": options}


def _planner_system_prompt() -> str:
    return """\
Ты выбираешь ровно один следующий вопрос для короткого intake учебной доски.
Верни только один JSON-объект без markdown и объяснений:
{"status":"question","question":{"id":"snake_case","text":"короткий вопрос","options":[{"id":"snake_case","label":"1–5 слов","description":"короткая польза"}]}}
или {"status":"complete","question":null}, если данных уже достаточно.

Правила:
- 2–3 содержательно разных варианта; не добавляй «Другое» или свой вариант;
- вопрос зависит от темы, цели и уже известных ответов;
- не повторяй ids из asked_question_ids и не спрашивай уже известное;
- не спрашивай про стиль, цвет, палитру, шрифт или оформление;
- не выдавай рассуждения, chain-of-thought, HTML, SVG, координаты или геометрию;
- допустимы только поля из показанного JSON-контракта.
"""


def _ask_model(
    answers: dict[str, str | int],
    asked_ids: list[str],
) -> tuple[dict[str, Any] | None, str]:
    model_name = str(
        getattr(settings, "PLANNING_MODEL", "deepseek/deepseek-v4-flash")
    )
    timeout = int(getattr(settings, "PLANNING_TIMEOUT", 20))
    max_tokens = int(getattr(settings, "PLANNING_MAX_TOKENS", 700))
    response = TextModel(model=model_name, temperature=0.2).generate_json_content(
        system_prompt=_planner_system_prompt(),
        payload={
            "type": "planning_intake_context",
            "answers": answers,
            "asked_question_ids": asked_ids,
            "questions_remaining": max(0, _max_questions() - len(asked_ids)),
        },
        timeout=max(3, min(timeout, 60)),
        max_tokens=max(200, min(max_tokens, 1200)),
        reasoning_enabled=_setting_bool("PLANNING_REASONING_ENABLED", True),
        reasoning_effort=str(
            getattr(settings, "PLANNING_REASONING_EFFORT", "low") or ""
        ).strip().lower()
        or None,
        feature="planning_intake",
    )
    parsed = _parse_json_object(response.text)
    return _validate_question(parsed, answers=answers, asked_ids=asked_ids), model_name


def _fallback_questions(answers: dict[str, str | int]) -> list[dict[str, Any]]:
    goal = str(answers.get("goal") or "understand")
    result_type = str(answers.get("result_type") or "understand")
    topic = _compact_text(answers.get("topic"), 90) or "этой теме"

    if result_type == "solve_problem" or goal == "solve":
        return [
            {
                "id": "solution_focus",
                "text": f"Где нужна помощь в задаче по теме «{topic}»?",
                "options": [
                    {
                        "id": "build_model",
                        "label": "Построить модель",
                        "description": "Разметим данные, связи и схему.",
                    },
                    {
                        "id": "choose_method",
                        "label": "Выбрать способ",
                        "description": "Найдём формулу или алгоритм.",
                    },
                    {
                        "id": "full_solution",
                        "label": "Решить целиком",
                        "description": "Пройдём решение и проверку по шагам.",
                    },
                ],
            }
        ]
    if result_type == "prepare" or goal == "prepare":
        return [
            {
                "id": "preparation_focus",
                "text": "На чём сделать акцент при подготовке?",
                "options": [
                    {
                        "id": "topic_map",
                        "label": "Карта темы",
                        "description": "Свяжем определения и ключевые идеи.",
                    },
                    {
                        "id": "typical_tasks",
                        "label": "Типовые задания",
                        "description": "Разберём частые форматы вопросов.",
                    },
                    {
                        "id": "knowledge_check",
                        "label": "Проверка знаний",
                        "description": "Найдём пробелы короткими вопросами.",
                    },
                ],
            }
        ]
    return [
        {
            "id": "explanation_focus",
            "text": "Как лучше разобрать эту тему?",
            "options": [
                {
                    "id": "concept_links",
                    "label": "Через связи",
                    "description": "Покажем, как идеи зависят друг от друга.",
                },
                {
                    "id": "visual_example",
                    "label": "Через пример",
                    "description": "Начнём с одной наглядной ситуации.",
                },
                {
                    "id": "step_by_step",
                    "label": "По шагам",
                    "description": "Соберём объяснение от простого к сложному.",
                },
            ],
        }
    ]


def _fallback_question(
    answers: dict[str, str | int],
    asked_ids: list[str],
) -> dict[str, Any] | None:
    for question in _fallback_questions(answers):
        if question["id"] not in asked_ids and question["id"] not in answers:
            return question
    return None


def _goal_label(answers: dict[str, str | int]) -> str:
    return GOALS.get(str(answers.get("goal")), GOALS["understand"])[0]


def _focus_from_answers(answers: dict[str, str | int]) -> str:
    dynamic = [
        str(value)
        for key, value in answers.items()
        if key not in BASE_ANSWER_KEYS and str(value).strip()
    ]
    return dynamic[-1] if dynamic else RESULT_TYPES.get(
        str(answers.get("result_type")), "Понятный разбор"
    )


def _success_criteria(answers: dict[str, str | int]) -> list[str]:
    goal = str(answers.get("goal") or "understand")
    if goal == "solve":
        return [
            "Самостоятельно выделить данные и неизвестное",
            "Выбрать способ решения и проверить ответ",
        ]
    if goal == "prepare":
        return [
            "Объяснить ключевые идеи без подсказки",
            "Решить или разобрать типовой проверочный вопрос",
        ]
    return [
        "Объяснить основную идею своими словами",
        "Применить её на одном понятном примере",
    ]


def _summary(answers: dict[str, str | int]) -> dict[str, Any]:
    return {
        "topic": str(answers.get("topic") or ""),
        "goal": _goal_label(answers),
        "result_type": RESULT_TYPES.get(
            str(answers.get("result_type")), "Объяснение на доске"
        ),
        "focus": _focus_from_answers(answers),
        "level": LEVELS.get(str(answers.get("level")), "Знаком с темой"),
        "duration_minutes": int(answers.get("duration_minutes") or 35),
        "success_criteria": _success_criteria(answers),
    }


def _complete_payload(
    *,
    session_id: str,
    answers: dict[str, str | int],
    step: int,
    fallback: bool = False,
    model: str = "",
) -> dict[str, Any]:
    return {
        "type": "planning_intake",
        "status": "complete",
        "session_id": session_id,
        "step": step,
        "total_steps_hint": _max_questions(),
        "answers": answers,
        "summary": _summary(answers),
        "model": model,
        "fallback": fallback,
        **(
            {"notice": "Продолжим с базовыми настройками."}
            if fallback
            else {}
        ),
    }


def handle_planning_intake(data: Any) -> dict[str, Any]:
    """Return the next validated question or a deterministic summary."""
    if not isinstance(data, dict):
        raise PlanningIntakeValidationError("Некорректный intake payload")
    session_id = _verify_session_id(data.get("session_id"))
    answers = _sanitize_answers(data.get("answers"))
    asked_ids = _sanitize_asked_ids(data.get("asked_question_ids"))
    try:
        step = min(5, max(1, int(data.get("step") or 1)))
    except (TypeError, ValueError):
        step = 1

    required = {"topic", "goal", "result_type", "level", "duration_minutes"}
    if required.issubset(answers):
        return _complete_payload(
            session_id=session_id,
            answers=answers,
            step=step,
        )

    planner_ready = {"topic", "goal", "result_type"}.issubset(answers)
    if not planner_ready:
        raise PlanningIntakeValidationError(
            "Для адаптивного вопроса нужны тема, цель и тип результата"
        )

    fallback = not _setting_bool("PLANNING_ENABLED", True)
    model_name = ""
    question: dict[str, Any] | None = None
    if not fallback and len(asked_ids) < _max_questions():
        try:
            question, model_name = _ask_model(answers, asked_ids)
        except Exception as exc:  # noqa: BLE001 - fallback is the contract
            fallback = True
            logger.warning(
                "[planning_intake] model unavailable, using fallback: %s",
                exc,
            )

    if fallback:
        question = _fallback_question(answers, asked_ids)
    if question is None:
        return _complete_payload(
            session_id=session_id,
            answers=answers,
            step=step,
            fallback=fallback,
            model=model_name,
        )

    return {
        "type": "planning_intake",
        "status": "question",
        "session_id": session_id,
        "step": step,
        "total_steps_hint": _max_questions(),
        "question": question,
        "allow_other": True,
        "answers": answers,
        "model": model_name,
        "fallback": fallback,
        **(
            {"notice": "Продолжим с базовыми настройками."}
            if fallback
            else {}
        ),
    }


def _lesson_tasks(answers: dict[str, str | int]) -> list[dict[str, Any]]:
    topic = str(answers["topic"])
    goal = str(answers["goal"])
    duration = int(answers["duration_minutes"])
    focus = _focus_from_answers(answers)
    by_goal: dict[str, list[tuple[str, str]]] = {
        "understand": [
            ("Ключевая идея", "Разобрать смысл понятия и главные связи."),
            ("Наглядная схема", "Собрать на доске простую визуальную модель."),
            ("Понятный пример", "Применить идею в одной конкретной ситуации."),
        ],
        "solve": [
            ("Разбор условия", "Выделить данные, неизвестное и ограничения."),
            ("Модель задачи", "Построить схему и выбрать способ решения."),
            ("Решение", "Пройти вычисления по шагам и проверить ответ."),
        ],
        "prepare": [
            ("Карта темы", "Связать ключевые определения и формулы."),
            ("Типовой вопрос", "Разобрать частый формат задания."),
            ("Проверка", "Найти пробелы и закрепить слабые места."),
        ],
    }
    templates: list[tuple[str, str]] = [
        (
            "Цель урока",
            f"Зафиксировать результат по теме «{topic}» и критерии успеха.",
        ),
        ("Фокус", f"Сделать основной акцент: {focus}."),
        *by_goal.get(goal, by_goal["understand"]),
        ("Итог", "Проверить результат и определить следующий шаг."),
    ]
    max_tasks = 7 if duration >= 50 else 6 if duration >= 35 else 5
    templates = templates[: max_tasks - 1] + [templates[-1]]
    base = max(3, duration // len(templates))
    allocated = 0
    tasks: list[dict[str, Any]] = []
    for index, (title, description) in enumerate(templates):
        minutes = duration - allocated if index == len(templates) - 1 else base
        minutes = max(3, minutes)
        allocated += minutes
        tasks.append(
            {
                "id": f"task-{index + 1}",
                "title": title,
                "description": description,
                "durationMinutes": minutes,
            }
        )
    return tasks


def _build_lesson_plan(answers: dict[str, str | int]) -> dict[str, Any]:
    goal = str(answers["goal"])
    level = str(answers["level"])
    focus = _focus_from_answers(answers)
    criteria = _success_criteria(answers)
    return {
        "id": f"lesson-{uuid.uuid4().hex}",
        "topic": str(answers["topic"]),
        "objective": f"{GOALS[goal][1]} Фокус: {focus}.",
        "goal": goal,
        "goalLabel": GOALS[goal][0],
        "level": level,
        "levelLabel": LEVELS[level],
        "durationMinutes": int(answers["duration_minutes"]),
        "resultType": str(answers["result_type"]),
        "difficulties": [focus],
        "successCriteria": criteria,
        "tasks": _lesson_tasks(answers),
    }


def confirm_planning_intake(data: Any) -> dict[str, Any]:
    """Validate the signed session and create the final deterministic plan."""
    if not isinstance(data, dict):
        raise PlanningIntakeValidationError("Некорректный confirm payload")
    session_id = _verify_session_id(data.get("session_id"))
    answers = _sanitize_answers(data.get("answers"))
    required = {"topic", "goal", "result_type", "level", "duration_minutes"}
    missing = sorted(required - set(answers))
    if missing:
        raise PlanningIntakeValidationError(
            f"Не хватает ответов для плана: {', '.join(missing)}"
        )
    return {
        "type": "planning_intake",
        "status": "complete",
        "session_id": session_id,
        "answers": answers,
        "summary": _summary(answers),
        "plan": _build_lesson_plan(answers),
        "model": str(
            getattr(settings, "PLANNING_MODEL", "deepseek/deepseek-v4-flash")
        ),
    }


__all__ = [
    "MODEL_OPTION_LIMIT",
    "PlanningIntakeValidationError",
    "PlanningModelOutputError",
    "confirm_planning_intake",
    "handle_planning_intake",
]
