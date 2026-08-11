"""Недельный шаблон + занятое время → конкретные свободные окна.

Здесь живёт единственное место в системе, где локальное время превращается в
момент времени, поэтому здесь же разбираются переходы на летнее время.

**Почему нельзя считать «предыдущий старт + 7 дней» в UTC.** Ритм задан
локальными часами: «вторник, 17:00». После перевода стрелок такой сдвиг дал бы
16:00 или 18:00 по местному времени, то есть ритм, ради устойчивости которого
всё и затевалось, поехал бы сам собой. Поэтому каждый слот строится заново из
пары (локальная дата, локальное время) и только потом переводится в UTC.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo

from .contracts import (
    MIN_PART_MINUTES,
    CommitmentSpec,
    FreeSlot,
    TemplateSpec,
)

UTC = dt_timezone.utc

# Коды предупреждений. Строками, а не исключениями: расписание должно быть
# построено даже в переходный день, но ученик обязан узнать, что время сдвинулось.
WARN_DST_GAP = "dst_gap_shifted"
WARN_DST_AMBIGUOUS = "dst_ambiguous_first"
WARN_OVERLAP_DROPPED = "overlapping_slots_dropped"
WARN_BUSY_SWALLOWED = "slots_fully_busy"
WARN_UNKNOWN_TIMEZONE = "unknown_timezone_utc_used"


def resolve_zone(name: str) -> ZoneInfo:
    """Зона по имени; неизвестное имя не роняет генерацию, а даёт UTC.

    Имя приходит из браузера и хранится строкой. Опечатка в нём — повод
    предупредить, а не отказать ученику в расписании целиком.
    """
    try:
        return ZoneInfo(name or "UTC")
    except Exception:  # noqa: BLE001 — ZoneInfoNotFoundError и любые её кузены
        return ZoneInfo("UTC")


def _is_nonexistent(local_dt: datetime) -> bool:
    """Локального времени в этот день не существует (весенний перевод).

    Проверка кругом через UTC: у несуществующего времени обратный перевод даёт
    другие стенные часы, потому что в самой зоне такой отметки нет.
    """
    return local_dt.astimezone(UTC).astimezone(local_dt.tzinfo) != local_dt


def _is_ambiguous(local_dt: datetime) -> bool:
    """Локальное время в этот день встречается дважды (осенний возврат)."""
    return local_dt.utcoffset() != local_dt.replace(fold=1).utcoffset()


def local_to_utc(
    local_date: date, local_time: time, zone: ZoneInfo
) -> tuple[datetime, str]:
    """(локальная дата, локальное время) → момент в UTC.

    Возвращает ещё и код предупреждения, если день переходный:

    * разрыв — берётся момент, отсчитанный от времени ДО перевода, поэтому
      занятие проходит настолько же позже начала суток, насколько планировалось,
      просто стенные часы показывают время после скачка;
    * неоднозначность — берётся первое вхождение (`fold=0`), то есть занятие
      случается один раз, а не «в оба часа».
    """
    naive = datetime.combine(local_date, local_time)
    local_dt = naive.replace(tzinfo=zone)

    if _is_nonexistent(local_dt):
        return local_dt.astimezone(UTC), WARN_DST_GAP
    if _is_ambiguous(local_dt):
        return local_dt.replace(fold=0).astimezone(UTC), WARN_DST_AMBIGUOUS
    return local_dt.astimezone(UTC), ""


def _dates_in_range(start: date, end: date):
    day = start
    while day <= end:
        yield day
        day += timedelta(days=1)


def _within(day: date, valid_from: date | None, valid_until: date | None) -> bool:
    if valid_from and day < valid_from:
        return False
    if valid_until and day > valid_until:
        return False
    return True


def busy_intervals(
    commitments: tuple[CommitmentSpec, ...],
    *,
    start_date: date,
    end_date: date,
    zone: ZoneInfo,
) -> list[tuple[datetime, datetime]]:
    """Занятое время в UTC, развёрнутое на весь горизонт.

    Повторяющаяся занятость разворачивается по тем же правилам, что и слоты:
    школа с 8:00 остаётся школой с 8:00 и после перевода часов.
    """
    intervals: list[tuple[datetime, datetime]] = []

    for commitment in commitments:
        if commitment.is_recurring:
            if commitment.duration_minutes <= 0:
                continue
            for day in _dates_in_range(start_date, end_date):
                if day.weekday() != commitment.weekday:
                    continue
                if not _within(day, commitment.valid_from, commitment.valid_until):
                    continue
                start, _ = local_to_utc(day, commitment.start_time, zone)
                intervals.append(
                    (start, start + timedelta(minutes=commitment.duration_minutes))
                )
            continue

        if commitment.start_at and commitment.end_at:
            if commitment.end_at > commitment.start_at:
                intervals.append((commitment.start_at, commitment.end_at))

    intervals.sort()
    return intervals


def _subtract(
    start: datetime, end: datetime, busy: list[tuple[datetime, datetime]]
) -> list[tuple[datetime, datetime]]:
    """Окно минус занятые отрезки. Может дать ноль, один или несколько кусков."""
    pieces = [(start, end)]
    for busy_start, busy_end in busy:
        if busy_end <= start or busy_start >= end:
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
            break
    return pieces


def expand_free_slots(
    template: TemplateSpec,
    commitments: tuple[CommitmentSpec, ...],
    *,
    start_date: date,
    end_date: date,
    timezone_name: str | None = None,
) -> tuple[list[FreeSlot], list[str]]:
    """Развернуть шаблон на период и вычесть занятое время.

    Порядок результата строго хронологический и стабильный: при равном начале
    окна сортируются по `slot_id`, поэтому одинаковый вход даёт одинаковый
    список на любой машине.
    """
    zone_name = timezone_name or template.timezone
    zone = resolve_zone(zone_name)
    warnings: set[str] = set()
    if zone.key != (zone_name or "UTC"):
        warnings.add(WARN_UNKNOWN_TIMEZONE)

    busy = busy_intervals(
        commitments, start_date=start_date, end_date=end_date, zone=zone
    )

    free: list[FreeSlot] = []
    for day in _dates_in_range(start_date, end_date):
        if not _within(day, template.valid_from, template.valid_until):
            continue

        # Слоты дня строятся целиком, потом чистятся от пересечений: в день
        # весеннего перевода два разных слота способны схлопнуться в один и тот
        # же момент UTC, и без этой проверки получились бы два блока внахлёст.
        day_slots: list[tuple[datetime, datetime, object]] = []
        for slot in sorted(
            template.slots, key=lambda item: (item.start_time, item.slot_id)
        ):
            if slot.weekday != day.weekday() or slot.duration_minutes <= 0:
                continue
            if slot.fixed:
                # Окно, которое ученик держит под своё: в ритме оно видно, но
                # учебный блок туда ставить нельзя.
                continue
            start, warning = local_to_utc(day, slot.start_time, zone)
            if warning:
                warnings.add(warning)
            day_slots.append(
                (start, start + timedelta(minutes=slot.duration_minutes), slot)
            )

        day_slots.sort(key=lambda item: (item[0], item[2].slot_id))
        cursor: datetime | None = None
        for start, end, slot in day_slots:
            if cursor is not None and start < cursor:
                warnings.add(WARN_OVERLAP_DROPPED)
                continue
            cursor = end

            pieces = _subtract(start, end, busy)
            if not pieces:
                warnings.add(WARN_BUSY_SWALLOWED)
                continue
            for index, (piece_start, piece_end) in enumerate(pieces):
                minutes = int((piece_end - piece_start).total_seconds() // 60)
                if minutes < MIN_PART_MINUTES:
                    continue
                free.append(
                    FreeSlot(
                        slot_id=f"{slot.slot_id}:{day.isoformat()}:{index}",
                        local_date=day,
                        start=piece_start,
                        end=piece_end,
                        duration_minutes=minutes,
                        allowed_activity_types=tuple(slot.allowed_activity_types),
                        priority=slot.priority,
                    )
                )

    free.sort(key=lambda item: (item.start, item.slot_id))
    return free, sorted(warnings)
