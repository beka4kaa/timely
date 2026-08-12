"""Deterministic, signed onboarding for the first study schedule.

The browser owns only presentation.  This module owns question order, accepted
semantic answers, ownership checks and the final database transaction.  Every
continuation token contains the already accepted answers and is signed by
Django, so a client can answer the current question but cannot rewrite an
earlier choice or use another student's setup session.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import date, time
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.core import signing
from django.db import transaction
from django.utils import timezone as django_timezone
from django.utils.dateparse import parse_date

from curriculum.models import CoursePlan
from curriculum.services import plans as curriculum_plans

from . import services
from .models import StudySchedule, TemplateSlot, WeeklyScheduleTemplate

SESSION_SALT = "timely.schedule-setup.v1"
SESSION_MAX_AGE_SECONDS = 2 * 60 * 60
SESSION_VERSION = 1
MAX_OFFERED_PLANS = 3
MIN_SESSION_MINUTES = 15
MAX_SESSION_MINUTES = 120

ANSWER_KEYS = (
    "course_plan_id",
    "weekdays",
    "start_time",
    "session_minutes",
)

WEEKDAY_LABELS = (
    "Понедельник",
    "Вторник",
    "Среда",
    "Четверг",
    "Пятница",
    "Суббота",
    "Воскресенье",
)

WEEKDAY_PRESETS: dict[str, tuple[int, ...]] = {
    "alternate": (0, 2, 4),
    "weekdays": (0, 1, 2, 3, 4),
    "weekend": (5, 6),
}

_WEEKDAY_ALIASES = {
    "пн": 0,
    "понедельник": 0,
    "monday": 0,
    "mon": 0,
    "вт": 1,
    "вторник": 1,
    "tuesday": 1,
    "tue": 1,
    "ср": 2,
    "среда": 2,
    "wednesday": 2,
    "wed": 2,
    "чт": 3,
    "четверг": 3,
    "thursday": 3,
    "thu": 3,
    "пт": 4,
    "пятница": 4,
    "friday": 4,
    "fri": 4,
    "сб": 5,
    "суббота": 5,
    "saturday": 5,
    "sat": 5,
    "вс": 6,
    "воскресенье": 6,
    "sunday": 6,
    "sun": 6,
}

_TIME_RE = re.compile(r"^(?:[01]\d|2[0-3]):[0-5]\d$")


class ScheduleSetupValidationError(ValueError):
    """Malformed input or a continuation that does not match signed state."""

    def __init__(self, message: str, *, code: str = "invalid_setup") -> None:
        super().__init__(message)
        self.code = code


class ScheduleSetupBlocked(RuntimeError):
    """The user needs to complete another product step before setup."""

    def __init__(self, message: str, *, code: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class SetupGenerationResult:
    schedule: StudySchedule
    answers: dict[str, str]
    summary: dict[str, Any]
    warnings: tuple[str, ...]
    blocks_created: int
    created_new: bool = True

    @property
    def feasible(self) -> bool:
        return self.schedule.feasible


def _user_key(value: Any) -> str:
    return str(value or "").strip().casefold()


def _database_email(value: Any) -> str:
    return str(value or "").strip()


def _active_plans(user_email: str) -> tuple[list[CoursePlan], bool]:
    rows = list(
        CoursePlan.objects.filter(
            user_email=user_email,
            status=CoursePlan.Status.ACTIVE,
        ).order_by("-updated_at", "-created_at", "id")[: MAX_OFFERED_PLANS + 1]
    )
    if not rows:
        raise ScheduleSetupBlocked(
            "Сначала создай и активируй учебную программу.",
            code="no_active_course_plans",
        )
    return rows[:MAX_OFFERED_PLANS], len(rows) > MAX_OFFERED_PLANS


def _canonical_course_plan(value: str, offered_plan_ids: list[str]) -> str:
    try:
        plan_id = str(uuid.UUID(value.strip()))
    except (AttributeError, TypeError, ValueError) as exc:
        raise ScheduleSetupValidationError(
            "Выбери программу из предложенного списка.", code="invalid_answer"
        ) from exc
    if plan_id not in offered_plan_ids:
        raise ScheduleSetupValidationError(
            "Эта программа недоступна в текущей сессии настройки.",
            code="invalid_answer",
        )
    return plan_id


def _canonical_weekdays(value: str) -> str:
    raw = value.strip().casefold()
    if raw in WEEKDAY_PRESETS:
        days = WEEKDAY_PRESETS[raw]
    else:
        tokens = [item.strip().casefold() for item in re.split(r"[,;]", raw)]
        if not tokens or any(not item for item in tokens):
            raise ScheduleSetupValidationError(
                "Укажи хотя бы один день недели.", code="invalid_answer"
            )
        parsed: list[int] = []
        for token in tokens:
            if token.isdigit() and 0 <= int(token) <= 6:
                parsed.append(int(token))
                continue
            if token in _WEEKDAY_ALIASES:
                parsed.append(_WEEKDAY_ALIASES[token])
                continue
            raise ScheduleSetupValidationError(
                "Дни недели задаются числами 0–6 или названиями через запятую.",
                code="invalid_answer",
            )
        days = tuple(parsed)
    unique = sorted(set(days))
    if not unique:
        raise ScheduleSetupValidationError(
            "Укажи хотя бы один день недели.", code="invalid_answer"
        )
    return ",".join(str(day) for day in unique)


def _canonical_start_time(value: str) -> str:
    raw = value.strip()
    if not _TIME_RE.fullmatch(raw):
        raise ScheduleSetupValidationError(
            "Время нужно указать в формате ЧЧ:ММ.", code="invalid_answer"
        )
    return raw


def _canonical_session_minutes(value: str) -> str:
    raw = value.strip()
    if not raw.isdigit():
        raise ScheduleSetupValidationError(
            "Длительность занятия должна быть числом минут.",
            code="invalid_answer",
        )
    minutes = int(raw)
    if not MIN_SESSION_MINUTES <= minutes <= MAX_SESSION_MINUTES:
        raise ScheduleSetupValidationError(
            f"Длительность занятия — от {MIN_SESSION_MINUTES} до "
            f"{MAX_SESSION_MINUTES} минут.",
            code="invalid_answer",
        )
    return str(minutes)


def _canonical_answers(raw: Any, *, offered_plan_ids: list[str]) -> dict[str, str]:
    if raw in (None, ""):
        return {}
    if not isinstance(raw, dict):
        raise ScheduleSetupValidationError(
            "answers должен быть объектом.", code="invalid_answer"
        )
    unknown = set(raw) - set(ANSWER_KEYS)
    if unknown:
        raise ScheduleSetupValidationError(
            f"Неизвестные ответы: {', '.join(sorted(str(key) for key in unknown))}.",
            code="invalid_answer",
        )

    answers: dict[str, str] = {}
    for key, raw_value in raw.items():
        if not isinstance(raw_value, str):
            raise ScheduleSetupValidationError(
                f"Ответ {key} должен быть строкой.", code="invalid_answer"
            )
        if key == "course_plan_id":
            answers[key] = _canonical_course_plan(raw_value, offered_plan_ids)
        elif key == "weekdays":
            answers[key] = _canonical_weekdays(raw_value)
        elif key == "start_time":
            answers[key] = _canonical_start_time(raw_value)
        elif key == "session_minutes":
            answers[key] = _canonical_session_minutes(raw_value)
    return answers


def _normalize_timezone(value: Any) -> str:
    name = str(value or "UTC").strip() or "UTC"
    if len(name) > 64:
        raise ScheduleSetupValidationError(
            "Некорректный часовой пояс.", code="invalid_timezone"
        )
    try:
        return ZoneInfo(name).key
    except (ValueError, ZoneInfoNotFoundError) as exc:
        raise ScheduleSetupValidationError(
            "Неизвестный часовой пояс.", code="invalid_timezone"
        ) from exc


def _normalize_start_date(value: Any, timezone_name: str) -> str:
    if value in (None, ""):
        zone = ZoneInfo(timezone_name)
        return django_timezone.now().astimezone(zone).date().isoformat()
    if not isinstance(value, str):
        raise ScheduleSetupValidationError(
            "Дата начала должна быть строкой YYYY-MM-DD.", code="invalid_start_date"
        )
    parsed = parse_date(value.strip())
    if parsed is None or parsed.isoformat() != value.strip():
        raise ScheduleSetupValidationError(
            "Дата начала должна быть в формате YYYY-MM-DD.",
            code="invalid_start_date",
        )
    return parsed.isoformat()


def _load_session(session_id: Any, *, user_email: str) -> dict[str, Any]:
    value = str(session_id or "").strip()
    if not value:
        raise ScheduleSetupValidationError(
            "Сессия настройки не передана.", code="invalid_session"
        )
    try:
        payload = signing.loads(
            value,
            salt=SESSION_SALT,
            max_age=SESSION_MAX_AGE_SECONDS,
        )
    except signing.BadSignature as exc:
        raise ScheduleSetupValidationError(
            "Сессия настройки недействительна. Начни настройку заново.",
            code="invalid_session",
        ) from exc
    if (
        not isinstance(payload, dict)
        or payload.get("type") != "schedule_setup"
        or payload.get("version") != SESSION_VERSION
        or payload.get("user") != _user_key(user_email)
    ):
        raise ScheduleSetupValidationError(
            "Сессия настройки недействительна. Начни настройку заново.",
            code="invalid_session",
        )
    if not isinstance(payload.get("answers"), dict) or not isinstance(
        payload.get("offered_plan_ids"), list
    ) or not isinstance(payload.get("user_email"), str):
        raise ScheduleSetupValidationError(
            "Сессия настройки повреждена. Начни настройку заново.",
            code="invalid_session",
        )
    if _user_key(payload["user_email"]) != payload["user"]:
        raise ScheduleSetupValidationError(
            "Сессия настройки повреждена. Начни настройку заново.",
            code="invalid_session",
        )
    return payload


def _issue_session(state: dict[str, Any]) -> str:
    return signing.dumps(state, salt=SESSION_SALT, compress=True)


def _check_context(data: dict[str, Any], state: dict[str, Any]) -> None:
    if "timezone" in data and data["timezone"] not in (None, ""):
        if _normalize_timezone(data["timezone"]) != state["timezone"]:
            raise ScheduleSetupValidationError(
                "Часовой пояс сессии нельзя изменить без новой настройки.",
                code="invalid_session",
            )
    if "start_date" in data and data["start_date"] not in (None, ""):
        if _normalize_start_date(data["start_date"], state["timezone"]) != state[
            "start_date"
        ]:
            raise ScheduleSetupValidationError(
                "Дату начала сессии нельзя изменить без новой настройки.",
                code="invalid_session",
            )


def _selected_plan(answers: dict[str, str], *, user_email: str) -> CoursePlan | None:
    plan_id = answers.get("course_plan_id")
    if not plan_id:
        return None
    plan = CoursePlan.objects.filter(
        pk=plan_id,
        user_email=user_email,
        status=CoursePlan.Status.ACTIVE,
    ).first()
    if plan is None:
        raise ScheduleSetupBlocked(
            "Выбранная программа больше не активна. Начни настройку заново.",
            code="course_plan_unavailable",
        )
    return plan


def _course_question(
    *, user_email: str, offered_plan_ids: list[str], has_more: bool
) -> dict[str, Any]:
    plans_by_id = {
        str(plan.id): plan
        for plan in CoursePlan.objects.filter(
            id__in=offered_plan_ids,
            user_email=user_email,
            status=CoursePlan.Status.ACTIVE,
        )
    }
    options = []
    for plan_id in offered_plan_ids:
        plan = plans_by_id.get(plan_id)
        if plan is None:
            continue
        options.append(
            {
                "id": plan_id,
                "label": plan.title[:80],
                "description": (
                    f"{plan.recommended_sessions_per_week or 3} занятий в неделю, "
                    f"по {plan.recommended_session_minutes or 45} минут"
                ),
            }
        )
    if len(options) < 2:
        raise ScheduleSetupBlocked(
            "Список программ изменился. Начни настройку заново.",
            code="course_plans_changed",
        )
    return {
        "id": "course_plan_id",
        "text": "Для какой программы составить расписание?",
        "options": options,
        **({"has_more": True} if has_more else {}),
    }


def _question_for(state: dict[str, Any], *, user_email: str) -> dict[str, Any] | None:
    answers = state["answers"]
    if "course_plan_id" not in answers:
        return _course_question(
            user_email=user_email,
            offered_plan_ids=state["offered_plan_ids"],
            has_more=bool(state.get("has_more_plans")),
        )
    _selected_plan(answers, user_email=user_email)
    if "weekdays" not in answers:
        return {
            "id": "weekdays",
            "text": "В какие дни тебе обычно удобно заниматься?",
            "options": [
                {
                    "id": "alternate",
                    "label": "Пн, ср и пт",
                    "description": "Равномерный ритм с паузами между занятиями.",
                },
                {
                    "id": "weekdays",
                    "label": "По будням",
                    "description": "Короткие занятия почти каждый учебный день.",
                },
                {
                    "id": "weekend",
                    "label": "В выходные",
                    "description": "Основная нагрузка в субботу и воскресенье.",
                },
            ],
        }
    if "start_time" not in answers:
        return {
            "id": "start_time",
            "text": "Во сколько лучше начинать занятие?",
            "options": [
                {
                    "id": "17:00",
                    "label": "После школы, 17:00",
                    "description": "Начать после короткого отдыха.",
                },
                {
                    "id": "19:00",
                    "label": "Вечером, 19:00",
                    "description": "Сначала закончить остальные дела.",
                },
                {
                    "id": "10:00",
                    "label": "Утром, 10:00",
                    "description": "Подходит для выходных или свободных дней.",
                },
            ],
        }
    if "session_minutes" not in answers:
        return {
            "id": "session_minutes",
            "text": "Какая длительность занятия комфортна?",
            "options": [
                {
                    "id": "25",
                    "label": "25 минут",
                    "description": "Короткий фокус без перегрузки.",
                },
                {
                    "id": "45",
                    "label": "45 минут",
                    "description": "Стандартное полноценное занятие.",
                },
                {
                    "id": "60",
                    "label": "60 минут",
                    "description": "Для глубокой работы над сложной темой.",
                },
            ],
        }
    return None


def _summary(answers: dict[str, str], *, user_email: str, state: dict[str, Any]) -> dict[str, Any]:
    plan = _selected_plan(answers, user_email=user_email)
    if plan is None:
        raise ScheduleSetupValidationError(
            "Не выбрана учебная программа.", code="incomplete_setup"
        )
    weekdays = [int(item) for item in answers["weekdays"].split(",")]
    minutes = int(answers["session_minutes"])
    return {
        "course_plan_id": str(plan.id),
        "course_title": plan.title,
        "weekdays": weekdays,
        "weekday_labels": [WEEKDAY_LABELS[item] for item in weekdays],
        "start_time": answers["start_time"],
        "session_minutes": minutes,
        "sessions_per_week": len(weekdays),
        "minutes_per_week": len(weekdays) * minutes,
        "timezone": state["timezone"],
        "start_date": state["start_date"],
    }


def _response(state: dict[str, Any], *, user_email: str) -> dict[str, Any]:
    question = _question_for(state, user_email=user_email)
    state = {
        **state,
        "current_question": question["id"] if question else "",
        "complete": question is None,
    }
    session_id = _issue_session(state)
    if question is None:
        return {
            "type": "schedule_setup",
            "status": "complete",
            "session_id": session_id,
            "step": min(state["step"], state["total_steps_hint"]),
            "total_steps_hint": state["total_steps_hint"],
            "answers": dict(state["answers"]),
            "summary": _summary(state["answers"], user_email=user_email, state=state),
        }
    return {
        "type": "schedule_setup",
        "status": "question",
        "session_id": session_id,
        "step": state["step"],
        "total_steps_hint": state["total_steps_hint"],
        "question": question,
        "allow_other": question["id"] != "course_plan_id",
        "answers": dict(state["answers"]),
    }


def _replaceable_setup_proposal(schedule: StudySchedule) -> bool:
    """An unconfirmed /start draft may be superseded by a later /start."""
    return schedule.setup_restartable


def _has_blocking_schedule(schedules) -> bool:
    return any(
        schedule.status
        not in {StudySchedule.Status.ARCHIVED, StudySchedule.Status.COMPLETED}
        and not _replaceable_setup_proposal(schedule)
        for schedule in schedules
    )


def handle_schedule_setup(data: Any, *, user_email: str) -> dict[str, Any]:
    """Return one next question or a signed, complete setup summary."""
    if not isinstance(data, dict) or data.get("type") != "schedule_setup":
        raise ScheduleSetupValidationError("Некорректный запрос настройки.")
    email = _database_email(user_email)
    if not email:
        raise ScheduleSetupValidationError(
            "Не определён пользователь.", code="no_user"
        )

    session_id = data.get("session_id")
    if not session_id:
        existing_schedules = StudySchedule.objects.filter(user_email=email).exclude(
            status__in=[
                StudySchedule.Status.ARCHIVED,
                StudySchedule.Status.COMPLETED,
            ]
        )
        if _has_blocking_schedule(existing_schedules):
            raise ScheduleSetupBlocked(
                "Расписание уже создано. Для изменений используй /plan.",
                code="schedule_already_exists",
            )
        offered_plans, has_more = _active_plans(email)
        offered_plan_ids = [str(plan.id) for plan in offered_plans]
        if data.get("answers") not in (None, "", {}):
            raise ScheduleSetupValidationError(
                "Начни настройку без готовых ответов.", code="invalid_answer"
            )
        answers: dict[str, str] = {}
        if len(offered_plans) == 1:
            only_plan_id = str(offered_plans[0].id)
            answers["course_plan_id"] = only_plan_id

        timezone_name = _normalize_timezone(data.get("timezone"))
        state: dict[str, Any] = {
            "type": "schedule_setup",
            "version": SESSION_VERSION,
            "nonce": uuid.uuid4().hex,
            "user": _user_key(email),
            "user_email": email,
            "timezone": timezone_name,
            "start_date": _normalize_start_date(
                data.get("start_date"), timezone_name
            ),
            "answers": answers,
            "offered_plan_ids": offered_plan_ids,
            "has_more_plans": has_more,
            "current_question": "",
            "complete": False,
            "step": 1,
            "total_steps_hint": max(1, len(set(ANSWER_KEYS) - set(answers))),
        }
        return _response(state, user_email=email)

    state = _load_session(session_id, user_email=email)
    email = state["user_email"]
    _check_context(data, state)
    if state.get("complete"):
        incoming = _canonical_answers(
            data.get("answers"), offered_plan_ids=state["offered_plan_ids"]
        )
        if incoming != state["answers"]:
            raise ScheduleSetupValidationError(
                "Завершённые ответы нельзя изменить. Начни настройку заново.",
                code="invalid_session",
            )
        return _response(state, user_email=email)

    incoming = _canonical_answers(
        data.get("answers"), offered_plan_ids=state["offered_plan_ids"]
    )
    previous = state["answers"]
    if any(incoming.get(key) != value for key, value in previous.items()):
        raise ScheduleSetupValidationError(
            "Предыдущие ответы не совпадают с подписанной сессией.",
            code="invalid_session",
        )
    added = set(incoming) - set(previous)
    current_question = state.get("current_question")
    if added and (added != {current_question}):
        raise ScheduleSetupValidationError(
            "Отправь ответ только на текущий вопрос.", code="invalid_answer"
        )
    if added:
        state = {**state, "answers": incoming, "step": int(state["step"]) + 1}
    return _response(state, user_email=email)


def _existing_result(
    *,
    state: dict[str, Any],
    answers: dict[str, str],
    plan: CoursePlan,
    schedules: list[StudySchedule],
) -> SetupGenerationResult | None:
    nonce = state["nonce"]
    for schedule in schedules:
        setup_snapshot = (schedule.pacing_snapshot or {}).get("schedule_setup") or {}
        if setup_snapshot.get("nonce") == nonce:
            if setup_snapshot.get("answers") != answers:
                raise ScheduleSetupValidationError(
                    "Эта сессия уже подтверждена с другими ответами.",
                    code="setup_already_confirmed",
                )
            return SetupGenerationResult(
                schedule=schedule,
                answers=answers,
                summary=_summary(answers, user_email=plan.user_email, state=state),
                warnings=tuple(schedule.warnings or ()),
                blocks_created=schedule.blocks.count(),
                created_new=False,
            )
    return None


@transaction.atomic
def confirm_schedule_setup(data: Any, *, user_email: str) -> SetupGenerationResult:
    """Persist a new active rhythm and generate an idempotent proposal."""
    if not isinstance(data, dict) or data.get("type") != "confirm_schedule_setup":
        raise ScheduleSetupValidationError("Некорректный запрос подтверждения.")
    email = _database_email(user_email)
    state = _load_session(data.get("session_id"), user_email=email)
    email = state["user_email"]
    _check_context(data, state)
    if not state.get("complete") or state.get("current_question"):
        raise ScheduleSetupValidationError(
            "Сначала ответь на все вопросы настройки.", code="incomplete_setup"
        )

    answers = _canonical_answers(
        data.get("answers"), offered_plan_ids=state["offered_plan_ids"]
    )
    if answers != state["answers"]:
        raise ScheduleSetupValidationError(
            "Ответы не совпадают с завершённой подписанной сессией.",
            code="invalid_session",
        )

    # Lock every plan owned by this user in stable order.  Two forks can select
    # different offered plans, and two independently started setup sessions can
    # carry different offered sets; locking only the selected/offered rows could
    # let both confirmations create an active template concurrently.
    locked_plans = list(
        CoursePlan.objects.select_for_update()
        .filter(user_email=email)
        .order_by("id")
    )
    plan = next(
        (
            item
            for item in locked_plans
            if str(item.id) in state["offered_plan_ids"]
            and str(item.id) == answers["course_plan_id"]
            and item.status == CoursePlan.Status.ACTIVE
        ),
        None,
    )
    if plan is None:
        raise ScheduleSetupBlocked(
            "Выбранная программа больше не активна. Начни настройку заново.",
            code="course_plan_unavailable",
        )

    # Сначала ищем идемпотентный replay, и только затем запрещаем второй
    # календарь. Поэтому повтор ответа после потерянного HTTP-response безопасен,
    # а другая вкладка не может создать параллельный первый план.
    locked_schedules = list(
        StudySchedule.objects.select_for_update()
        .filter(user_email=email)
        .order_by("id")
    )
    replay = _existing_result(
        state=state,
        answers=answers,
        plan=plan,
        schedules=locked_schedules,
    )
    if replay is not None:
        return replay
    if _has_blocking_schedule(locked_schedules):
        raise ScheduleSetupBlocked(
            "Расписание уже создано. Для изменений используй /plan.",
            code="schedule_already_exists",
        )

    replaceable_ids = [
        schedule.id
        for schedule in locked_schedules
        if _replaceable_setup_proposal(schedule)
    ]
    if replaceable_ids:
        StudySchedule.objects.filter(id__in=replaceable_ids).update(
            status=StudySchedule.Status.ARCHIVED,
            updated_at=django_timezone.now(),
        )

    weekdays = tuple(int(item) for item in answers["weekdays"].split(","))
    start_hour, start_minute = (
        int(item) for item in answers["start_time"].split(":")
    )
    session_minutes = int(answers["session_minutes"])
    start_date = date.fromisoformat(state["start_date"])

    # A replacement is safer than mutating a template referenced by an active
    # schedule: old calendars retain the rhythm that produced their geometry.
    WeeklyScheduleTemplate.objects.select_for_update().filter(
        user_email=email, active=True
    ).update(active=False)
    template = WeeklyScheduleTemplate.objects.create(
        user_email=email,
        title="Учебный ритм",
        timezone=state["timezone"],
        active=True,
        valid_from=start_date,
        max_minutes_per_day=session_minutes,
        max_minutes_per_week=session_minutes * len(weekdays),
        created_by="student_setup",
    )
    TemplateSlot.objects.bulk_create(
        [
            TemplateSlot(
                template=template,
                weekday=weekday,
                start_time=time(start_hour, start_minute),
                duration_minutes=session_minutes,
            )
            for weekday in weekdays
        ]
    )

    pace_warnings = curriculum_plans.repace_plan(
        plan,
        sessions_per_week=len(weekdays),
        minutes_per_session=session_minutes,
        start_date=start_date,
    )
    # Legacy/fixture plans can have zero total minutes, in which case forecast
    # recalculation intentionally returns early.  The confirmed preference is
    # still the scheduler's part-size limit and must therefore be persisted.
    if (
        plan.recommended_sessions_per_week != len(weekdays)
        or plan.recommended_session_minutes != session_minutes
    ):
        plan.recommended_sessions_per_week = len(weekdays)
        plan.recommended_session_minutes = session_minutes
        plan.save(
            update_fields=[
                "recommended_sessions_per_week",
                "recommended_session_minutes",
                "updated_at",
            ]
        )

    outcome = services.generate_schedule(
        plan=plan,
        start_date=start_date,
        timezone_name=state["timezone"],
        template=template,
        provider_key="deterministic",
    )
    combined_warnings = tuple(
        dict.fromkeys([*pace_warnings, *outcome.warnings])
    )
    outcome.schedule.pacing_snapshot = {
        **(outcome.schedule.pacing_snapshot or {}),
        "schedule_setup": {
            "version": SESSION_VERSION,
            "nonce": state["nonce"],
            "answers": answers,
        },
    }
    outcome.schedule.warnings = list(combined_warnings)
    outcome.schedule.save(
        update_fields=["pacing_snapshot", "warnings", "updated_at"]
    )

    return SetupGenerationResult(
        schedule=outcome.schedule,
        answers=answers,
        summary=_summary(answers, user_email=email, state=state),
        warnings=combined_warnings,
        blocks_created=len(outcome.blocks),
    )


__all__ = [
    "MAX_SESSION_MINUTES",
    "MIN_SESSION_MINUTES",
    "ScheduleSetupBlocked",
    "ScheduleSetupValidationError",
    "SetupGenerationResult",
    "confirm_schedule_setup",
    "handle_schedule_setup",
]
