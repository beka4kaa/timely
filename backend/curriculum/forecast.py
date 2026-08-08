"""Расчёт периодичности занятий и прогноза даты завершения.

Даты считает backend, а не модель (§«LLM не является источником истины»). LLM
систематически ошибается в арифметике календаря — в високосных годах, при
переходе через месяц и при подсчёте «сколько вторников до 18 октября», — и
ошибка здесь стоит дорого: ученик планирует подготовку к экзамену.

Модуль намеренно чистый: ни Django, ни `date.today()` внутри логики. Стартовая
дата всегда передаётся аргументом, поэтому тест на високосный год и на границу
года воспроизводим.

Это ещё НЕ календарь с временными слотами (§PHASE 20): здесь только
периодичность и прогноз. Расстановка конкретных занятий по часам — задача
будущего schedule engine, для которого этот расчёт станет входом.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta

# Повторение съедает время сверх «чистых» минут темы. 15% — консервативная
# оценка на первые недели; позже её заменят фактические данные LearningEvent.
DEFAULT_REVIEW_OVERHEAD = 0.15
# Буфер на пропуски и болезни. Без него «реалистичная» дата систематически
# оптимистична, и ученик привыкает не верить прогнозу.
DEFAULT_BUFFER = 0.20

# Понедельник = 0 … воскресенье = 6 (как в `date.weekday()`).
DEFAULT_ALLOWED_WEEKDAYS = (0, 1, 2, 3, 4, 5, 6)

_MAX_HORIZON_DAYS = 366 * 5


@dataclass(frozen=True)
class ForecastInput:
    total_estimated_minutes: int
    sessions_per_week: int
    minutes_per_session: int
    start_date: date
    allowed_weekdays: tuple[int, ...] = DEFAULT_ALLOWED_WEEKDAYS
    desired_finish_date: date | None = None
    review_overhead: float = DEFAULT_REVIEW_OVERHEAD
    buffer_percentage: float = DEFAULT_BUFFER
    blackout_periods: tuple[tuple[date, date], ...] = ()


@dataclass
class ForecastResult:
    sessions_per_week: int
    minutes_per_session: int
    estimated_sessions: int
    effective_minutes: int
    estimated_finish_date: date | None
    optimistic_finish_date: date | None
    realistic_finish_date: date | None
    risk: str
    desired_deadline_feasible: bool | None
    required_sessions_per_week: int | None
    warnings: list[str] = field(default_factory=list)

    def to_payload(self) -> dict:
        """Сериализация для `CoursePlan.forecast` и для фронтенда."""

        def iso(value: date | None) -> str | None:
            return value.isoformat() if value else None

        return {
            "sessions_per_week": self.sessions_per_week,
            "minutes_per_session": self.minutes_per_session,
            "estimated_sessions": self.estimated_sessions,
            "effective_minutes": self.effective_minutes,
            "estimated_finish_date": iso(self.estimated_finish_date),
            "optimistic_finish_date": iso(self.optimistic_finish_date),
            "realistic_finish_date": iso(self.realistic_finish_date),
            "risk": self.risk,
            "desired_deadline_feasible": self.desired_deadline_feasible,
            "required_sessions_per_week": self.required_sessions_per_week,
            "warnings": list(self.warnings),
        }


class ForecastNotPossible(ValueError):
    """Расчёт невозможен: нет доступных дней или нулевая интенсивность."""


def _in_blackout(day: date, periods: tuple[tuple[date, date], ...]) -> bool:
    return any(start <= day <= end for start, end in periods)


def _nth_available_day(
    *,
    start: date,
    sessions_needed: int,
    allowed_weekdays: tuple[int, ...],
    sessions_per_week: int,
    blackout_periods: tuple[tuple[date, date], ...],
) -> date | None:
    """Дата, к которой наберётся `sessions_needed` занятий.

    Занятия распределяются по разрешённым дням недели, не более
    `sessions_per_week` в календарную неделю. Считаем перебором дней, а не
    формулой: формула ломается на blackout-периодах и на неделях, обрезанных
    стартовой датой, и именно там прогноз обязан быть точным.
    """
    if sessions_needed <= 0:
        return start
    allowed = set(allowed_weekdays)
    if not allowed or sessions_per_week <= 0:
        return None

    done = 0
    day = start
    # Ключ недели — понедельник этой недели, чтобы лимит считался календарно.
    week_key = day - timedelta(days=day.weekday())
    used_this_week = 0

    for _ in range(_MAX_HORIZON_DAYS):
        current_week = day - timedelta(days=day.weekday())
        if current_week != week_key:
            week_key = current_week
            used_this_week = 0

        if (
            day.weekday() in allowed
            and used_this_week < sessions_per_week
            and not _in_blackout(day, blackout_periods)
        ):
            done += 1
            used_this_week += 1
            if done >= sessions_needed:
                return day

        day += timedelta(days=1)

    return None


def compute_forecast(data: ForecastInput) -> ForecastResult:
    """Основной расчёт. Детерминирован для одинакового входа."""
    warnings: list[str] = []

    if data.total_estimated_minutes <= 0:
        raise ForecastNotPossible("Суммарная длительность курса должна быть больше нуля.")
    if data.minutes_per_session <= 0:
        raise ForecastNotPossible("Длительность занятия должна быть больше нуля.")
    if data.sessions_per_week <= 0:
        raise ForecastNotPossible("Число занятий в неделю должно быть больше нуля.")
    if not data.allowed_weekdays:
        raise ForecastNotPossible("Не выбрано ни одного дня для занятий.")

    # Нельзя проводить больше занятий, чем есть разрешённых дней в неделе.
    effective_per_week = min(data.sessions_per_week, len(set(data.allowed_weekdays)))
    if effective_per_week < data.sessions_per_week:
        warnings.append("sessions_per_week_capped_by_available_days")

    # Чистое время + повторения. Буфер применяется не к минутам, а к дате:
    # он отражает пропуски занятий, а не удлинение самого материала.
    effective_minutes = int(
        round(data.total_estimated_minutes * (1 + max(0.0, data.review_overhead)))
    )
    estimated_sessions = max(
        1, -(-effective_minutes // data.minutes_per_session)  # ceil
    )

    optimistic = _nth_available_day(
        start=data.start_date,
        sessions_needed=estimated_sessions,
        allowed_weekdays=data.allowed_weekdays,
        sessions_per_week=effective_per_week,
        blackout_periods=data.blackout_periods,
    )

    buffered_sessions = max(
        estimated_sessions,
        int(round(estimated_sessions * (1 + max(0.0, data.buffer_percentage)))),
    )
    realistic = _nth_available_day(
        start=data.start_date,
        sessions_needed=buffered_sessions,
        allowed_weekdays=data.allowed_weekdays,
        sessions_per_week=effective_per_week,
        blackout_periods=data.blackout_periods,
    )

    if optimistic is None or realistic is None:
        warnings.append("horizon_exceeded")

    # Ученику показываем реалистичную дату: оптимистичная почти всегда
    # недостижима, и обещать её — значит подрывать доверие к прогнозу.
    estimated = realistic or optimistic

    feasible: bool | None = None
    required_per_week: int | None = None
    if data.desired_finish_date is not None:
        feasible = bool(estimated and estimated <= data.desired_finish_date)
        required_per_week = _required_sessions_per_week(
            data=data,
            sessions_needed=buffered_sessions,
            deadline=data.desired_finish_date,
        )
        if required_per_week is None:
            warnings.append("deadline_unreachable_at_any_pace")

    return ForecastResult(
        sessions_per_week=effective_per_week,
        minutes_per_session=data.minutes_per_session,
        estimated_sessions=estimated_sessions,
        effective_minutes=effective_minutes,
        estimated_finish_date=estimated,
        optimistic_finish_date=optimistic,
        realistic_finish_date=realistic,
        risk=_risk_level(
            estimated=estimated,
            desired=data.desired_finish_date,
            sessions=estimated_sessions,
        ),
        desired_deadline_feasible=feasible,
        required_sessions_per_week=required_per_week,
        warnings=warnings,
    )


def _required_sessions_per_week(
    *, data: ForecastInput, sessions_needed: int, deadline: date
) -> int | None:
    """Минимальный темп, при котором дедлайн ещё достижим.

    Перебираем от текущего темпа вверх до числа доступных дней в неделе. Больше
    занятий, чем есть разрешённых дней, назначить нельзя — в этом случае
    дедлайн недостижим при любом темпе, и честнее сказать это прямо.
    """
    max_per_week = len(set(data.allowed_weekdays))
    for pace in range(1, max_per_week + 1):
        finish = _nth_available_day(
            start=data.start_date,
            sessions_needed=sessions_needed,
            allowed_weekdays=data.allowed_weekdays,
            sessions_per_week=pace,
            blackout_periods=data.blackout_periods,
        )
        if finish and finish <= deadline:
            return pace
    return None


def _risk_level(*, estimated: date | None, desired: date | None, sessions: int) -> str:
    """Насколько план рискованный.

    Без дедлайна риск определяется длиной курса: чем дольше, тем выше шанс, что
    ученик сойдёт с дистанции.
    """
    if estimated is None:
        return "high"
    if desired is not None:
        slack = (desired - estimated).days
        if slack < 0:
            return "high"
        if slack < 7:
            return "medium"
        return "low"
    if sessions > 60:
        return "high"
    if sessions > 25:
        return "medium"
    return "low"


def suggest_intensity(
    *,
    total_estimated_minutes: int,
    desired_finish_date: date | None,
    start_date: date,
    minutes_per_session: int = 40,
    allowed_weekdays: tuple[int, ...] = DEFAULT_ALLOWED_WEEKDAYS,
) -> tuple[int, int]:
    """Подбирает (занятий в неделю, минут за занятие) под желаемую дату.

    Возвращает минимальный темп, укладывающийся в дедлайн, — чтобы предложение
    по умолчанию не было изматывающим. Без дедлайна отдаёт спокойные 3 занятия.
    """
    if desired_finish_date is None:
        return 3, minutes_per_session

    for pace in range(1, len(set(allowed_weekdays)) + 1):
        result = compute_forecast(
            ForecastInput(
                total_estimated_minutes=total_estimated_minutes,
                sessions_per_week=pace,
                minutes_per_session=minutes_per_session,
                start_date=start_date,
                allowed_weekdays=allowed_weekdays,
                desired_finish_date=desired_finish_date,
            )
        )
        if result.desired_deadline_feasible:
            return pace, minutes_per_session
    return len(set(allowed_weekdays)), minutes_per_session
