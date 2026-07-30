from datetime import date, datetime, timedelta
from datetime import timezone as dt_timezone

from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import FocusSession
from .serializers import FocusSessionSerializer

DEFAULT_WINDOW_DAYS = 365
MAX_WINDOW_DAYS = 400
STREAK_LOOKBACK_DAYS = 400


def _int_param(request, name: str, default: int, low: int, high: int) -> int:
    """Читает целочисленный query-параметр и зажимает его в допустимый диапазон."""
    raw = request.query_params.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, value))


def _local_day(moment: datetime, tz_offset_min: int) -> date:
    """
    Переводит момент в локальный день пользователя.

    `tz_offset_min` — это результат JS `Date.getTimezoneOffset()`: количество
    минут, которое надо прибавить к локальному времени, чтобы получить UTC.
    Для Алматы (UTC+5) он равен -300, поэтому локальное время = UTC - offset.
    """
    return (moment.astimezone(dt_timezone.utc) - timedelta(minutes=tz_offset_min)).date()


class FocusSessionViewSet(viewsets.ModelViewSet):
    """
    История помодоро-сессий текущего пользователя.

    Пользователь определяется заголовком `X-User-Email` (config.middleware),
    как и в остальных приложениях проекта.
    """

    serializer_class = FocusSessionSerializer

    def _user_email(self):
        return getattr(self.request, 'user_email', None)

    def get_queryset(self):
        user_email = self._user_email()
        if not user_email:
            return FocusSession.objects.none()

        queryset = FocusSession.objects.filter(user_email=user_email)
        days = _int_param(self.request, 'days', DEFAULT_WINDOW_DAYS, 1, MAX_WINDOW_DAYS)
        cutoff = timezone.now() - timedelta(days=days)
        return queryset.filter(started_at__gte=cutoff)

    def create(self, request, *args, **kwargs):
        if not self._user_email():
            return Response({'detail': 'Не указан пользователь.'}, status=status.HTTP_401_UNAUTHORIZED)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(user_email=self._user_email())

    @action(detail=False, methods=['get'])
    def summary(self, request):
        """
        Агрегаты для календаря активности: сколько секунд фокуса в каждом
        локальном дне, серия, лучший день и общий итог за окно.
        """
        user_email = self._user_email()
        if not user_email:
            return Response({'detail': 'Не указан пользователь.'}, status=status.HTTP_401_UNAUTHORIZED)

        tz_offset = _int_param(request, 'tz_offset', 0, -14 * 60, 14 * 60)
        days = _int_param(request, 'days', DEFAULT_WINDOW_DAYS, 1, MAX_WINDOW_DAYS)

        # Берём с запасом в сутки с каждой стороны: локальный день пользователя
        # может выходить за границы UTC-окна.
        cutoff = timezone.now() - timedelta(days=days + 1)
        rows = FocusSession.objects.filter(
            user_email=user_email,
            kind=FocusSession.FOCUS,
            started_at__gte=cutoff,
        ).values_list('started_at', 'seconds')

        daily: dict[str, int] = {}
        for started_at, seconds in rows:
            key = _local_day(started_at, tz_offset).isoformat()
            daily[key] = daily.get(key, 0) + seconds

        today = _local_day(timezone.now(), tz_offset)
        window_start = today - timedelta(days=days - 1)
        daily = {
            key: value
            for key, value in daily.items()
            if window_start.isoformat() <= key <= today.isoformat()
        }

        best_day = max(daily.items(), key=lambda item: item[1], default=None)

        return Response({
            'daily': daily,
            'streak': _compute_streak(daily, today),
            'active_days': len(daily),
            'total_seconds': sum(daily.values()),
            'best_day': (
                {'date': best_day[0], 'seconds': best_day[1]} if best_day else None
            ),
        })

    @action(detail=False, methods=['delete'], url_path='clear-day')
    def clear_day(self, request):
        """Удаляет сессии за один локальный день («Очистить день» в истории)."""
        user_email = self._user_email()
        if not user_email:
            return Response({'detail': 'Не указан пользователь.'}, status=status.HTTP_401_UNAUTHORIZED)

        tz_offset = _int_param(request, 'tz_offset', 0, -14 * 60, 14 * 60)
        raw_date = request.query_params.get('date')
        if raw_date:
            try:
                target = date.fromisoformat(raw_date)
            except ValueError:
                return Response({'detail': 'Некорректная дата.'}, status=status.HTTP_400_BAD_REQUEST)
        else:
            target = _local_day(timezone.now(), tz_offset)

        # Локальные сутки в UTC — это окно, сдвинутое на offset.
        start_utc = datetime.combine(
            target, datetime.min.time(), tzinfo=dt_timezone.utc
        ) + timedelta(minutes=tz_offset)
        deleted, _ = FocusSession.objects.filter(
            user_email=user_email,
            started_at__gte=start_utc,
            started_at__lt=start_utc + timedelta(days=1),
        ).delete()

        return Response({'deleted': deleted, 'date': target.isoformat()})


def _compute_streak(daily: dict[str, int], today: date) -> int:
    """
    Серия подряд идущих дней с занятиями. Сегодняшний день без занятий серию не
    обрывает — она просто считается со вчера.
    """
    if not daily:
        return 0

    cursor = today
    if cursor.isoformat() not in daily:
        cursor -= timedelta(days=1)

    streak = 0
    for _ in range(STREAK_LOOKBACK_DAYS):
        if daily.get(cursor.isoformat()):
            streak += 1
            cursor -= timedelta(days=1)
        else:
            break
    return streak
