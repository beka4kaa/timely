from datetime import date, timedelta
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Habit, HabitLog
from .serializers import HabitSerializer


def _compute_streak(logs_dates: list[date]) -> int:
    if not logs_dates:
        return 0
    sorted_dates = sorted(set(logs_dates), reverse=True)
    today = date.today()
    streak = 0
    expected = today
    for d in sorted_dates:
        if d == expected:
            streak += 1
            expected -= timedelta(days=1)
        elif d == today - timedelta(days=1) and streak == 0:
            # streak can start from yesterday
            streak += 1
            expected = d - timedelta(days=1)
        else:
            break
    return streak


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
        habits = self.get_queryset()
        today = date.today()
        result = []
        for habit in habits:
            logs = list(habit.logs.values_list('date', flat=True))
            streak = _compute_streak(logs)
            done_today = today in logs
            # last 35 days for calendar
            calendar = []
            for i in range(34, -1, -1):
                d = today - timedelta(days=i)
                calendar.append({'date': d.isoformat(), 'done': d in logs})
            result.append({
                'id': habit.id,
                'name': habit.name,
                'emoji': habit.emoji,
                'color': habit.color,
                'created_at': habit.created_at.isoformat(),
                'streak': streak,
                'done_today': done_today,
                'total_done': len(logs),
                'calendar': calendar,
            })
        return Response(result)

    @action(detail=True, methods=['post'])
    def toggle(self, request, pk=None):
        habit = self.get_object()
        today = date.today()
        log, created = HabitLog.objects.get_or_create(habit=habit, date=today)
        if not created:
            log.delete()
            done = False
        else:
            done = True
        logs = list(habit.logs.values_list('date', flat=True))
        streak = _compute_streak(logs)
        return Response({'done_today': done, 'streak': streak, 'total_done': len(logs)})
