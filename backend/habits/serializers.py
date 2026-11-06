from bisect import bisect_left
from collections.abc import Callable
from datetime import date, timedelta

from django.utils import timezone
from rest_framework import serializers

from config.ownership import OwnedRelationsMixin

from .models import Habit, HabitLog

CALENDAR_DAYS = 154  # 22 недели: столько квадратиков на карточке привычки
MIN_INTERVAL_DAYS = 2  # раз в один день это просто каждый день
MAX_INTERVAL_DAYS = 30


def server_today() -> date:
    return timezone.now().date()


def clean_schedule(frequency, weekdays, interval_days) -> dict:
    """Проверенная частота в одном виде. Кривое значение: `ValueError` с текстом для ученика."""
    if frequency == Habit.WEEKDAYS:
        if not isinstance(weekdays, list) or any(type(day) is not int or not 0 <= day <= 6 for day in weekdays):
            raise ValueError('Дни недели это числа от 0 до 6.')
        days = sorted(set(weekdays))
        if not days:
            raise ValueError('Выбери хотя бы один день недели.')
        # Все семь дней и есть каждый день.
        if len(days) < 7:
            return {'frequency': Habit.WEEKDAYS, 'weekdays': days, 'interval_days': MIN_INTERVAL_DAYS}
    elif frequency == Habit.INTERVAL:
        if type(interval_days) is not int or not MIN_INTERVAL_DAYS <= interval_days <= MAX_INTERVAL_DAYS:
            raise ValueError(f'Раз в сколько дней: от {MIN_INTERVAL_DAYS} до {MAX_INTERVAL_DAYS}.')
        return {'frequency': Habit.INTERVAL, 'weekdays': [], 'interval_days': interval_days}
    elif frequency != Habit.DAILY:
        raise ValueError('Такой частоты нет.')
    return {'frequency': Habit.DAILY, 'weekdays': [], 'interval_days': MIN_INTERVAL_DAYS}


def due_rule(habit: Habit, logs: set) -> Callable[[date], bool]:
    """Стоит ли день по расписанию. Ответ зависит только от отметок раньше этого дня."""
    if habit.frequency == Habit.WEEKDAYS:
        days = set(habit.weekdays)
        return lambda day: day.weekday() in days
    if habit.frequency == Habit.INTERVAL:
        done = sorted(logs)

        def due(day: date) -> bool:
            index = bisect_left(done, day)
            return index == 0 or (day - done[index - 1]).days >= habit.interval_days

        return due
    return lambda day: True


def _next_due(logs: set, today: date, due: Callable[[date], bool]) -> date | None:
    """Ближайший день, когда привычку пора сделать: сегодня, если она ещё ждёт."""
    if today not in logs and due(today):
        return today
    for offset in range(1, MAX_INTERVAL_DAYS + 1):
        day = today + timedelta(days=offset)
        if due(day):
            return day
    return None


def _compute_streak(logs: set, freeze_budget: int, today: date, due: Callable[[date], bool]) -> tuple[int, int]:
    """
    Forgiving streak: walking back from today (or the last scheduled day), missing
    scheduled days are bridged by 'shields' from freeze_budget, and days off the
    schedule neither count nor break anything. Only real completions count toward
    the streak number; shields just keep the chain alive.

    Returns (streak, shields_used).
    """
    if not logs:
        return 0, 0
    oldest = min(logs)
    cursor = today
    if cursor not in logs:
        cursor -= timedelta(days=1)
        while cursor > oldest and cursor not in logs and not due(cursor):
            cursor -= timedelta(days=1)
        if cursor not in logs:
            return 0, 0

    streak = 0
    used = 0
    while cursor >= oldest:
        if cursor in logs:
            streak += 1
        elif due(cursor):
            if used >= freeze_budget:
                break
            used += 1  # shield consumed to bridge the gap
        cursor -= timedelta(days=1)
    return streak, used


def habit_payload(habit: Habit, today: date) -> dict:
    log_rows = list(habit.logs.all())
    logs = {r.date for r in log_rows}
    by_date = {r.date: r for r in log_rows}
    due = due_rule(habit, logs)
    streak, shields_used = _compute_streak(logs, habit.freeze_budget, today, due)
    next_due = _next_due(logs, today, due)
    today_row = by_date.get(today)
    # Удалённая цель лежит в архиве: на карточке её больше нет, хотя связь цела.
    goal = habit.goal if habit.goal_id and habit.goal.status != 'archived' else None

    calendar = []
    for i in range(CALENDAR_DAYS - 1, -1, -1):
        d = today - timedelta(days=i)
        row = {
            'date': d.isoformat(),
            'done': d in logs,
            'minutes': by_date[d].minutes if d in by_date else 0,
        }
        # Только у дней отдыха: у ежедневной привычки ответ остаётся прежним.
        if not due(d):
            row['off'] = True
        calendar.append(row)

    return {
        'id': habit.id,
        'name': habit.name,
        'emoji': habit.emoji,
        'color': habit.color,
        'goal': goal.pk if goal else None,
        'goal_title': goal.title if goal else '',
        'goal_text': habit.goal_text,
        'freeze_budget': habit.freeze_budget,
        'frequency': habit.frequency,
        'weekdays': habit.weekdays,
        'interval_days': habit.interval_days,
        'due_today': due(today),
        'next_due': next_due.isoformat() if next_due else None,
        'created_at': habit.created_at.isoformat(),
        'today': today.isoformat(),
        'streak': streak,
        'shields_used': shields_used,
        'shields_left': max(0, habit.freeze_budget - shields_used),
        'done_today': today in logs,
        'total_done': len(logs),
        'total_minutes': sum(r.minutes for r in log_rows),
        'note_today': today_row.note if today_row else '',
        'minutes_today': today_row.minutes if today_row else 0,
        'has_photo_today': bool(today_row and today_row.photo),
        'calendar': calendar,
    }


class HabitLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = HabitLog
        fields = ['id', 'date', 'note', 'minutes', 'photo']


class HabitSerializer(OwnedRelationsMixin, serializers.ModelSerializer):
    owned_relations = {'goal': 'user_email'}

    class Meta:
        model = Habit
        fields = [
            'id', 'name', 'emoji', 'color', 'goal', 'goal_text', 'freeze_budget',
            'frequency', 'weekdays', 'interval_days', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if attrs.keys() & {'frequency', 'weekdays', 'interval_days'}:
            # В PATCH могло прийти одно поле: остальные берём у самой привычки.
            current = self.instance
            try:
                attrs.update(clean_schedule(
                    attrs.get('frequency', current.frequency if current else Habit.DAILY),
                    attrs.get('weekdays', current.weekdays if current else []),
                    attrs.get('interval_days', current.interval_days if current else MIN_INTERVAL_DAYS),
                ))
            except ValueError as error:
                raise serializers.ValidationError({'frequency': str(error)}) from error
        return attrs

    def to_representation(self, instance):
        # Любой ответ одной формы: новая карточка сразу с настоящим календарём.
        return habit_payload(instance, self.context.get('today') or server_today())
