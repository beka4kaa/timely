"""Размещение частей урока по свободным окнам.

Алгоритм жадный и однопроходный: 90 дней × десятки окон × сотни частей должны
считаться за доли секунды, и поиск оптимума здесь не нужен — «устойчивый план»
и «оптимальный по плотности план» это разные вещи, и нужен первый.

**Порядок строго монотонный.** Части размещаются одна за другой в неубывающем
времени, следуя учебному порядку тем (`topics_in_study_order`, топологическая
сортировка уже сделана в `curriculum`). Из монотонности бесплатно следует
соблюдение prerequisites: тема не может начаться раньше своей предпосылки,
потому что вообще ничего не может встать раньше уже размещённого.

Это же объясняет, почему нет отдельного прохода, бронирующего проверки и
контрольные точки заранее. Такой проход нужен там, где поздние части способны
занять ранние окна и вытеснить контроль в конец горизонта; при монотонном
размещении вытеснить нечем.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from .contracts import (
    ConflictReport,
    FreeSlot,
    PlannedBlock,
    ScheduleDraft,
    ScheduleGenerationRequest,
    UnplacedPart,
)
from .slots import expand_free_slots

WARN_NO_SLOTS = "no_free_slots"
WARN_ACTIVITY_NEVER_ALLOWED = "activity_type_never_allowed"
WARN_DEADLINE_MISSED = "desired_finish_date_missed"
WARN_CAPACITY_EXCEEDED = "not_enough_study_time"

_WEEKDAY_NAMES = (
    "понедельник",
    "вторник",
    "среда",
    "четверг",
    "пятница",
    "суббота",
    "воскресенье",
)


@dataclass
class _Placement:
    start: datetime
    end: datetime
    slot_id: str


def _unplaced(part, reason: str) -> UnplacedPart:
    return UnplacedPart(
        topic_external_id=part.topic_external_id,
        activity_type=part.activity_type,
        duration_minutes=part.duration_minutes,
        reason=reason,
    )


def _week_key(day: date) -> tuple[int, int]:
    iso = day.isocalendar()
    return iso[0], iso[1]


class SlotPool:
    """Свободные окна и их расход.

    Состояние держится здесь, а не в модуле, чтобы уроки и повторения делили
    одну и ту же ёмкость: повторение, занявшее вторник, обязано отнять этот
    вторник у уроков, а не создать второй параллельный календарь.
    """

    def __init__(
        self,
        slots: list[FreeSlot],
        *,
        max_minutes_per_day: int = 0,
        max_minutes_per_week: int = 0,
        buffer_percentage: float = 0.0,
    ) -> None:
        self._slots = list(slots)
        # Следующий свободный момент внутри каждого окна.
        self._cursor = [slot.start for slot in self._slots]
        self._day_used: dict[date, int] = {}
        self._week_used: dict[tuple[int, int], int] = {}
        self._max_day = max(0, int(max_minutes_per_day))

        # Буфер применяется к недельной ёмкости, а не выбрасыванием окон:
        # выбросить окно целиком значит зарезервировать 45 минут там, где нужно
        # было 20, а недельный потолок отмеряет ровно ту долю, которая
        # заявлена. Свободным при этом остаётся конец недели — то самое время,
        # в которое и догоняют пропущенное.
        buffer = min(0.9, max(0.0, float(buffer_percentage)))
        self._week_cap: dict[tuple[int, int], int] = {}
        week_total: dict[tuple[int, int], int] = {}
        for slot in self._slots:
            key = _week_key(slot.local_date)
            week_total[key] = week_total.get(key, 0) + slot.duration_minutes
        for key, total in week_total.items():
            cap = int(total * (1.0 - buffer))
            if max_minutes_per_week:
                cap = min(cap, int(max_minutes_per_week))
            self._week_cap[key] = max(0, cap)

    @property
    def total_minutes(self) -> int:
        return sum(slot.duration_minutes for slot in self._slots)

    @property
    def usable_minutes(self) -> int:
        """Ёмкость с учётом буфера и потолков — то, на что реально можно рассчитывать."""
        return sum(self._week_cap.values())

    def allows_activity(self, activity_type: str) -> bool:
        """Есть ли во всём горизонте хоть одно окно под такой тип занятия."""
        return any(slot.accepts(activity_type) for slot in self._slots)

    def place(
        self,
        *,
        duration_minutes: int,
        activity_type: str,
        not_before: datetime | None = None,
        not_after: datetime | None = None,
    ) -> _Placement | None:
        """Найти самое раннее подходящее место. `None` — не поместилось."""
        if duration_minutes <= 0:
            return None
        need = timedelta(minutes=duration_minutes)

        for index, slot in enumerate(self._slots):
            if not slot.accepts(activity_type):
                continue

            start = self._cursor[index]
            if not_before is not None and start < not_before:
                start = not_before
            if start < slot.start:
                start = slot.start
            end = start + need
            if end > slot.end:
                continue
            if not_after is not None and end > not_after:
                continue

            if self._max_day:
                used = self._day_used.get(slot.local_date, 0)
                if used + duration_minutes > self._max_day:
                    continue

            key = _week_key(slot.local_date)
            cap = self._week_cap.get(key, 0)
            if self._week_used.get(key, 0) + duration_minutes > cap:
                continue

            self._cursor[index] = end
            self._day_used[slot.local_date] = (
                self._day_used.get(slot.local_date, 0) + duration_minutes
            )
            self._week_used[key] = self._week_used.get(key, 0) + duration_minutes
            return _Placement(start=start, end=end, slot_id=slot.slot_id)

        return None

    def free_weekdays(self) -> set[int]:
        """Дни недели, в которые окон нет вовсе. Основа для подсказки в конфликте."""
        busy = {slot.local_date.weekday() for slot in self._slots}
        return set(range(7)) - busy

    def weekly_capacity(self) -> int:
        """Средняя недельная ёмкость — для оценки «на сколько недель продлить»."""
        usable = self.usable_minutes
        if usable <= 0:
            return 0
        weeks = max(1, len({_week_key(slot.local_date) for slot in self._slots}))
        return max(1, usable // weeks)


def build_schedule(request: ScheduleGenerationRequest) -> ScheduleDraft:
    """Программа + ритм + занятость → календарь или отчёт о конфликте."""
    from .reviews import place_reviews  # локальный импорт: модули взаимны

    free_slots, warnings_list = expand_free_slots(
        request.template,
        request.commitments,
        start_date=request.start_date,
        end_date=request.end_date,
        timezone_name=request.timezone,
    )
    warnings = set(warnings_list)

    pool = SlotPool(
        free_slots,
        max_minutes_per_day=request.template.max_minutes_per_day,
        max_minutes_per_week=request.template.max_minutes_per_week,
        buffer_percentage=request.pacing.buffer_percentage,
    )

    if not free_slots:
        warnings.add(WARN_NO_SLOTS)

    blocks: list[PlannedBlock] = []
    unplaced: list[UnplacedPart] = []
    # Момент окончания последней размещённой части: ничто не встаёт раньше него.
    cursor: datetime | None = None
    # Когда закончена тема — нужно повторениям.
    topic_finished: dict[str, datetime] = {}

    # Ёмкость кончилась. Всё, что идёт дальше по учебному порядку, размещать
    # уже нельзя: части темы должны стоять подряд, а следующая тема — после
    # предыдущей. Иначе в календаре появилась бы «проверка» темы, теории
    # которой в нём нет, — и это выглядело бы не как нехватка времени, а как
    # сломанный план.
    exhausted = False

    for topic in request.pacing.topic_pacing:
        for part in topic.lesson_parts:
            if exhausted:
                unplaced.append(_unplaced(part, "blocked_by_earlier_part"))
                continue

            # «Нет окна под такой тип занятия» — не нехватка времени, а
            # незаполненный шаблон: чинится галочкой в настройках ритма.
            # Останавливать из-за него весь курс нельзя, иначе забытый тип
            # занятия оставил бы ученика с пустым календарём.
            if free_slots and not pool.allows_activity(part.activity_type):
                warnings.add(WARN_ACTIVITY_NEVER_ALLOWED)
                unplaced.append(_unplaced(part, "no_slot_accepts_activity"))
                continue

            placement = pool.place(
                duration_minutes=part.duration_minutes,
                activity_type=part.activity_type,
                not_before=cursor,
            )
            if placement is None:
                unplaced.append(_unplaced(part, "out_of_capacity"))
                exhausted = True
                continue

            cursor = placement.end
            topic_finished[topic.topic_id] = placement.end
            blocks.append(
                PlannedBlock(
                    start=placement.start,
                    end=placement.end,
                    duration_minutes=part.duration_minutes,
                    activity_type=part.activity_type,
                    title=part.title,
                    kind="lesson",
                    objective=part.objective,
                    topic_id=part.topic_id,
                    topic_external_id=part.topic_external_id,
                    module_external_id=part.module_external_id,
                    mastery_criteria=part.mastery_criteria,
                    source_section_ids=part.source_section_ids,
                    source_chunk_ids=part.source_chunk_ids,
                    slot_id=placement.slot_id,
                )
            )

    review_blocks, review_stats = place_reviews(
        pool,
        pacing=request.pacing,
        topic_finished=topic_finished,
        horizon_end=request.end_date,
        zone_name=request.timezone,
    )
    blocks.extend(review_blocks)
    blocks.sort(key=lambda block: (block.start, block.title))

    required = request.pacing.total_minutes
    conflict = _build_conflict(
        request=request,
        pool=pool,
        blocks=blocks,
        unplaced=unplaced,
        required_minutes=required,
    )
    if conflict is not None and not conflict.feasible:
        # Две разные беды и два разных разговора с учеником: «программа не
        # влезает в отведённое время» и «влезает, но позже желаемого срока».
        warnings.add(WARN_CAPACITY_EXCEEDED if unplaced else WARN_DEADLINE_MISSED)

    stats = {
        "lesson_blocks": sum(1 for block in blocks if block.kind == "lesson"),
        "review_blocks": sum(1 for block in blocks if block.kind == "review"),
        "planned_minutes": sum(block.duration_minutes for block in blocks),
        "required_minutes": required,
        "slot_minutes": pool.total_minutes,
        "usable_minutes": pool.usable_minutes,
        **review_stats,
    }

    return ScheduleDraft(
        blocks=tuple(blocks),
        conflict=conflict,
        warnings=tuple(sorted(warnings)),
        stats=stats,
    )


def _build_conflict(
    *,
    request: ScheduleGenerationRequest,
    pool: SlotPool,
    blocks: list[PlannedBlock],
    unplaced: list[UnplacedPart],
    required_minutes: int,
) -> ConflictReport | None:
    """Отчёт о невыполнимости. `None` — всё поместилось и срок соблюдён."""
    last_end = max((block.end for block in blocks), default=None)
    overrun_days = 0
    if request.desired_finish_date and last_end is not None:
        overrun = last_end.date() - request.desired_finish_date
        overrun_days = max(0, overrun.days)

    if not unplaced and overrun_days == 0:
        return None

    suggestions: list[str] = []
    if unplaced:
        missing = sum(part.duration_minutes for part in unplaced)
        extra_weeks = max(1, -(-missing // max(1, pool.weekly_capacity())))
        suggestions.append(f"Продлить курс примерно на {extra_weeks} нед.")
    elif overrun_days:
        suggestions.append(
            f"Продлить срок на {overrun_days} дн. — при текущем ритме раньше не выходит."
        )

    empty = sorted(pool.free_weekdays())
    if empty:
        names = ", ".join(_WEEKDAY_NAMES[day] for day in empty[:2])
        suggestions.append(f"Добавить занятие в свободный день: {names}.")

    suggestions.append("Уменьшить глубину практики в настройках программы.")

    if any(part.reason == "no_slot_accepts_activity" for part in unplaced):
        suggestions.insert(
            0,
            "Разрешить в недельном шаблоне типы занятий, которых сейчас нет ни в одном окне.",
        )

    return ConflictReport(
        feasible=False,
        required_minutes=required_minutes,
        available_minutes=pool.usable_minutes,
        unplaced=tuple(unplaced),
        overrun_days=overrun_days,
        suggestions=tuple(suggestions),
    )
