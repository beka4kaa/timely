"""Предмет и занятия одним действием: то, что делает карточка тьютора после «Применить».

Модель сама ничего не пишет: сюда приходит просьба, которую ученик уже подтвердил. Предпросмотр
считает то же самое в транзакции с откатом, поэтому карточка показывает настоящий результат.

Что происходит, зависит от предмета:

* `subject_only`: новый предмет без занятий;
* `new_sessions`: у предмета нет книги. Занятия ставятся напрямую, один блок на день, потому что
  движок дробит часовое занятие без книги на четыре блока по 15 минут;
* `book_topics`: есть программа по книге, а расписания нет. Движок ставит следующие темы, а что не
  поместилось в период, остаётся на потом;
* `extra_sessions`: расписание уже есть. Оно не трогается, на период добавляются отдельные занятия.
"""

from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass, replace
from datetime import date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Q
from django.utils import timezone as django_timezone

from curriculum.models import (
    CourseEnrollment,
    CoursePlan,
    CoursePlanVersion,
    CourseTopic,
    Document,
    LearningGoal,
    StudyMaterial,
    SubjectChat,
)
from curriculum.services import goals as goals_service
from curriculum.services import materials as materials_service
from curriculum.services import plans as plans_service
from diary.models import WeeklyTemplate
from mind.models import Subject

from .models import AppliedQuickPlan, LearningBlock, StudySchedule, TemplateSlot, WeeklyScheduleTemplate
from .scheduling.slots import busy_intervals, local_to_utc, resolve_zone
from .services import (
    _RELEASED_BLOCK_STATUSES,
    MAX_HORIZON_DAYS,
    ScheduleGenerationError,
    ScheduleNotConfirmable,
    calendar_learning_blocks,
    calendar_schedules,
    commitment_specs,
    confirm_schedule,
    generate_schedule,
)

MIN_SESSION_MINUTES = 15
MAX_SESSION_MINUTES = 240
MAX_SUBJECT_CHARS = 160

_STARTED_STATUSES = (
    LearningBlock.Status.IN_PROGRESS,
    LearningBlock.Status.PAUSED,
    LearningBlock.Status.COMPLETED,
    LearningBlock.Status.PARTIALLY_COMPLETED,
)
_REPLACED_STATUSES = (
    StudySchedule.Status.DRAFT,
    StudySchedule.Status.PROPOSED,
    StudySchedule.Status.CONFIRMED,
    StudySchedule.Status.ACTIVE,
)
# Всё остальное в школьном дне занято: контрольная, фокус, свой блок ученика.
_FREE_SCHOOL_BLOCKS = {"break", "rest"}
_DIARY_WEEKDAYS = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}
_ON_WEEKDAY = ("В понедельник", "Во вторник", "В среду", "В четверг", "В пятницу", "В субботу", "В воскресенье")
_OF_MONTH = (
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
)


@dataclass(frozen=True)
class QuickPlanRequest:
    user_email: str
    subject: str
    timezone: str
    goal_id: str | None = None
    weekdays: tuple[int, ...] = ()  # пусто: только предмет
    start_time: time | None = None
    minutes: int = 60
    from_date: date | None = None
    to_date: date | None = None
    # Что показала карточка: если получится иначе, записывать нельзя.
    expected_sessions: int | None = None
    expected_path: str | None = None
    # Номер карточки: второе нажатие не пишет во второй раз.
    key: str = ""


@dataclass(frozen=True)
class QuickPlanResult:
    path: str
    subject: str  # как предмет называется в итоге
    goal_id: str
    created_goal: bool
    schedule_id: str | None
    sessions: int
    first_date: date | None
    last_date: date | None
    left_topics: int
    approves_plan: bool
    undo: dict[str, Any]  # отдаётся клиенту и возвращается в `undo_quick_plan`


