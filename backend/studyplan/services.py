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
from django.utils import timezone as django_timezone

from curriculum.models import (
    CourseDependency,
    CoursePlan,
    CourseSourceBinding,
    CourseTopic,
)
from curriculum.services.plans import topics_in_study_order

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

logger = logging.getLogger(__name__)

# Горизонт по умолчанию, если у программы нет прогноза даты завершения.
# Три месяца — верхняя граница из постановки: дальше план перестаёт быть
# планом и становится гаданием.
DEFAULT_HORIZON_DAYS = 90
MAX_HORIZON_DAYS = 120


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

    request = ScheduleGenerationRequest(
        user_email=plan.user_email,
        course_plan_id=str(plan.id),
        template=spec,
        pacing=pacing,
        start_date=start_date,
        end_date=end_date,
        timezone=timezone_name,
        commitments=commitment_specs(plan.user_email),
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
    horizon_end = resolve_horizon(plan, start_date, end_date)

    request, pacing_warnings, pacing_snapshot = build_request(
        plan=plan,
        template=template,
        start_date=start_date,
        end_date=horizon_end,
        timezone_name=timezone_name,
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
        timezone=timezone_name,
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


@transaction.atomic
def confirm_schedule(schedule: StudySchedule) -> StudySchedule:
    """Ученик принял предложенный календарь: он становится активным.

    Прочие активные расписания той же программы уходят в архив. Двух активных
    календарей по одному курсу быть не может — иначе экран «Сейчас» не сможет
    ответить, какое занятие следующее.
    """
    if schedule.status in {
        StudySchedule.Status.COMPLETED,
        StudySchedule.Status.ARCHIVED,
    }:
        raise ScheduleNotConfirmable("Завершённое расписание подтвердить нельзя.")
    if not schedule.feasible:
        raise ScheduleNotConfirmable(
            "Расписание не вмещает программу — сначала нужно разрешить конфликт."
        )

    StudySchedule.objects.filter(
        course_plan=schedule.course_plan,
        status__in=[
            StudySchedule.Status.ACTIVE,
            StudySchedule.Status.CONFIRMED,
            StudySchedule.Status.PROPOSED,
        ],
    ).exclude(pk=schedule.pk).update(
        status=StudySchedule.Status.ARCHIVED, updated_at=django_timezone.now()
    )

    schedule.status = StudySchedule.Status.ACTIVE
    schedule.confirmed_at = django_timezone.now()
    schedule.save(update_fields=["status", "confirmed_at", "updated_at"])
    return schedule
