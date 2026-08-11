"""Сборка входа планировщика для тестов. Без БД."""

from __future__ import annotations

from datetime import date, time

from studyplan.scheduling.contracts import (
    CommitmentSpec,
    PacingPlan,
    ScheduleGenerationRequest,
    SlotSpec,
    TemplateSpec,
)
from studyplan.scheduling.pacing import TopicInput, build_pacing_plan


def topic(
    external_id: str,
    *,
    theory: int = 25,
    practice: int = 20,
    assessment: int = 15,
    title: str | None = None,
    module: str = "m1",
) -> TopicInput:
    return TopicInput(
        topic_id=f"id-{external_id}",
        external_id=external_id,
        module_external_id=module,
        title=title or f"Тема {external_id}",
        objective=f"Цель {external_id}",
        mastery_criteria="Решает задачи без подсказок",
        estimated_minutes=theory + practice + assessment,
        duration_breakdown={
            "theory_minutes": theory,
            "practice_minutes": practice,
            "assessment_minutes": assessment,
            "total_minutes": theory + practice + assessment,
        },
    )


def slot(
    weekday: int,
    *,
    hour: int = 17,
    minute: int = 0,
    minutes: int = 45,
    allowed: tuple[str, ...] = (),
    slot_id: str | None = None,
    priority: int = 0,
    fixed: bool = False,
) -> SlotSpec:
    return SlotSpec(
        slot_id=slot_id or f"s{weekday}-{hour:02d}{minute:02d}",
        weekday=weekday,
        start_time=time(hour, minute),
        duration_minutes=minutes,
        allowed_activity_types=allowed,
        priority=priority,
        fixed=fixed,
    )


def template(
    *slots: SlotSpec,
    timezone_name: str = "UTC",
    max_day: int = 0,
    max_week: int = 0,
    valid_from: date | None = None,
    valid_until: date | None = None,
) -> TemplateSpec:
    return TemplateSpec(
        timezone=timezone_name,
        slots=tuple(slots),
        max_minutes_per_day=max_day,
        max_minutes_per_week=max_week,
        valid_from=valid_from,
        valid_until=valid_until,
    )


def busy(
    weekday: int, *, hour: int, minute: int = 0, minutes: int = 60, title: str = "Школа"
) -> CommitmentSpec:
    return CommitmentSpec(
        title=title,
        weekday=weekday,
        start_time=time(hour, minute),
        duration_minutes=minutes,
    )


def pacing(
    topics: list[TopicInput],
    *,
    spec: TemplateSpec,
    buffer: float = 0.0,
    session_minutes: int = 45,
) -> PacingPlan:
    return build_pacing_plan(
        topics,
        template=spec,
        max_part_minutes=session_minutes,
        buffer_percentage=buffer,
    )


def request(
    *,
    topics: list[TopicInput],
    spec: TemplateSpec,
    start: date,
    end: date,
    timezone_name: str = "UTC",
    buffer: float = 0.0,
    commitments: tuple[CommitmentSpec, ...] = (),
    prerequisites: dict | None = None,
    desired_finish_date: date | None = None,
    session_minutes: int = 45,
) -> ScheduleGenerationRequest:
    return ScheduleGenerationRequest(
        user_email="student@example.com",
        course_plan_id="plan-1",
        template=spec,
        pacing=pacing(
            topics, spec=spec, buffer=buffer, session_minutes=session_minutes
        ),
        start_date=start,
        end_date=end,
        timezone=timezone_name,
        commitments=commitments,
        prerequisites=prerequisites or {},
        desired_finish_date=desired_finish_date,
    )
