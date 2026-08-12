"""Сборка входа планировщика из моделей и запуск генерации.

Здесь и только здесь домен `curriculum` встречается с движком расписания.
Движок остаётся чистым, а этот слой отвечает на вопрос «откуда взять темы,
порядок, зависимости и занятость».
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, replace
from datetime import date, time, timedelta

from django.db import transaction
from django.db.models import Case, F, IntegerField, OuterRef, Subquery, Value, When
from django.db.models.functions import Coalesce
from django.utils import timezone as django_timezone

from curriculum.models import (
    CourseDependency,
    CoursePlan,
    CourseSourceBinding,
    CourseTopic,
)
from curriculum.services.plans import repace_plan, topics_in_study_order

from .models import (
    FixedCommitment,
    LearningBlock,
    StudySchedule,
    TemplateSlot,
    WeeklyScheduleTemplate,
)
from .planning.contracts import PacingConstraints, PacingRequest
from .planning.providers import DeterministicPacingProvider, get_pacing_provider
from .planning.validation import PacingValidationReport, validate_pacing
from .scheduling.contracts import (
    DEFAULT_DETAILED_HORIZON_DAYS,
    MIN_PART_MINUTES,
    CommitmentSpec,
    PacingPlan,
    ScheduleGenerationRequest,
    SlotSpec,
    TemplateSpec,
)
from .scheduling.engine import build_schedule
from .scheduling.materialize import materialize
from .scheduling.pacing import (
    TopicInput,
    default_template,
    weekly_pattern_from_template,
)
from .scheduling.slots import busy_intervals, local_to_utc, resolve_zone

logger = logging.getLogger(__name__)

# Горизонт по умолчанию, если у программы нет прогноза даты завершения.
# Три месяца — верхняя граница из постановки: дальше план перестаёт быть
# планом и становится гаданием.
DEFAULT_HORIZON_DAYS = 90
MAX_HORIZON_DAYS = 120

_RELEASED_BLOCK_STATUSES = (
    LearningBlock.Status.CANCELLED,
    LearningBlock.Status.RESCHEDULED,
)


class ScheduleGenerationError(RuntimeError):
    """Расписание построить нельзя: нет программы, нет тем или нет ритма."""


@dataclass(frozen=True)
class GenerationOutcome:
    schedule: StudySchedule
    blocks: list[LearningBlock]
    feasible: bool
    warnings: tuple[str, ...]


# ────────────────────────────── Модель → спека ───────────────────────────────


def template_spec(template: WeeklyScheduleTemplate) -> TemplateSpec:
    return TemplateSpec(
        timezone=template.timezone,
        slots=tuple(
            SlotSpec(
                slot_id=str(slot.id),
                weekday=slot.weekday,
                start_time=slot.start_time,
                duration_minutes=slot.duration_minutes,
                allowed_activity_types=tuple(slot.allowed_activity_types or ()),
                fixed=slot.fixed,
                priority=slot.priority,
            )
            for slot in template.slots.all()
        ),
        max_minutes_per_day=template.max_minutes_per_day,
        max_minutes_per_week=template.max_minutes_per_week,
        valid_from=template.valid_from,
        valid_until=template.valid_until,
    )


def commitment_specs(user_email: str) -> tuple[CommitmentSpec, ...]:
    return tuple(
        CommitmentSpec(
            title=item.title,
            weekday=item.weekday,
            start_time=item.start_time,
            duration_minutes=item.duration_minutes,
            valid_from=item.valid_from,
            valid_until=item.valid_until,
            start_at=item.start_at,
            end_at=item.end_at,
        )
        for item in FixedCommitment.objects.filter(user_email=user_email)
    )


def calendar_schedules(user_email: str):
    """Одна рабочая версия расписания на курс для общего календаря.

    Новая выполнимая proposal-версия заменяет старую active-версию в preview.
    Невыполнимое предложение старый рабочий календарь не скрывает. Если же у
    курса ещё нет ни одной выполнимой версии, возвращается его новейший
    proposal с частичными блоками и conflict report.

    Выбор вынесен сюда, чтобы API, генератор и проверки конфликтов видели
    ровно одну и ту же картину занятости.
    """
    candidates = StudySchedule.objects.filter(
        user_email=user_email,
        status__in=StudySchedule.CALENDAR_STATUSES,
    )
    same_course = StudySchedule.objects.filter(
        user_email=user_email,
        course_plan_id=OuterRef("course_plan_id"),
        status__in=StudySchedule.CALENDAR_STATUSES,
    ).annotate(
        _status_priority=Case(
            When(status=StudySchedule.Status.PROPOSED, then=Value(4)),
            When(status=StudySchedule.Status.DRAFT, then=Value(3)),
            When(status=StudySchedule.Status.ACTIVE, then=Value(2)),
            When(status=StudySchedule.Status.CONFIRMED, then=Value(1)),
            default=Value(0),
            output_field=IntegerField(),
        )
    )
    ordering = ("-created_at", "-_status_priority", "id")
    newest_feasible = same_course.filter(conflict_report={}).order_by(*ordering)
    newest_any = same_course.order_by(*ordering)
    chosen_id = Coalesce(
        Subquery(newest_feasible.values("id")[:1]),
        Subquery(newest_any.values("id")[:1]),
    )
    return candidates.annotate(_calendar_schedule_id=chosen_id).filter(
        id=F("_calendar_schedule_id")
    )


def calendar_learning_blocks(
    user_email: str,
    *,
    exclude_course_plan_id: str | None = None,
    include_released: bool = True,
):
    """Блоки того же календаря, который отдаётся пользовательскому API."""
    schedules = calendar_schedules(user_email)
    if exclude_course_plan_id is not None:
        schedules = schedules.exclude(course_plan_id=exclude_course_plan_id)
    blocks = LearningBlock.objects.filter(
        user_email=user_email,
        schedule__in=schedules,
    )
    if not include_released:
        blocks = blocks.exclude(status__in=_RELEASED_BLOCK_STATUSES)
    return blocks


def learning_block_commitment_specs(blocks) -> tuple[CommitmentSpec, ...]:
    """Представить уже стоящие уроки как разовую занятость scheduler-а."""
    return tuple(
        CommitmentSpec(
            title=block.title,
            start_at=block.start_at,
            end_at=block.end_at,
        )
        for block in blocks
    )


def _study_minutes_by_local_day(
    blocks: list[LearningBlock], timezone_name: str
) -> tuple[tuple[date, int], ...]:
    """Разнести даже пересекающий полночь блок по локальным дням."""
    zone = resolve_zone(timezone_name)
    daily: dict[date, int] = {}
    for block in blocks:
        day = block.start_at.astimezone(zone).date()
        last_day = block.end_at.astimezone(zone).date()
        while day <= last_day:
            day_start, _ = local_to_utc(day, time(0, 0), zone)
            day_end, _ = local_to_utc(
                day + timedelta(days=1), time(0, 0), zone
            )
            overlap_start = max(block.start_at, day_start)
            overlap_end = min(block.end_at, day_end)
            minutes = max(
                0, int((overlap_end - overlap_start).total_seconds() // 60)
            )
            if minutes:
                daily[day] = daily.get(day, 0) + minutes
            day += timedelta(days=1)
    return tuple(sorted(daily.items()))


def _calendar_occupancy(
    *,
    user_email: str,
    exclude_course_plan_id: str,
    start_date: date,
    end_date: date,
    timezone_name: str,
) -> tuple[tuple[CommitmentSpec, ...], tuple[tuple[date, int], ...]]:
    """Занятость и учебная нагрузка других курсов в нужном горизонте."""
    zone = resolve_zone(timezone_name)
    range_start, _ = local_to_utc(start_date, time(0, 0), zone)
    range_end, _ = local_to_utc(end_date + timedelta(days=1), time(0, 0), zone)
    blocks = list(
        calendar_learning_blocks(
            user_email,
            exclude_course_plan_id=exclude_course_plan_id,
            include_released=False,
        )
        .filter(end_at__gt=range_start, start_at__lt=range_end)
        .only("title", "start_at", "end_at", "duration_minutes")
    )

    specs = learning_block_commitment_specs(blocks)
    return specs, _study_minutes_by_local_day(blocks, timezone_name)


def topic_inputs(plan: CoursePlan) -> list[TopicInput]:
    """Темы программы в учебном порядке, с привязками к книге.

    Порядок берётся у `topics_in_study_order` — топологической сортировки,
    которая уже учитывает prerequisites. Темы, не попавшие в её результат
    (такое возможно при цикле в зависимостях, который сортировка обрывает),
    дописываются в конце: молча потерять тему из календаря нельзя.
    """
    # Одним запросом, а не по модулю за раз: на «Механике» Мякишева в плане
    # больше пятисот тем, и обход `module.topics` дал бы полсотни запросов там,
    # где хватает одного.
    natural_order = list(
        CourseTopic.objects.filter(module__plan=plan)
        .select_related("module")
        .order_by("module__order_index", "order_index")
    )
    by_external = {topic.external_id: topic for topic in natural_order}

    ordered_ids = topics_in_study_order(plan)
    ordered: list[object] = []
    seen: set[str] = set()
    for external_id in ordered_ids:
        topic = by_external.get(external_id)
        if topic is not None and external_id not in seen:
            ordered.append(topic)
            seen.add(external_id)
    for topic in natural_order:
        if topic.external_id not in seen:
            ordered.append(topic)
            seen.add(topic.external_id)

    bindings: dict[str, tuple[list[str], list[str]]] = {}
    binding_rows = CourseSourceBinding.objects.filter(
        topic__module__plan=plan
    ).values_list("topic_id", "section_path", "chunk_id")
    for topic_id, section_path, chunk_id in binding_rows:
        sections, chunks = bindings.setdefault(str(topic_id), ([], []))
        if section_path and section_path not in sections:
            sections.append(section_path)
        if chunk_id and str(chunk_id) not in chunks:
            chunks.append(str(chunk_id))

    result: list[TopicInput] = []
    for topic in ordered:
        sections, chunks = bindings.get(str(topic.id), ([], []))
        result.append(
            TopicInput(
                topic_id=str(topic.id),
                external_id=topic.external_id,
                module_external_id=topic.module.external_id,
                title=topic.title,
                objective=topic.objective,
                mastery_criteria=topic.mastery_criteria,
                estimated_minutes=topic.estimated_minutes,
                duration_breakdown=topic.duration_breakdown,
                theory_practice_balance=topic.theory_practice_balance,
                source_section_ids=tuple(sections),
                source_chunk_ids=tuple(chunks),
            )
        )
    return result


def prerequisite_map(plan: CoursePlan) -> dict[str, tuple[str, ...]]:
    """{topic_id: (topic_id предпосылки, ...)} — идентификаторами, не external_id."""
    result: dict[str, list[str]] = {}
    # Идентификаторы лежат прямо в строке связи — тянуть сами темы незачем.
    rows = CourseDependency.objects.filter(plan=plan).values_list(
        "topic_id", "depends_on_id"
    )
    for topic_id, depends_on_id in rows:
        result.setdefault(str(topic_id), []).append(str(depends_on_id))
    return {key: tuple(value) for key, value in result.items()}


# ─────────────────────────────── Ритм ученика ────────────────────────────────


def ensure_template(
    *,
    user_email: str,
    plan: CoursePlan,
    timezone_name: str,
    start_time: time = time(17, 0),
) -> WeeklyScheduleTemplate:
    """Активный шаблон ученика; если его нет — собрать из темпа программы.

    Требовать построить недельный ритм руками до первого календаря — верный
    способ потерять ученика на пустом экране. Темп программы он уже задавал
    (`PATCH plans/{id}/pace/`), и этого достаточно для осмысленного умолчания.
    """
    existing = (
        WeeklyScheduleTemplate.objects.filter(user_email=user_email, active=True)
        .order_by("-created_at")
        .first()
    )
    if existing is not None and existing.slots.exists():
        return existing

    spec = default_template(
        sessions_per_week=plan.recommended_sessions_per_week or 3,
        session_minutes=plan.recommended_session_minutes or 45,
        timezone_name=timezone_name,
        start_time=start_time,
    )
    if existing is None:
        template = WeeklyScheduleTemplate.objects.create(
            user_email=user_email,
            title="Ритм по умолчанию",
            timezone=timezone_name,
            active=True,
        )
    else:
        # Шаблон есть, но окон в нём нет — достраиваем его, а не заводим второй:
        # два активных ритма у одного ученика означают, что следующая генерация
        # выберет случайный из них.
        template = existing
        template.timezone = timezone_name
        template.save(update_fields=["timezone", "updated_at"])

    TemplateSlot.objects.bulk_create(
        [
            TemplateSlot(
                template=template,
                weekday=slot.weekday,
                start_time=slot.start_time,
                duration_minutes=slot.duration_minutes,
                allowed_activity_types=list(slot.allowed_activity_types),
                priority=slot.priority,
            )
            for slot in spec.slots
        ]
    )
    return template


# ────────────────────────────── Генерация ────────────────────────────────────


def build_pacing(
    *,
    plan: CoursePlan,
    topics: list[TopicInput],
    spec: TemplateSpec,
    prerequisites: dict[str, tuple[str, ...]],
    buffer_percentage: float | None,
    provider_key: str | None = None,
) -> tuple[PacingPlan, list[str], dict]:
    """Ритм занятий: предложение модели, проверенное валидатором.

    Возвращает ритм, предупреждения и отчёт валидатора для снимка.

    При любом блокере — откат на детерминированный ритм, а не отказ и не
    попытка починки вторым платным вызовом. Здесь это правильный обмен, в
    отличие от планирования курса: детерминированный ритм не «деградация», он
    построен из той же разбивки тем и вполне годится для занятий. Платить
    второй раз за то, что уже есть бесплатно, смысла нет.
    """
    warnings: list[str] = []
    provider = get_pacing_provider(provider_key)
    constraints = PacingConstraints(
        min_part_minutes=MIN_PART_MINUTES,
        max_part_minutes=plan.recommended_session_minutes or 45,
        max_minutes_per_day=spec.max_minutes_per_day,
        max_minutes_per_week=spec.max_minutes_per_week,
    )
    goal = plan.goal
    pacing_request = PacingRequest(
        goal_text=goal.original_text if goal else "",
        subject=goal.normalized_subject if goal else "",
        current_level=plan.current_level or (goal.current_level if goal else ""),
        target_level=plan.target_level or (goal.target_level if goal else ""),
        theory_practice_balance=(
            goal.theory_practice_balance if goal else "balanced"
        ),
        language=plan.language,
        topics=tuple(topics),
        prerequisites=prerequisites,
        available_weekdays=tuple(sorted({slot.weekday for slot in spec.slots})),
        sessions_per_week=plan.recommended_sessions_per_week or 3,
        session_minutes=plan.recommended_session_minutes or 45,
        constraints=constraints,
    )

    try:
        pacing = provider.generate_pacing(pacing_request)
    except Exception:  # noqa: BLE001 — сеть, таймаут, разбор: реакция одна
        logger.exception("Провайдер ритма упал, берём детерминированный.")
        warnings.append("pacing_provider_failed")
        pacing = DeterministicPacingProvider().generate_pacing(pacing_request)
        report = PacingValidationReport()
    else:
        report = validate_pacing(
            pacing,
            allowed_topic_ids=pacing_request.allowed_topic_ids,
            prerequisites=prerequisites,
            constraints=constraints,
        )
        if not report.approved:
            logger.info(
                "Ритм от %s забракован: %s",
                provider.name,
                [issue.kind for issue in report.blockers],
            )
            warnings.append("pacing_model_rejected")
            pacing = DeterministicPacingProvider().generate_pacing(pacing_request)

    # Предложенный моделью недельный ритм остаётся ПРЕДЛОЖЕНИЕМ: календарь
    # строится по шаблону ученика. Построение расписания не должно молча
    # переписывать ритм, который человек настроил руками, — на это есть
    # отдельное действие.
    # Буфер: заданный учеником всегда сильнее предложенного моделью. Не задан —
    # берём предложение: у модели есть контекст (сложность курса, срок), а у
    # константы по умолчанию его нет.
    proposed_pattern = pacing.weekly_pattern
    pacing = replace(
        pacing,
        weekly_pattern=weekly_pattern_from_template(spec),
        buffer_percentage=(
            pacing.buffer_percentage
            if buffer_percentage is None
            else buffer_percentage
        ),
    )

    snapshot = {
        "provider": provider.name,
        "validation": report.to_payload(),
        "proposed_weekly_pattern": [
            {
                "weekday": day.weekday,
                "activity_types": list(day.activity_types),
                "preferred_duration_minutes": day.preferred_duration_minutes,
            }
            for day in proposed_pattern
        ],
    }
    return pacing, warnings, snapshot


def build_request(
    *,
    plan: CoursePlan,
    template: WeeklyScheduleTemplate,
    start_date: date,
    end_date: date,
    timezone_name: str,
    buffer_percentage: float | None = None,
    detailed_horizon_days: int = DEFAULT_DETAILED_HORIZON_DAYS,
    provider_key: str | None = None,
) -> tuple[ScheduleGenerationRequest, list[str], dict]:
    topics = topic_inputs(plan)
    if not topics:
        raise ScheduleGenerationError("В программе нет ни одной темы.")

    spec = template_spec(template)
    if not spec.slots:
        raise ScheduleGenerationError("В недельном ритме нет ни одного окна.")

    prerequisites = prerequisite_map(plan)
    pacing, warnings, pacing_snapshot = build_pacing(
        plan=plan,
        topics=topics,
        spec=spec,
        prerequisites=prerequisites,
        buffer_percentage=buffer_percentage,
        provider_key=provider_key,
    )
    occupied_specs, existing_study_minutes = _calendar_occupancy(
        user_email=plan.user_email,
        exclude_course_plan_id=str(plan.id),
        start_date=start_date,
        end_date=end_date,
        timezone_name=timezone_name,
    )

    request = ScheduleGenerationRequest(
        user_email=plan.user_email,
        course_plan_id=str(plan.id),
        template=spec,
        pacing=pacing,
        start_date=start_date,
        end_date=end_date,
        timezone=timezone_name,
        commitments=(*commitment_specs(plan.user_email), *occupied_specs),
        existing_study_minutes=existing_study_minutes,
        prerequisites=prerequisites,
        desired_finish_date=plan.goal.desired_finish_date if plan.goal_id else None,
        detailed_horizon_days=detailed_horizon_days,
    )
    return request, warnings, pacing_snapshot


def resolve_horizon(plan: CoursePlan, start_date: date, end_date: date | None) -> date:
    """Конец горизонта: явный, из прогноза программы или три месяца по умолчанию."""
    if end_date is not None:
        return min(end_date, start_date + timedelta(days=MAX_HORIZON_DAYS))

    forecast = plan.forecast_finish_date
    if forecast and forecast > start_date:
        # Запас в две недели: прогноз — это дата при идеальном исполнении, а
        # календарь должен пережить пару пропусков, не обрываясь на полуслове.
        candidate = forecast + timedelta(days=14)
    else:
        candidate = start_date + timedelta(days=DEFAULT_HORIZON_DAYS)
    return min(candidate, start_date + timedelta(days=MAX_HORIZON_DAYS))


@transaction.atomic
def generate_schedule(
    *,
    plan: CoursePlan,
    start_date: date,
    end_date: date | None = None,
    timezone_name: str = "UTC",
    template: WeeklyScheduleTemplate | None = None,
    buffer_percentage: float | None = None,
    detailed_horizon_days: int = DEFAULT_DETAILED_HORIZON_DAYS,
    provider_key: str | None = None,
) -> GenerationOutcome:
    """Построить расписание и записать его блоки.

    Расписание создаётся в статусе `proposed`: пока ученик не подтвердил ритм,
    календарь — это предложение, а не обязательство (§Фаза 7).
    """
    template = template or ensure_template(
        user_email=plan.user_email, plan=plan, timezone_name=timezone_name
    )
    # У существующего ритма зона уже является частью обещания ученику
    # («вторник в 17:00»). Зона браузера в поездке не должна сдвигать его.
    schedule_timezone = template.timezone
    horizon_end = resolve_horizon(plan, start_date, end_date)

    request, pacing_warnings, pacing_snapshot = build_request(
        plan=plan,
        template=template,
        start_date=start_date,
        end_date=horizon_end,
        timezone_name=schedule_timezone,
        buffer_percentage=buffer_percentage,
        detailed_horizon_days=detailed_horizon_days,
        provider_key=provider_key,
    )
    draft = build_schedule(request)

    schedule = StudySchedule.objects.create(
        user_email=plan.user_email,
        course_plan=plan,
        template=template,
        start_date=start_date,
        end_date=horizon_end,
        timezone=schedule_timezone,
        status=StudySchedule.Status.PROPOSED,
        generation_source=pacing_snapshot.get("provider", "deterministic"),
        pacing_snapshot={
            **pacing_snapshot,
            "weekly_pattern": [
                {
                    "weekday": day.weekday,
                    "activity_types": list(day.activity_types),
                    "preferred_duration_minutes": day.preferred_duration_minutes,
                }
                for day in request.pacing.weekly_pattern
            ],
            "buffer_percentage": request.pacing.buffer_percentage,
            "rationale": request.pacing.rationale,
        },
    )

    # Предупреждения ритма и предупреждения размещения попадают в одно поле:
    # для ученика это один список «что стоит знать про этот календарь».
    draft.warnings = tuple(sorted({*draft.warnings, *pacing_warnings}))

    blocks = materialize(
        draft,
        schedule=schedule,
        prerequisites=request.prerequisites,
        detailed_horizon_days=detailed_horizon_days,
    )
    schedule.refresh_from_db()

    if not draft.feasible:
        # Без текста программы и без e-mail: в лог идёт только то, по чему
        # можно найти расписание и понять масштаб нехватки.
        logger.info(
            "Расписание %s не помещается: не размещено %s частей, перебор %s дн.",
            schedule.id,
            len(draft.conflict.unplaced) if draft.conflict else 0,
            draft.conflict.overrun_days if draft.conflict else 0,
        )

    return GenerationOutcome(
        schedule=schedule,
        blocks=blocks,
        feasible=draft.feasible,
        warnings=draft.warnings,
    )


class ScheduleNotConfirmable(RuntimeError):
    """Расписание нельзя подтвердить в его текущем состоянии."""


def _confirmed_setup_preferences(schedule: StudySchedule) -> tuple[int, int] | None:
    """Темп из доверенного /start-снимка, применяемый только при выборе варианта."""
    snapshot = schedule.pacing_snapshot
    if not isinstance(snapshot, dict):
        return None
    setup_snapshot = snapshot.get("schedule_setup")
    if not isinstance(setup_snapshot, dict):
        return None
    answers = setup_snapshot.get("answers")
    if not isinstance(answers, dict):
        return None

    weekdays = str(answers.get("weekdays") or "").split(",")
    try:
        weekday_values = {int(item) for item in weekdays if item != ""}
        session_minutes = int(answers.get("session_minutes") or 0)
    except (TypeError, ValueError):
        return None
    if (
        not weekday_values
        or not weekday_values.issubset(set(range(7)))
        or not 15 <= session_minutes <= 120
    ):
        return None
    return len(weekday_values), session_minutes


def _activate_selected_rhythm(schedule: StudySchedule) -> None:
    """Make the explicitly confirmed proposal's rhythm and pace current."""
    WeeklyScheduleTemplate.objects.filter(
        user_email=schedule.user_email,
        active=True,
    ).exclude(pk=schedule.template_id).update(
        active=False,
        updated_at=django_timezone.now(),
    )
    if not schedule.template.active:
        WeeklyScheduleTemplate.objects.filter(pk=schedule.template_id).update(
            active=True,
            updated_at=django_timezone.now(),
        )

    preferences = _confirmed_setup_preferences(schedule)
    if preferences is None:
        return
    sessions_per_week, session_minutes = preferences
    plan = CoursePlan.objects.select_for_update().get(pk=schedule.course_plan_id)
    pace_warnings = repace_plan(
        plan,
        sessions_per_week=sessions_per_week,
        minutes_per_session=session_minutes,
        start_date=schedule.start_date,
    )
    # Fixture/legacy plans can have no estimated duration; repace_plan then
    # intentionally skips its forecast, but the explicitly selected rhythm is
    # still the preference used by subsequent scheduling.
    if (
        plan.recommended_sessions_per_week != sessions_per_week
        or plan.recommended_session_minutes != session_minutes
    ):
        plan.recommended_sessions_per_week = sessions_per_week
        plan.recommended_session_minutes = session_minutes
        plan.save(
            update_fields=[
                "recommended_sessions_per_week",
                "recommended_session_minutes",
                "updated_at",
            ]
        )
    if pace_warnings:
        schedule.warnings = list(
            dict.fromkeys([*(schedule.warnings or ()), *pace_warnings])
        )


