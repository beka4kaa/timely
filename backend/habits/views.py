from datetime import date, timedelta
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Habit, HabitLog
from .serializers import HabitSerializer

CALENDAR_DAYS = 119  # 17 weeks — GitHub-style heatmap window


def _compute_streak(logs: set, freeze_budget: int) -> tuple[int, int]:
    """
    Forgiving streak: walking back from today (or yesterday), missing days are
    bridged by 'shields' from freeze_budget. Only real completions count toward
    the streak number; shields just keep the chain alive.

    Returns (streak, shields_used).
    """
    if not logs:
        return 0, 0
    today = date.today()
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


def _serialize(habit: Habit) -> dict:
    today = date.today()
    log_rows = list(habit.logs.all())
    logs = {r.date for r in log_rows}
    by_date = {r.date: r for r in log_rows}
    streak, shields_used = _compute_streak(logs, habit.freeze_budget)
    today_row = by_date.get(today)

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
        'goal_text': habit.goal_text,
        'freeze_budget': habit.freeze_budget,
        'created_at': habit.created_at.isoformat(),
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


class HabitViewSet(viewsets.ModelViewSet):
    serializer_class = HabitSerializer

    def get_queryset(self):
        user_email = getattr(self.request, 'user_email', None)
        if not user_email:
            return Habit.objects.none()
        return Habit.objects.filter(user_email=user_email)

    def perform_create(self, serializer):
        user_email = getattr(self.request, 'user_email', None)
        serializer.save(user_email=user_email)

    def list(self, request, *args, **kwargs):
        return Response([_serialize(h) for h in self.get_queryset().prefetch_related('logs')])

    @action(detail=True, methods=['post'])
    def toggle(self, request, pk=None):
        habit = self.get_object()
        today = date.today()
        log, created = HabitLog.objects.get_or_create(habit=habit, date=today)
        if not created and not (log.note or log.minutes or log.photo):
            # Only delete when there's no attached detail; otherwise keep the record.
            log.delete()
        elif not created:
            # Has detail — toggling "off" would lose it; keep done.
            pass
        return Response(_serialize(habit))

    @action(detail=True, methods=['post'])
    def log(self, request, pk=None):
        """Attach detail to today's entry (creates it = marks done)."""
        habit = self.get_object()
        today = date.today()
        row, _ = HabitLog.objects.get_or_create(habit=habit, date=today)

        if 'note' in request.data:
            row.note = (request.data.get('note') or '')[:5000]
        if request.data.get('add_minutes'):
            row.minutes = (row.minutes or 0) + max(0, int(request.data['add_minutes']))
        if 'minutes' in request.data and request.data.get('minutes') is not None:
            row.minutes = max(0, int(request.data['minutes']))
        if 'photo' in request.data:
            row.photo = request.data.get('photo') or ''
        row.save()
        return Response(_serialize(habit))

    @action(detail=False, methods=['get'])
    def gallery(self, request):
        """All photo entries across habits, newest first."""
        rows = (
            HabitLog.objects
            .filter(habit__in=self.get_queryset(), photo__gt='')
            .select_related('habit')
            .order_by('-date')
        )
        return Response([{
            'id': r.id,
            'habit_id': r.habit_id,
            'habit_name': r.habit.name,
            'emoji': r.habit.emoji,
            'color': r.habit.color,
            'date': r.date.isoformat(),
            'photo': r.photo,
            'note': r.note,
            'minutes': r.minutes,
        } for r in rows])
