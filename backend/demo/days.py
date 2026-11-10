"""Где в днях Алии стоят блоки учёбы. Чистые функции: минуты от полуночи в её зоне.

Обычные дни берут недельный ритм из `content.WEEK_LAYOUT`. Сегодня устроено вокруг
«сейчас»: два блока уже сделаны, один идёт прямо сейчас, дальше ещё несколько.
Исключение одно: если сейчас школа, волейбол или репетитор, блок не может идти
поверх них. Тогда сегодняшний день берётся из ритма, и главная показывает
ближайший блок после занятого времени. Ночью идущий блок всё равно есть: это демо.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from . import content

DAY_START = 6 * 60 + 30
DAY_END = 23 * 60 + 30
NIGHT_FROM = 23 * 60
LAST_MINUTE = 24 * 60 - 1
GAP = 10
# Вокруг уроков и секции нужен запас: дорога, переодеться.
MARGIN = 15


@dataclass(frozen=True)
class Slot:
    day: date
    start: int  # минуты от полуночи
    minutes: int
    plan: str
    kind: str
    running: bool = False

    @property
    def end(self) -> int:
        return self.start + self.minutes


def _clock(value: str) -> int:
    hours, minutes = value.split(":")
    return int(hours) * 60 + int(minutes)


def busy(day: date) -> list[tuple[int, int]]:
    """Занятое время дня с запасом: школа по будням, секция и репетитор."""
    rows: list[tuple[int, int]] = []
    if day.weekday() < 5:
        first = _clock(content.LESSON_TIMES[0][0])
        last = _clock(content.LESSON_TIMES[-1][1])
        rows.append((first - MARGIN, last + MARGIN))
    for _title, _kind, weekday, start, minutes in content.COMMITMENTS:
        if weekday == day.weekday():
            begins = _clock(start)
            rows.append((begins - MARGIN, begins + minutes + MARGIN))
    return sorted(rows)


def _overlaps(start: int, end: int, rows: list[tuple[int, int]]) -> tuple[int, int] | None:
    for row in rows:
        if start < row[1] and row[0] < end:
            return row
    return None


def week_slots(day: date) -> list[Slot]:
    """День по обычному ритму."""
    return [
        Slot(day, _clock(start), minutes, plan, kind)
        for start, minutes, plan, kind in content.WEEK_LAYOUT[day.weekday()]
    ]


def today_slots(day: date, now_minute: int) -> list[Slot]:
    """Сегодня: блок идёт сейчас, если сейчас не занято, а вокруг него остальные."""
    taken = busy(day)
    if _overlaps(now_minute, now_minute + 1, taken):
        return week_slots(day)

    sequence = content.TODAY_SEQUENCE
    index = content.TODAY_RUNNING_INDEX
    minutes, plan, kind = sequence[index]

    # Сейчас не занято, поэтому занятое время либо уже кончилось, либо ещё впереди.
    start = max(0, now_minute - now_minute % 5 - GAP)
    for _row_start, row_end in taken:
        if start < row_end <= now_minute:
            start = row_end
    end = min(start + minutes, LAST_MINUTE)
    for row_start, _row_end in taken:
        if now_minute < row_start < end:
            end = row_start
    if end - start < 15 or end - now_minute < 5:
        return week_slots(day)
    running = Slot(day, start, end - start, plan, kind, running=True)

    if now_minute < DAY_START or now_minute >= NIGHT_FROM:
        rest = [slot for slot in week_slots(day) if not (slot.start < running.end and running.start < slot.end)]
        return sorted([*rest, running], key=lambda slot: slot.start)

    before: list[Slot] = []
    cursor = running.start - GAP
    for minutes, plan, kind in reversed(sequence[:index]):
        begins = cursor - minutes
        if begins < DAY_START or _overlaps(begins, cursor, taken):
            break
        before.insert(0, Slot(day, begins, minutes, plan, kind))
        cursor = begins - GAP

    after: list[Slot] = []
    cursor = running.end + GAP
    for minutes, plan, kind in sequence[index + 1 :]:
        clash = _overlaps(cursor, cursor + minutes, taken)
        while clash is not None:
            cursor = clash[1] + GAP
            clash = _overlaps(cursor, cursor + minutes, taken)
        if cursor + minutes > DAY_END:
            break
        after.append(Slot(day, cursor, minutes, plan, kind))
        cursor += minutes + GAP

    return [*before, running, *after]