def _first_cross_course_collision(
    schedule: StudySchedule,
) -> tuple[LearningBlock, LearningBlock] | None:
    own = list(
        schedule.blocks.exclude(status__in=_RELEASED_BLOCK_STATUSES).order_by(
            "start_at", "id"
        )
    )
    if not own:
        return None
    other = list(
        calendar_learning_blocks(
            schedule.user_email,
            exclude_course_plan_id=str(schedule.course_plan_id),
            include_released=False,
        )
        .filter(
            end_at__gt=own[0].start_at,
            start_at__lt=max(item.end_at for item in own),
        )
        .order_by("start_at", "id")
    )

    left = right = 0
    while left < len(own) and right < len(other):
        current = own[left]
        external = other[right]
        if current.start_at < external.end_at and external.start_at < current.end_at:
            return current, external
        if current.end_at <= external.start_at:
            left += 1
        else:
            right += 1
    return None


def _first_fixed_commitment_collision(
    schedule: StudySchedule,
) -> tuple[LearningBlock, str] | None:
    own = list(
        schedule.blocks.exclude(status__in=_RELEASED_BLOCK_STATUSES).order_by(
            "start_at", "id"
        )
    )
    if not own:
        return None
    zone = resolve_zone(schedule.timezone)
    first_day = own[0].start_at.astimezone(zone).date()
    last_day = max(item.end_at for item in own).astimezone(zone).date()
    for commitment in commitment_specs(schedule.user_email):
        intervals = busy_intervals(
            (commitment,), start_date=first_day, end_date=last_day, zone=zone
        )
        for block in own:
            for busy_start, busy_end in intervals:
                if block.start_at < busy_end and busy_start < block.end_at:
                    return block, commitment.title
    return None