class QuickPlanRejected(ValueError):
    """Просьбу выполнить нельзя. Текст можно показать ученику как есть."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def today_in(timezone_name: str) -> date:
    return django_timezone.now().astimezone(resolve_zone(timezone_name)).date()


# ─────────────────────────────── Проверка просьбы ────────────────────────────────


def _clean_name(value: Any) -> str:
    return " ".join(str(value or "").split())


def _goal_name(goal: LearningGoal) -> str:
    return _clean_name(goal.normalized_subject or goal.original_text)


def _checked_weekdays(request: QuickPlanRequest) -> tuple[int, ...]:
    """Дни занятий или пусто, если занятий не просили."""
    name = _clean_name(request.subject)
    if not name and not request.goal_id:
        raise QuickPlanRejected("bad_request", "Нужно название предмета.")
    if len(name) > MAX_SUBJECT_CHARS:
        raise QuickPlanRejected("bad_request", "Слишком длинное название предмета.")

    if not all(isinstance(day, int) and 0 <= day <= 6 for day in request.weekdays):
        raise QuickPlanRejected("bad_request", "Дни недели указаны неверно.")
    weekdays = tuple(sorted(set(request.weekdays)))
    # Разовое занятие: день недели и так ясен из даты.
    if not weekdays and request.from_date and request.from_date == request.to_date:
        weekdays = (request.from_date.weekday(),)

    if not (weekdays or request.start_time or request.from_date or request.to_date):
        return ()
    if not (weekdays and request.start_time and request.from_date and request.to_date):
        raise QuickPlanRejected("bad_request", "Для занятий нужны дни недели, время и период.")
    if request.to_date < request.from_date:
        raise QuickPlanRejected("bad_request", "Конец периода раньше начала.")
    if not MIN_SESSION_MINUTES <= request.minutes <= MAX_SESSION_MINUTES:
        raise QuickPlanRejected(
            "bad_request",
            f"Длительность занятия должна быть от {MIN_SESSION_MINUTES} до {MAX_SESSION_MINUTES} минут.",
        )
    return weekdays


def _fitting_days(request: QuickPlanRequest, weekdays: tuple[int, ...], zone: ZoneInfo) -> list[date]:
    """Дни занятий в периоде. Сегодня подходит, только если время ещё не прошло."""
    today = today_in(zone.key)
    if request.from_date < today:
        raise QuickPlanRejected("past_period", "Период уже начался раньше сегодняшнего дня.")
    length = (request.to_date - request.from_date).days + 1
    if length > MAX_HORIZON_DAYS:
        raise QuickPlanRejected("too_long", f"Можно поставить занятия не больше чем на {MAX_HORIZON_DAYS} дней.")

    days = []
    for offset in range(length):
        day = request.from_date + timedelta(days=offset)
        if day.weekday() not in weekdays:
            continue
        if day == today and local_to_utc(day, request.start_time, zone)[0] <= django_timezone.now():
            continue
        days.append(day)
    if not days:
        raise QuickPlanRejected("empty_period", "В этот период нет ни одного подходящего дня.")
    return days


def _find_goal(request: QuickPlanRequest) -> LearningGoal | None:
    goals = LearningGoal.objects.filter(user_email=request.user_email).exclude(status=LearningGoal.Status.ARCHIVED)
    if request.goal_id:
        try:
            goal = goals.filter(pk=request.goal_id).first()
        except (ValidationError, ValueError):
            goal = None
        if goal is None:
            raise QuickPlanRejected("goal_not_found", "Такого предмета нет.")
        return goal
    # В Python, а не в запросе: SQLite не знает регистра кириллицы.
    wanted = _clean_name(request.subject).casefold()
    for goal in goals.order_by("-updated_at"):
        names = {_clean_name(goal.normalized_subject).casefold(), _clean_name(goal.original_text).casefold()}
        if wanted in names:
            return goal
    return None


# ─────────────────────────────── Занятое время ───────────────────────────────────


def _parsed_time(value: Any) -> time | None:
    """Время из дневника. Импорт расписания пишет его и без ведущего нуля: «8:30»."""
    try:
        return datetime.strptime(str(value or "").strip(), "%H:%M").time()
    except ValueError:
        return None


def _school_rows(template: WeeklyTemplate) -> list[dict[str, Any]]:
    """Строки шаблона. Основная запись в таблице, но старые шаблоны живут только в JSON."""
    rows = [lesson.to_slot_dict() for lesson in template.template_lessons.all()]
    if not rows:
        rows = [row for row in template.slots or [] if isinstance(row, dict)]
    return [row for row in rows if (row.get("blockType") or "lesson") not in _FREE_SCHOOL_BLOCKS]


def _school_lessons(
    email: str, first: date, last: date, zone: ZoneInfo
) -> list[tuple[datetime, datetime, str]]:
    """Уроки активного шаблона дневника. Движок дневник намеренно не читает, поэтому проверка здесь."""
    template = WeeklyTemplate.objects.filter(user_email=email, is_active=True).first()
    if template is None:
        return []
    rows = _school_rows(template)
    names = dict(
        Subject.objects.filter(
            Q(user_email=email) | Q(user_email__isnull=True),
            id__in=[row["subjectId"] for row in rows if row.get("subjectId")],
        ).values_list("id", "name")
    )
    taken = []
    for row in rows:
        weekday = _DIARY_WEEKDAYS.get(row.get("dayOfWeek"))
        start, end = _parsed_time(row.get("startTime")), _parsed_time(row.get("endTime"))
        if weekday is None or start is None or end is None or end <= start:
            continue
        minutes = (end.hour - start.hour) * 60 + end.minute - start.minute
        title = row.get("label") or names.get(row.get("subjectId")) or "Урок"
        for offset in range((last - first).days + 1):
            day = first + timedelta(days=offset)
            if day.weekday() == weekday:
                begins = local_to_utc(day, start, zone)[0]
                taken.append((begins, begins + timedelta(minutes=minutes), title))
    return taken


def _first_busy(
    email: str, days: list[date], start_time: time, minutes: int, zone: ZoneInfo, *, own_plan_id: str | None = None
) -> str | None:
    """Что занято в первое же совпавшее время, понятной фразой. `None`, если всё свободно.

    `own_plan_id`: предложения этой же программы не мешают, подтверждение всё равно их заменит.
    """
    wanted = []
    for day in days:
        begins = local_to_utc(day, start_time, zone)[0]
        wanted.append((day, begins, begins + timedelta(minutes=minutes)))

    # На день дальше: занятие поздно вечером может перейти за полночь.
    first, last = days[0], days[-1] + timedelta(days=1)
    taken: list[tuple[datetime, datetime, str]] = []
    for commitment in commitment_specs(email):
        for begins, ends in busy_intervals((commitment,), start_date=first, end_date=last, zone=zone):
            taken.append((begins, ends, commitment.title))
    blocks = calendar_learning_blocks(email, exclude_course_plan_id=own_plan_id, include_released=False).filter(
        end_at__gt=wanted[0][1], start_at__lt=wanted[-1][2]
    )
    taken.extend((block.start_at, block.end_at, block.title) for block in blocks)
    taken.extend(_school_lessons(email, first, last, zone))

    for day, begins, ends in wanted:
        for busy_begins, busy_ends, title in taken:
            if begins < busy_ends and busy_begins < ends:
                return (
                    f"{_ON_WEEKDAY[day.weekday()]}, {day.day} {_OF_MONTH[day.month - 1]}, "
                    f"в {start_time:%H:%M} уже занято: «{title}»."
                )
    return None


# ───────────────────────────────── Запись ────────────────────────────────────────


def _new_goal(request: QuickPlanRequest) -> LearningGoal:
    name = _clean_name(request.subject)
    goal = LearningGoal.objects.create(user_email=request.user_email, original_text=name)
    return goals_service.confirm_goal(goal, normalized_subject=name)


def _assistant_template(
    request: QuickPlanRequest, weekdays: tuple[int, ...], first_day: date, zone: ZoneInfo
) -> WeeklyScheduleTemplate:
    """Свой ритм занятий. Активным он станет, только если другого ритма у ученика нет.

    Потолков нагрузки нет: день и так ограничен окнами, а потолок считается по всем предметам и
    запретил бы и второй предмет в этот день, и перенос занятий.
    """
    template = WeeklyScheduleTemplate.objects.create(
        user_email=request.user_email,
        title="Учебный ритм",
        timezone=zone.key,
        active=False,
        valid_from=first_day,
        created_by="assistant",
    )
    TemplateSlot.objects.bulk_create(
        [
            TemplateSlot(
                template=template,
                weekday=weekday,
                start_time=request.start_time,
                duration_minutes=request.minutes,
            )
            for weekday in weekdays
        ]
    )
    return template


def _confirm(schedule: StudySchedule) -> tuple[bool, dict[str, str]]:
    """Подтверждает расписание. Возвращает, стал ли его ритм активным, и что ушло в архив."""
    email = schedule.user_email
    activated = not WeeklyScheduleTemplate.objects.filter(user_email=email, active=True).exists()
    replaced = {
        str(row_id): status
        for row_id, status in StudySchedule.objects.filter(
            course_plan_id=schedule.course_plan_id, status__in=_REPLACED_STATUSES
        )
        .exclude(pk=schedule.pk)
        .values_list("id", "status")
    }
    try:
        confirm_schedule(schedule, keep_active_rhythm=True)
    except ScheduleNotConfirmable as exc:
        raise QuickPlanRejected("busy", str(exc)) from exc
    return activated, replaced


def _block(
    request: QuickPlanRequest,
    *,
    schedule: StudySchedule,
    plan_id: Any,
    day: date,
    zone: ZoneInfo,
    title: str,
    source: str,
    topic: CourseTopic | None = None,
) -> LearningBlock:
    begins = local_to_utc(day, request.start_time, zone)[0]
    return LearningBlock(
        user_email=request.user_email,
        schedule=schedule,
        course_plan_id=plan_id,
        module_id=topic.module_id if topic else None,
        topic=topic,
        title=title[:300],
        objective=topic.objective if topic else "",
        mastery_criteria=topic.mastery_criteria if topic else "",
        start_at=begins,
        end_at=begins + timedelta(minutes=request.minutes),
        duration_minutes=request.minutes,
        detail_level=LearningBlock.DetailLevel.OUTLINE,
        source=source,
        created_by="assistant",
    )


def _subject_only(request: QuickPlanRequest) -> QuickPlanResult:
    goal = _new_goal(request)
    return QuickPlanResult(
        path="subject_only",
        subject=_goal_name(goal),
        goal_id=str(goal.id),
        created_goal=True,
        schedule_id=None,
        sessions=0,
        first_date=None,
        last_date=None,
        left_topics=0,
        approves_plan=False,
        undo={"goal_id": str(goal.id)},
    )


def _new_sessions(
    request: QuickPlanRequest,
    goal: LearningGoal | None,
    weekdays: tuple[int, ...],
    days: list[date],
    zone: ZoneInfo,
) -> QuickPlanResult:
    created_goal = goal is None
    goal = goal or _new_goal(request)
    name = _goal_name(goal)
    material = StudyMaterial.objects.create(
        user_email=request.user_email,
        goal=goal,
        kind=StudyMaterial.Kind.CUSTOM,
        title=name[:400],
        total_units=len(days),
        minutes_per_unit=request.minutes,
    )
    plan = materials_service.build_plan(material, target_session_minutes=request.minutes, start_date=days[0])
    # Страница курса говорит о том же темпе, что и карточка.
    plans_service.repace_plan(
        plan, sessions_per_week=len(weekdays), minutes_per_session=request.minutes, start_date=days[0]
    )
    plans_service.approve_plan(plan, user_email=request.user_email)
    template = _assistant_template(request, weekdays, days[0], zone)
    schedule = StudySchedule.objects.create(
        user_email=request.user_email,
        course_plan=plan,
        template=template,
        start_date=days[0],
        end_date=days[-1],
        timezone=zone.key,
        status=StudySchedule.Status.PROPOSED,
        generation_source="assistant",
    )
    topics = CourseTopic.objects.filter(module__plan=plan).order_by("order_index")
    LearningBlock.objects.bulk_create(
        [
            _block(
                request,
                schedule=schedule,
                plan_id=plan.id,
                day=day,
                zone=zone,
                title=f"{name}, занятие {number}",
                source=LearningBlock.Source.SCHEDULER,
                topic=topic,
            )
            for number, (day, topic) in enumerate(zip(days, topics), start=1)
        ]
    )
    activated, _ = _confirm(schedule)
    return QuickPlanResult(
        path="new_sessions",
        subject=name,
        goal_id=str(goal.id),
        created_goal=created_goal,
        schedule_id=str(schedule.id),
        sessions=len(days),
        first_date=days[0],
        last_date=days[-1],
        left_topics=0,
        approves_plan=False,
        undo={
            # Предмет был и раньше: удаляем только то, что появилось сейчас.
            "goal_id": str(goal.id) if created_goal else None,
            "plan_id": str(plan.id),
            "material_id": str(material.id),
            "schedule_id": str(schedule.id),
            "template_id": str(template.id),
            "activated_template": activated,
        },
    )


def _book_topics(
    request: QuickPlanRequest,
    goal: LearningGoal,
    plan: CoursePlan,
    weekdays: tuple[int, ...],
    days: list[date],
    zone: ZoneInfo,
) -> QuickPlanResult:
    approves = plan.status == CoursePlan.Status.AWAITING_APPROVAL
    enrolled = CourseEnrollment.objects.filter(plan=plan, user_email=request.user_email).exists()
    template = _assistant_template(request, weekdays, days[0], zone)
    try:
        if approves:
            plans_service.approve_plan(plan, user_email=request.user_email)
        outcome = generate_schedule(
            plan=plan,
            start_date=days[0],
            end_date=days[-1],
            timezone_name=zone.key,
            template=template,
            provider_key="deterministic",
            buffer_percentage=0,
        )
    except (ScheduleGenerationError, ValueError) as exc:
        raise QuickPlanRejected("no_room", str(exc)) from exc

    schedule = outcome.schedule
    blocks = list(schedule.blocks.order_by("start_at"))
    if not blocks:
        raise QuickPlanRejected("no_room", "В этот период не помещается ни одного занятия.")

    # Период короче программы, и это нормально: остальные темы можно поставить потом.
    schedule.conflict_report = {}
    schedule.pacing_snapshot = {**(schedule.pacing_snapshot or {}), "partial_by_period": True}
    schedule.save(update_fields=["conflict_report", "pacing_snapshot", "updated_at"])
    activated, replaced = _confirm(schedule)

    placed = {block.topic_id for block in blocks if block.topic_id}
    local_days = sorted({block.start_at.astimezone(zone).date() for block in blocks})
    return QuickPlanResult(
        path="book_topics",
        subject=_goal_name(goal),
        goal_id=str(goal.id),
        created_goal=False,
        schedule_id=str(schedule.id),
        sessions=len(local_days),
        first_date=local_days[0],
        last_date=local_days[-1],
        left_topics=CourseTopic.objects.filter(module__plan=plan).exclude(pk__in=placed).count(),
        approves_plan=approves,
        undo={
            "schedule_id": str(schedule.id),
            "archive_schedule": True,
            "previous_statuses": replaced,
            "template_id": str(template.id),
            "activated_template": activated,
            "unapprove_plan_id": str(plan.id) if approves else None,
            "enrollment_existed": enrolled,
        },
    )


def _next_topics(schedule: StudySchedule) -> list[CourseTopic]:
    """Темы книги, которых ещё нет в расписании, по порядку изучения. Без книги тем нет."""
    plan = schedule.course_plan
    if not plan.document_id:
        return []
    placed = set(schedule.blocks.exclude(status__in=_RELEASED_BLOCK_STATUSES).values_list("topic_id", flat=True))
    topics = {topic.external_id: topic for topic in CourseTopic.objects.filter(module__plan=plan)}
    order = plans_service.topics_in_study_order(plan)
    return [topics[key] for key in order if key in topics and topics[key].pk not in placed]


def _extra_sessions(
    request: QuickPlanRequest, goal: LearningGoal, schedule: StudySchedule, days: list[date], zone: ZoneInfo
) -> QuickPlanResult:
    name = _goal_name(goal)
    already = schedule.blocks.exclude(status__in=_RELEASED_BLOCK_STATUSES).count()
    topics = _next_topics(schedule)
    rows = []
    for index, day in enumerate(days):
        topic = topics[index] if index < len(topics) else None
        rows.append(
            _block(
                request,
                schedule=schedule,
                plan_id=schedule.course_plan_id,
                day=day,
                zone=zone,
                title=topic.title if topic else f"{name}, занятие {already + index + 1}",
                source=LearningBlock.Source.MANUAL,
                topic=topic,
            )
        )
    blocks = LearningBlock.objects.bulk_create(rows)
    previous_end = schedule.end_date
    schedule.version += 1
    schedule.end_date = max(previous_end, days[-1])
    schedule.save(update_fields=["version", "end_date", "updated_at"])
    return QuickPlanResult(
        path="extra_sessions",
        subject=name,
        goal_id=str(goal.id),
        created_goal=False,
        schedule_id=str(schedule.id),
        sessions=len(days),
        first_date=days[0],
        last_date=days[-1],
        left_topics=max(0, len(topics) - len(days)),
        approves_plan=False,
        undo={
            "extended_schedule_id": str(schedule.id),
            "block_ids": [str(block.id) for block in blocks],
            "end_date": previous_end.isoformat(),
        },
    )


def _live_schedule(goal: LearningGoal) -> StudySchedule | None:
    """Расписание, по которому предмет уже идёт."""
    schedule = (
        StudySchedule.objects.filter(
            user_email=goal.user_email,
            course_plan__goal=goal,
            status__in=(StudySchedule.Status.ACTIVE, StudySchedule.Status.CONFIRMED),
        )
        .exclude(course_plan__status=CoursePlan.Status.ARCHIVED)
        .order_by("-created_at")
        .first()
    )
    if schedule is None:
        return None
    # Календарь показывает новое предложение вместо него, а подтверждение отправит старое в архив:
    # занятия ушли бы туда, где их не видно, и потом пропали бы.
    shown = calendar_schedules(goal.user_email).filter(course_plan_id=schedule.course_plan_id).first()
    if shown is not None and shown.pk != schedule.pk:
        raise QuickPlanRejected(
            "pending_proposal",
            "По этому предмету ждёт новый вариант расписания. Сначала подтверди его или отмени.",
        )
    return schedule


def _book_plan(goal: LearningGoal) -> CoursePlan | None:
    """Программа по книге: активная в приоритете. Остальные статусы подтвердить нельзя."""
    plans = CoursePlan.objects.filter(
        user_email=goal.user_email,
        goal=goal,
        status__in=(CoursePlan.Status.ACTIVE, CoursePlan.Status.AWAITING_APPROVAL),
    ).order_by("-created_at")
    plan = plans.filter(status=CoursePlan.Status.ACTIVE).first() or plans.first()
    return plan if plan is not None and plan.document_id else None


def _run(request: QuickPlanRequest) -> QuickPlanResult:
    weekdays = _checked_weekdays(request)
    goal = _find_goal(request)
    if not weekdays:
        if goal is not None:
            raise QuickPlanRejected("already_exists", f"Предмет «{_goal_name(goal)}» уже есть.")
        return _subject_only(request)

    schedule = _live_schedule(goal) if goal is not None else None
    plan = _book_plan(goal) if goal is not None and schedule is None else None
    # У существующего расписания зона уже часть обещания: браузер в поездке её не сдвигает.
    zone = resolve_zone(schedule.timezone if schedule is not None else request.timezone)
    days = _fitting_days(request, weekdays, zone)
    busy = _first_busy(
        request.user_email,
        days,
        request.start_time,
        request.minutes,
        zone,
        own_plan_id=str(plan.id) if plan is not None else None,
    )
    if busy:
        raise QuickPlanRejected("busy", busy)

    if schedule is not None:
        return _extra_sessions(request, goal, schedule, days, zone)
    if plan is not None:
        return _book_topics(request, goal, plan, weekdays, days, zone)
    return _new_sessions(request, goal, weekdays, days, zone)


def _check_card(request: QuickPlanRequest, result: QuickPlanResult) -> None:
    """Карточка показала одно, а получилось другое: записывать нельзя."""
    other_path = request.expected_path and request.expected_path != result.path
    other_count = request.expected_sessions is not None and request.expected_sessions != result.sessions
    if other_path or other_count:
        raise QuickPlanRejected(
            "changed",
            f"С тех пор всё изменилось: сейчас получится занятий: {result.sessions}. Попроси предложить заново.",
        )


def _as_saved(result: QuickPlanResult) -> dict[str, Any]:
    saved = asdict(result)
    saved["first_date"] = result.first_date.isoformat() if result.first_date else None
    saved["last_date"] = result.last_date.isoformat() if result.last_date else None
    return saved


def _from_saved(saved: dict[str, Any]) -> QuickPlanResult:
    first, last = saved["first_date"], saved["last_date"]
    return QuickPlanResult(
        **{
            **saved,
            "first_date": date.fromisoformat(first) if first else None,
            "last_date": date.fromisoformat(last) if last else None,
        }
    )


def preview_quick_plan(request: QuickPlanRequest) -> QuickPlanResult:
    """Тот же расчёт, но в базе ничего не остаётся."""
    with transaction.atomic():
        result = _run(request)
        transaction.set_rollback(True)
    return result


def apply_quick_plan(request: QuickPlanRequest) -> QuickPlanResult:
    with transaction.atomic():
        row = None
        if request.key:
            # Строка первой: вторая вкладка с той же карточкой дождётся конца этой транзакции.
            row, created = AppliedQuickPlan.objects.get_or_create(
                user_email=request.user_email, key=request.key[:64], defaults={"result": {}}
            )
            if not created:
                return _from_saved(row.result)
        result = _run(request)
        _check_card(request, result)
        if row is not None:
            result = replace(result, undo={**result.undo, "key": row.key})
            row.result = _as_saved(result)
            row.save(update_fields=["result"])
        return result


# ───────────────────────────────── Отмена ────────────────────────────────────────


def _as_ids(values: Any) -> list[str]:
    """Отмену присылает клиент: всё, что не похоже на номер, просто не участвует."""
    ids = []
    for value in values if isinstance(values, list) else [values]:
        try:
            ids.append(str(uuid.UUID(str(value))))
        except ValueError:
            continue
    return ids


def _refuse_if_started(blocks) -> None:
    """Кнопка живёт в старой переписке: прогресс не должен пропасть от случайного нажатия."""
    if blocks.filter(status__in=_STARTED_STATUSES).exists():
        raise QuickPlanRejected("undo_stale", "По этим занятиям уже есть прогресс, поэтому вернуть нельзя.")


def undo_quick_plan(undo: dict[str, Any], *, user_email: str) -> None:
    """Возвращает как было. Работает только с данными этого ученика."""
    if not isinstance(undo, dict):
        return
    with transaction.atomic():
        _undo_added_blocks(undo, user_email)
        _undo_new_schedule(undo, user_email)
        _undo_new_rows(undo, user_email)
        for template_id in _as_ids(undo.get("template_id")):
            templates = WeeklyScheduleTemplate.objects.filter(pk=template_id, user_email=user_email)
            if undo.get("activated_template"):
                templates.update(active=False)
            # Архивное расписание держит свой ритм: такой шаблон остаётся.
            templates.filter(schedules__isnull=True).delete()
        AppliedQuickPlan.objects.filter(user_email=user_email, key=str(undo.get("key") or "")).delete()


def _undo_added_blocks(undo: dict[str, Any], email: str) -> None:
    schedule_ids = _as_ids(undo.get("extended_schedule_id"))
    if not schedule_ids:
        return
    blocks = LearningBlock.objects.filter(
        user_email=email, schedule_id=schedule_ids[0], pk__in=_as_ids(undo.get("block_ids"))
    )
    _refuse_if_started(blocks)
    blocks.delete()
    schedule = StudySchedule.objects.filter(pk=schedule_ids[0], user_email=email).first()
    if schedule is None:
        return
    schedule.version += 1
    try:
        schedule.end_date = date.fromisoformat(str(undo.get("end_date")))
    except ValueError:
        pass
    schedule.save(update_fields=["version", "end_date", "updated_at"])


def _undo_new_schedule(undo: dict[str, Any], email: str) -> None:
    if not undo.get("archive_schedule"):
        return
    schedule_ids = _as_ids(undo.get("schedule_id"))
    if schedule_ids:
        _refuse_if_started(LearningBlock.objects.filter(user_email=email, schedule_id=schedule_ids[0]))
        schedule = StudySchedule.objects.filter(pk=schedule_ids[0], user_email=email).first()
        if schedule is not None and schedule.status != StudySchedule.Status.ACTIVE:
            # С тех пор расписание заменили: откат вернул бы программу мимо нового.
            raise QuickPlanRejected("undo_stale", "Это расписание уже заменили, поэтому вернуть нельзя.")
        StudySchedule.objects.filter(pk=schedule_ids[0], user_email=email).update(
            status=StudySchedule.Status.ARCHIVED, updated_at=django_timezone.now()
        )
    previous = undo.get("previous_statuses")
    if isinstance(previous, dict):
        for row_id, status in previous.items():
            if status in _REPLACED_STATUSES:
                StudySchedule.objects.filter(pk__in=_as_ids(row_id), user_email=email).update(
                    status=status, updated_at=django_timezone.now()
                )
    for plan_id in _as_ids(undo.get("unapprove_plan_id")):
        plan = CoursePlan.objects.filter(pk=plan_id, user_email=email).first()
        if plan is None:
            continue
        plan.status = CoursePlan.Status.AWAITING_APPROVAL
        plan.approved_at = None
        plan.save(update_fields=["status", "approved_at", "updated_at"])
        CoursePlanVersion.objects.filter(plan=plan, version=plan.current_version).update(
            approved_by_student=False, approved_at=None
        )
        if not undo.get("enrollment_existed"):
            CourseEnrollment.objects.filter(plan=plan, user_email=email).delete()


def _undo_new_rows(undo: dict[str, Any], email: str) -> None:
    """То, что появилось только ради этой просьбы, удаляется целиком."""
    for goal_id in _as_ids(undo.get("goal_id")):
        goal = LearningGoal.objects.filter(pk=goal_id, user_email=email).first()
        if goal is None:
            continue
        # Удаление предмета уносит всё, что к нему привязано, а карточка говорила только о своём.
        if (
            Document.objects.filter(goal=goal).exists()
            or SubjectChat.objects.filter(goal=goal).exists()
            or StudyMaterial.objects.filter(goal=goal).exclude(pk__in=_as_ids(undo.get("material_id"))).exists()
            or CoursePlan.objects.filter(goal=goal).exclude(pk__in=_as_ids(undo.get("plan_id"))).exists()
        ):
            raise QuickPlanRejected(
                "undo_stale", "К этому предмету уже добавлены книги или разговоры, поэтому вернуть нельзя."
            )
        _refuse_if_started(LearningBlock.objects.filter(user_email=email, course_plan__goal=goal))
        plans_service.delete_goal(goal)
        return
    for plan_id in _as_ids(undo.get("plan_id")):
        plan = CoursePlan.objects.filter(pk=plan_id, user_email=email).first()
        if plan is None:
            continue
        _refuse_if_started(LearningBlock.objects.filter(user_email=email, course_plan=plan))
        plans_service.delete_plan(plan)
    for material_id in _as_ids(undo.get("material_id")):
        StudyMaterial.objects.filter(pk=material_id, user_email=email).delete()
