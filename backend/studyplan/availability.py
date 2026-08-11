"""Где в календаре есть место.

Отдельно от `scheduling/`, потому что здесь нужна база: свободное окно — это
окно шаблона минус занятость ученика минус уже стоящие блоки. Первые два знает
чистый движок, третье — только БД.

Модуль общий для инструментов AI и для будущей вечерней корректировки: оба
отвечают на один и тот же вопрос «куда это можно поставить», и два разных
ответа на него рано или поздно разошлись бы.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from .models import LearningBlock, StudySchedule
from .scheduling.contracts import MIN_PART_MINUTES, FreeSlot
from .scheduling.slots import expand_free_slots, resolve_zone
from .services import (
    calendar_learning_blocks,
    commitment_specs,
    learning_block_commitment_specs,
    template_spec,
)

# Статусы, которые больше не занимают время: отменённое и перенесённое место в
# календаре не держит.
_RELEASED_STATUSES = frozenset(
    {LearningBlock.Status.CANCELLED, LearningBlock.Status.RESCHEDULED}
)


def _subtract(
    slot: FreeSlot, busy: list[tuple[datetime, datetime]]
) -> list[FreeSlot]:
    """Окно минус занятые отрезки. Куски короче минимума не возвращаются."""
    pieces = [(slot.start, slot.end)]
    for busy_start, busy_end in busy:
        if busy_end <= slot.start or busy_start >= slot.end:
            continue
        next_pieces: list[tuple[datetime, datetime]] = []
        for piece_start, piece_end in pieces:
            if busy_end <= piece_start or busy_start >= piece_end:
                next_pieces.append((piece_start, piece_end))
                continue
            if busy_start > piece_start:
                next_pieces.append((piece_start, min(busy_start, piece_end)))
            if busy_end < piece_end:
                next_pieces.append((max(busy_end, piece_start), piece_end))
        pieces = next_pieces
        if not pieces:
            return []

    result: list[FreeSlot] = []
    for index, (start, end) in enumerate(pieces):
        minutes = int((end - start).total_seconds() // 60)
        if minutes < MIN_PART_MINUTES:
            continue
        result.append(
            FreeSlot(
                slot_id=f"{slot.slot_id}#{index}",
                local_date=slot.local_date,
                start=start,
                end=end,
                duration_minutes=minutes,
                allowed_activity_types=slot.allowed_activity_types,
                priority=slot.priority,
            )
        )
    return result


def free_windows(
    schedule: StudySchedule,
    *,
    start_date: date,
    end_date: date,
    exclude_block_ids: tuple[str, ...] = (),
) -> list[FreeSlot]:
    """Свободные окна расписания за период.

    `exclude_block_ids` нужен переносу: блок, который мы двигаем, не должен
    сам себе мешать — иначе «перенеси на час позже» упиралось бы в место,
    которое этот же блок и занимает.
    """
    template = schedule.template
    other_course_blocks = calendar_learning_blocks(
        schedule.user_email,
        exclude_course_plan_id=str(schedule.course_plan_id),
        include_released=False,
    )
    slots, _ = expand_free_slots(
        template_spec(template),
        (
            *commitment_specs(schedule.user_email),
            *learning_block_commitment_specs(other_course_blocks),
        ),
        start_date=start_date,
        end_date=end_date,
        timezone_name=schedule.timezone,
    )
    if not slots:
        return []

    excluded = {str(value) for value in exclude_block_ids}
    occupied = [
        (block.start_at, block.end_at)
        for block in schedule.blocks.exclude(status__in=_RELEASED_STATUSES)
        if str(block.id) not in excluded
    ]
    occupied.sort()

    free: list[FreeSlot] = []
    for slot in slots:
        free.extend(_subtract(slot, occupied))
    free.sort(key=lambda item: (item.start, item.slot_id))
    return free


def next_free_start(
    windows: list[FreeSlot],
    *,
    duration_minutes: int,
    not_before: datetime | None = None,
    activity_type: str = "",
) -> datetime | None:
    """Самое раннее место под занятие такой длины. `None` — места нет."""
    need = timedelta(minutes=duration_minutes)
    for window in windows:
        if activity_type and not window.accepts(activity_type):
            continue
        start = window.start
        if not_before is not None and start < not_before:
            start = not_before
        if start + need <= window.end:
            return start
    return None


def place_sequentially(
    windows: list[FreeSlot],
    durations: list[tuple[str, int, str]],
    *,
    not_before: datetime | None = None,
) -> list[tuple[str, datetime]]:
    """Разложить несколько занятий по окнам подряд, не накладывая их.

    Вход: `(идентификатор, минуты, тип занятия)`. Выход: пары
    `(идентификатор, начало)` для тех, кому место нашлось. Занятия без места
    просто не попадают в ответ — вызывающий обязан это заметить и сказать
    ученику, а не делать вид, что всё разместилось.
    """
    # Локальные копии границ: одно окно способно принять несколько занятий, и
    # курсор внутри него должен двигаться.
    cursors: dict[str, datetime] = {}
    placed: list[tuple[str, datetime]] = []

    for identifier, minutes, activity_type in durations:
        need = timedelta(minutes=minutes)
        for window in windows:
            if activity_type and not window.accepts(activity_type):
                continue
            start = cursors.get(window.slot_id, window.start)
            if not_before is not None and start < not_before:
                start = not_before
            if start + need > window.end:
                continue
            cursors[window.slot_id] = start + need
            placed.append((identifier, start))
            break

    return placed
