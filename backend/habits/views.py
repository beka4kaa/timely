from datetime import date, timedelta

from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from .models import Habit, HabitLog
from .serializers import HabitSerializer, habit_payload, server_today


def _day_on_earth(raw) -> date | None:
    """Дата из браузера ученика, если сейчас где-нибудь на Земле действительно этот день.

    Сервер живёт в UTC, а день у ученика свой: в Алматы новые сутки начинаются на пять
    часов раньше. Часового пояса у привычек нет, поэтому день называет браузер, а сервер
    проверяет, что такой день сейчас возможен (пояса от UTC−12 до UTC+14). Вчерашнюю
    отметку задним числом так не поставить, разве что в пределах этих суток.
    """
    if not raw:
        return None
    try:
        day = parse_date(str(raw))
    except ValueError:
        return None
    if day is None:
        return None
    now = timezone.now()
    if (now - timedelta(hours=12)).date() <= day <= (now + timedelta(hours=14)).date():
        return day
    return None


class HabitViewSet(viewsets.ModelViewSet):
    serializer_class = HabitSerializer

    def get_queryset(self):
        user_email = getattr(self.request, 'user_email', None)
        if not user_email:
            return Habit.objects.none()
        return Habit.objects.filter(user_email=user_email).select_related('goal')

    def perform_create(self, serializer):
        user_email = getattr(self.request, 'user_email', None)
        serializer.save(user_email=user_email)

    def _viewed_day(self) -> date:
        """Какой день считать сегодняшним для показа. Странная дата не повод падать."""
        return _day_on_earth(self.request.query_params.get('today')) or server_today()

    def _marked_day(self) -> date:
        """Какой день отмечает запрос. Отметить можно только сегодня, поэтому чужая дата это ошибка."""
        raw = self.request.data.get('date')
        if raw in (None, ''):
            return server_today()
        day = _day_on_earth(raw)
        if day is None:
            raise ValidationError({'date': 'Отметить можно только сегодняшний день.'})
        return day

    def get_serializer_context(self):
        return {**super().get_serializer_context(), 'today': self._viewed_day()}

    def list(self, request, *args, **kwargs):
        today = self._viewed_day()
        return Response([habit_payload(h, today) for h in self.get_queryset().prefetch_related('logs')])

    @action(detail=True, methods=['post'])
    def toggle(self, request, pk=None):
        """Сегодняшняя отметка: `done` ставит или снимает её, без него она переключается."""
        habit = self.get_object()
        today = self._marked_day()
        wanted = request.data.get('done')
        if wanted is not None and not isinstance(wanted, bool):
            raise ValidationError({'done': 'Нужно true или false.'})

        log = HabitLog.objects.filter(habit=habit, date=today).first()
        if wanted is None:
            wanted = log is None
        if wanted and log is None:
            HabitLog.objects.get_or_create(habit=habit, date=today)
        elif not wanted and log is not None and not (log.note or log.minutes or log.photo):
            # Only delete when there's no attached detail; otherwise keep the record.
            log.delete()
        return Response(habit_payload(habit, today))

    @action(detail=True, methods=['post'])
    def log(self, request, pk=None):
        """Attach detail to today's entry (creates it = marks done)."""
        habit = self.get_object()
        today = self._marked_day()
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
        return Response(habit_payload(habit, today))

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
