from datetime import date, timedelta

from django.utils import timezone
from rest_framework import serializers

from config.ownership import OwnedRelationsMixin

from .models import Habit, HabitLog

CALENDAR_DAYS = 154  # 22 недели: столько квадратиков на карточке привычки


def server_today() -> date:
    return timezone.now().date()


def _compute_streak(logs: set, freeze_budget: int, today: date) -> tuple[int, int]:
    """
    Forgiving streak: walking back from today (or yesterday), missing days are
    bridged by 'shields' from freeze_budget. Only real completions count toward
    the streak number; shields just keep the chain alive.

    Returns (streak, shields_used).
    """
    if not logs:
        return 0, 0
    if today in logs:
        cursor = today
    elif (today - timedelta(days=1)) in logs:
        cursor = today - timedelta(days=1)
    else:
        return 0, 0

    oldest = min(logs)
    streak = 0
    used = 0
    while cursor >= oldest:
        if cursor in logs:
            streak += 1
        elif used < freeze_budget and any(d < cursor for d in logs):
            used += 1  # shield consumed to bridge the gap
        else:
            break
        cursor -= timedelta(days=1)
    return streak, used


def habit_payload(habit: Habit, today: date) -> dict:
    log_rows = list(habit.logs.all())
    logs = {r.date for r in log_rows}
    by_date = {r.date: r for r in log_rows}
    streak, shields_used = _compute_streak(logs, habit.freeze_budget, today)
    today_row = by_date.get(today)
    # Удалённая цель лежит в архиве: на карточке её больше нет, хотя связь цела.
    goal = habit.goal if habit.goal_id and habit.goal.status != 'archived' else None

    calendar = []
    for i in range(CALENDAR_DAYS - 1, -1, -1):
        d = today - timedelta(days=i)
        calendar.append({
            'date': d.isoformat(),
            'done': d in logs,
            'minutes': by_date[d].minutes if d in by_date else 0,
        })

    return {
        'id': habit.id,
        'name': habit.name,
        'emoji': habit.emoji,
        'color': habit.color,
        'goal': goal.pk if goal else None,
        'goal_title': goal.title if goal else '',
        'goal_text': habit.goal_text,
        'freeze_budget': habit.freeze_budget,
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
        fields = ['id', 'name', 'emoji', 'color', 'goal', 'goal_text', 'freeze_budget', 'created_at']
        read_only_fields = ['id', 'created_at']

    def to_representation(self, instance):
        # Любой ответ одной формы: новая карточка сразу с настоящим календарём.
        return habit_payload(instance, self.context.get('today') or server_today())