@transaction.atomic
def confirm_schedule(schedule: StudySchedule) -> StudySchedule:
    """Ученик принял предложенный календарь: он становится активным.

    Прочие активные расписания той же программы уходят в архив. Двух активных
    календарей по одному курсу быть не может — иначе экран «Сейчас» не сможет
    ответить, какое занятие следующее.
    """
    # /start-confirmation берёт блокировки в том же порядке: сначала программа,
    # затем расписания. Единый порядок не даёт двум вкладкам поймать deadlock.
    CoursePlan.objects.select_for_update().get(pk=schedule.course_plan_id)

    # Подтверждения разных курсов сериализуются общим пользовательским lock:
    # версия одного StudySchedule не замечает движение во втором.
    list(
        StudySchedule.objects.select_for_update()
        .filter(
            user_email=schedule.user_email,
            status__in=StudySchedule.CALENDAR_STATUSES,
        )
        .order_by("id")
        .values_list("id", flat=True)
    )
    schedule = StudySchedule.objects.get(pk=schedule.pk)

    # Повтор потерянного HTTP-ответа не является новым выбором. Между первым
    # подтверждением и retry пользователь уже мог создать следующий proposal;
    # повторное подтверждение старого ACTIVE не должно архивировать его или
    # заново переключать ритм/темп.
    if schedule.status == StudySchedule.Status.ACTIVE:
        return schedule
    if schedule.status in {
        StudySchedule.Status.COMPLETED,
        StudySchedule.Status.ARCHIVED,
    }:
        raise ScheduleNotConfirmable("Завершённое расписание подтвердить нельзя.")
    if not schedule.feasible:
        raise ScheduleNotConfirmable(
            "Расписание не вмещает программу — сначала нужно разрешить конфликт."
        )
    fixed_collision = _first_fixed_commitment_collision(schedule)
    if fixed_collision is not None:
        block, commitment_title = fixed_collision
        raise ScheduleNotConfirmable(
            f"«{block.title}» пересекается с занятостью «{commitment_title}». "
            "Обнови предложение расписания."
        )
    collision = _first_cross_course_collision(schedule)
    if collision is not None:
        own, other = collision
        raise ScheduleNotConfirmable(
            f"«{own.title}» пересекается с «{other.title}» из другого курса. "
            "Обнови предложение расписания."
        )

    # До этого момента подтверждение могло завершиться ошибкой и не имело
    # права менять текущий ритм. Теперь пользователь явно выбрал вариант.
    _activate_selected_rhythm(schedule)

    StudySchedule.objects.filter(
        course_plan=schedule.course_plan,
        status__in=[
            StudySchedule.Status.DRAFT,
            StudySchedule.Status.ACTIVE,
            StudySchedule.Status.CONFIRMED,
            StudySchedule.Status.PROPOSED,
        ],
    ).exclude(pk=schedule.pk).update(
        status=StudySchedule.Status.ARCHIVED, updated_at=django_timezone.now()
    )

    schedule.status = StudySchedule.Status.ACTIVE
    schedule.confirmed_at = django_timezone.now()
    schedule.save(
        update_fields=["status", "confirmed_at", "warnings", "updated_at"]
    )
    return schedule
