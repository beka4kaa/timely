"""Программа → педагогический ритм. Без единой календарной даты.

На Этапе 1 `PacingPlan` строится детерминированно, а модель не вызывается
вовсе — и это не заглушка. Всё, что модель могла бы здесь предложить, уже
посчитано при построении программы: `CourseTopic.duration_breakdown` содержит
разбивку на теорию, практику и проверку (`curriculum/planning/duration.py`), а
темп занятий задал сам ученик через `PATCH plans/{id}/pace/`. Просить модель
придумать это заново означало бы платить за менее точный ответ.

На Этапе 2 сюда встанет провайдер, отдающий ровно тот же `PacingPlan`; всё, что
ниже, останется как детерминированный fallback и как эталон для валидатора.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import time

from curriculum.planning.duration import split_total

from .contracts import (
    DEFAULT_BUFFER_PERCENTAGE,
    MIN_PART_MINUTES,
    LessonPart,
    MilestoneSpec,
    PacingPlan,
    SlotSpec,
    TemplateSpec,
    TopicPacing,
    WeeklyPatternDay,
)

# Дни недели под разное число занятий. Таблица, а не формула: цель — развести
# занятия по неделе, и «три занятия» должны давать понедельник-среду-пятницу, а
# не три дня подряд. Формула, дающая тот же результат, читалась бы хуже таблицы.
_WEEKDAY_SPREAD: dict[int, tuple[int, ...]] = {
    1: (0,),
    2: (0, 3),
    3: (0, 2, 4),
    4: (0, 1, 3, 4),
    5: (0, 1, 2, 3, 4),
    6: (0, 1, 2, 3, 4, 5),
    7: (0, 1, 2, 3, 4, 5, 6),
}

# Как называется часть темы в календаре.
_PART_SUFFIX: dict[str, str] = {
    "theory": "теория",
    "guided_example": "разбор примера",
    "guided_practice": "практика с разбором",
    "independent_practice": "практика",
    "assessment": "проверка",
    "review": "повторение",
}

# Какая среда открывается для типа занятия. Значение по умолчанию — чат с
# тьютором: он умеет всё, тогда как доска или форма ответа подходят не везде.
_WORKSPACE_BY_ACTIVITY: dict[str, str] = {
    "theory": "tutor_chat",
    "guided_example": "smart_board",
    "guided_practice": "smart_board",
    "independent_practice": "answer_form",
    "assessment": "quiz",
    "review": "quiz",
    "reading": "book_reader",
    "homework": "answer_form",
    "coding": "built_in_code_editor",
    "handwritten_problem": "paper_notebook",
    "project": "project_workspace",
    "offline_activity": "offline",
}


def workspace_for(activity_type: str) -> str:
    return _WORKSPACE_BY_ACTIVITY.get(activity_type, "tutor_chat")


@dataclass(frozen=True)
class TopicInput:
    """Тема программы, освобождённая от ORM."""

    topic_id: str
    external_id: str
    module_external_id: str
    title: str
    objective: str = ""
    mastery_criteria: str = ""
    estimated_minutes: int = 0
    duration_breakdown: dict | None = None
    theory_practice_balance: str = "balanced"
    source_section_ids: tuple[str, ...] = ()
    source_chunk_ids: tuple[str, ...] = ()


def _round_to_five(value: float) -> int:
    return int(round(value / 5.0) * 5)


def _breakdown_minutes(topic: TopicInput) -> tuple[int, int, int]:
    """Теория, практика, проверка.

    Разбивка берётся из программы. У планов, построенных до появления
    `duration_breakdown`, словарь пуст — тогда она пересчитывается тем же
    `split_total`, которым её считает генератор программы, а не заменяется
    выдуманным умолчанием.
    """
    data = topic.duration_breakdown or {}
    theory = int(data.get("theory_minutes") or 0)
    practice = int(data.get("practice_minutes") or 0)
    assessment = int(data.get("assessment_minutes") or 0)
    if theory + practice + assessment > 0:
        return theory, practice, assessment

    duration = split_total(topic.estimated_minutes, topic.theory_practice_balance)
    return (
        duration.theory_minutes,
        duration.practice_minutes,
        duration.assessment_minutes,
    )


def _chunk(minutes: int, max_part_minutes: int) -> list[int]:
    """Порезать длинную часть на куски по длине занятия.

    Последний кусок короче минимального не создаётся: он доливается в
    предыдущий. Иначе трёхчасовая практика при сорокапятиминутных занятиях
    заканчивалась бы огрызком в пять минут отдельной строкой календаря.
    """
    if minutes <= 0:
        return []
    limit = max(MIN_PART_MINUTES, max_part_minutes)
    if minutes <= limit:
        return [minutes]

    pieces: list[int] = []
    remaining = minutes
    while remaining > limit:
        pieces.append(limit)
        remaining -= limit
    if remaining < MIN_PART_MINUTES and pieces:
        pieces[-1] += remaining
    elif remaining > 0:
        pieces.append(remaining)
    return pieces


def default_part_plan(topic: TopicInput) -> list[tuple[str, int]]:
    """Разбивка темы на (тип занятия, минуты) без учёта длины занятия.

    Порядок закреплён и повторяет `worked example fading` (§6.4): сначала
    теория, потом разбор на чужом примере, потом самостоятельная работа и
    только затем проверка. Проверка всегда последняя — иначе она проверяла бы
    то, что ученик ещё не делал руками.
    """
    theory, practice, assessment = _breakdown_minutes(topic)
    plan: list[tuple[str, int]] = []

    # Крупная теория разделяется на объяснение и разбор примера: сорок минут
    # подряд читать объяснение — это не урок, а лекция.
    if theory >= 2 * MIN_PART_MINUTES:
        explained = _round_to_five(theory * 0.6) or MIN_PART_MINUTES
        explained = min(theory - MIN_PART_MINUTES, max(MIN_PART_MINUTES, explained))
        plan.append(("theory", explained))
        plan.append(("guided_example", theory - explained))
    elif theory > 0:
        plan.append(("theory", theory))

    # Крупная практика начинается с подсказками и заканчивается самостоятельно.
    if practice >= 2 * MIN_PART_MINUTES:
        guided = _round_to_five(practice * 0.4) or MIN_PART_MINUTES
        guided = min(practice - MIN_PART_MINUTES, max(MIN_PART_MINUTES, guided))
        plan.append(("guided_practice", guided))
        plan.append(("independent_practice", practice - guided))
    elif practice > 0:
        plan.append(("independent_practice", practice))

    if assessment > 0:
        plan.append(("assessment", assessment))

    if not plan:
        # Тема без времени ломала бы прогноз и оставалась бы невидимой в
        # календаре. Минимальное занятие честнее пустоты.
        plan.append(("theory", MIN_PART_MINUTES))

    return plan


def build_lesson_parts(
    topic: TopicInput,
    *,
    max_part_minutes: int = 45,
    part_plan: list[tuple[str, int]] | None = None,
) -> tuple[LessonPart, ...]:
    """Тема → части урока с названиями, целью и ссылками на книгу.

    `part_plan` позволяет подставить разбивку, предложенную моделью. Содержание
    части при этом всё равно собирает backend: модель решает, СКОЛЬКО и КАКОГО
    занятия нужно, но не придумывает ни названий, ни ссылок на разделы книги —
    иначе в календаре появились бы страницы, которых в источнике нет.
    """
    plan = list(part_plan) if part_plan else default_part_plan(topic)

    parts: list[LessonPart] = []
    index = 0
    for activity_type, minutes in plan:
        if minutes <= 0:
            continue
        # Проверку не режем: она короткая по построению, а «проверка, часть 2»
        # не значит ничего.
        pieces = (
            [minutes]
            if activity_type == "assessment"
            else _chunk(minutes, max_part_minutes)
        )
        total_pieces = len(pieces)
        for piece_index, piece in enumerate(pieces, start=1):
            suffix = _PART_SUFFIX.get(activity_type, activity_type)
            if total_pieces > 1:
                suffix = f"{suffix} {piece_index}/{total_pieces}"
            parts.append(
                LessonPart(
                    topic_id=topic.topic_id,
                    topic_external_id=topic.external_id,
                    module_external_id=topic.module_external_id,
                    part_index=index,
                    activity_type=activity_type,
                    duration_minutes=piece,
                    title=f"{topic.title} — {suffix}",
                    objective=topic.objective,
                    mastery_criteria=(
                        topic.mastery_criteria if activity_type == "assessment" else ""
                    ),
                    source_section_ids=tuple(topic.source_section_ids),
                    source_chunk_ids=tuple(topic.source_chunk_ids),
                )
            )
            index += 1

    return tuple(parts)


def default_template(
    *,
    sessions_per_week: int,
    session_minutes: int,
    timezone_name: str,
    start_time: time = time(17, 0),
    max_minutes_per_day: int = 0,
    max_minutes_per_week: int = 0,
) -> TemplateSpec:
    """Ритм по умолчанию для ученика, который ещё не собрал свой.

    Требовать построить недельный шаблон до того, как ученик увидел хоть один
    календарь, — верный способ потерять его на первом же экране.
    """
    count = max(1, min(7, int(sessions_per_week or 1)))
    weekdays = _WEEKDAY_SPREAD[count]
    minutes = max(MIN_PART_MINUTES, int(session_minutes or 45))
    slots = tuple(
        SlotSpec(
            slot_id=f"default-{weekday}",
            weekday=weekday,
            start_time=start_time,
            duration_minutes=minutes,
            allowed_activity_types=(),
            priority=0,
        )
        for weekday in weekdays
    )
    return TemplateSpec(
        timezone=timezone_name,
        slots=slots,
        max_minutes_per_day=max_minutes_per_day,
        max_minutes_per_week=max_minutes_per_week,
    )


def weekly_pattern_from_template(template: TemplateSpec) -> tuple[WeeklyPatternDay, ...]:
    """Описание ритма для показа ученику и для снимка.

    Источник правды о ритме — сам шаблон; этот объект лишь пересказывает его в
    той форме, в которой на Этапе 2 ритм будет предлагать модель.
    """
    by_weekday: dict[int, list] = {}
    for slot in template.slots:
        by_weekday.setdefault(slot.weekday, []).append(slot)

    pattern: list[WeeklyPatternDay] = []
    for weekday in sorted(by_weekday):
        slots = by_weekday[weekday]
        types: list[str] = []
        for slot in slots:
            for activity_type in slot.allowed_activity_types:
                if activity_type not in types:
                    types.append(activity_type)
        pattern.append(
            WeeklyPatternDay(
                weekday=weekday,
                activity_types=tuple(types),
                preferred_duration_minutes=max(
                    slot.duration_minutes for slot in slots
                ),
            )
        )
    return tuple(pattern)


def build_pacing_plan(
    topics: list[TopicInput],
    *,
    template: TemplateSpec,
    max_part_minutes: int = 45,
    buffer_percentage: float = DEFAULT_BUFFER_PERCENTAGE,
    milestones: tuple[MilestoneSpec, ...] = (),
) -> PacingPlan:
    """Собрать ритм из тем, идущих уже в правильном учебном порядке."""
    pacing = tuple(
        TopicPacing(
            topic_id=topic.topic_id,
            topic_external_id=topic.external_id,
            lesson_parts=build_lesson_parts(topic, max_part_minutes=max_part_minutes),
            title=topic.title,
            module_external_id=topic.module_external_id,
        )
        for topic in topics
    )
    return PacingPlan(
        weekly_pattern=weekly_pattern_from_template(template),
        topic_pacing=pacing,
        milestones=milestones,
        buffer_percentage=buffer_percentage,
        rationale="Ритм собран из недельного шаблона и разбивки тем программы.",
    )
