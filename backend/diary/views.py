from rest_framework import viewsets, status
from rest_framework.response import Response
from django.db import IntegrityError
from .models import WeeklyTemplate, DiaryWeek
from .serializers import WeeklyTemplateSerializer, DiaryWeekSerializer


class WeeklyTemplateViewSet(viewsets.ModelViewSet):
    queryset = WeeklyTemplate.objects.all()
    serializer_class = WeeklyTemplateSerializer

    def get_queryset(self):
        user_email = getattr(self.request, 'user_email', None)
        if not user_email:
            return WeeklyTemplate.objects.none()
        qs = WeeklyTemplate.objects.filter(user_email=user_email).order_by('-created_at')
        is_active = self.request.query_params.get('is_active')
        if is_active == 'true':
            qs = qs.filter(is_active=True)
        return qs

    def perform_create(self, serializer):
        user_email = getattr(self.request, 'user_email', None)
        is_active = self.request.data.get('isActive', False)
        # Deactivate all other templates for this user if setting active
        if is_active:
            WeeklyTemplate.objects.filter(user_email=user_email).update(is_active=False)
        serializer.save(user_email=user_email)

    def perform_update(self, serializer):
        # If activating this template, deactivate others
        is_active = self.request.data.get('isActive')
        if is_active is True or is_active == 'true':
            user_email = serializer.instance.user_email
            WeeklyTemplate.objects.filter(user_email=user_email).exclude(
                pk=serializer.instance.pk
            ).update(is_active=False)
        serializer.save()

    def create(self, request, *args, **kwargs):
        """Support client-provided id (UUID from JS)."""
        user_email = getattr(request, 'user_email', None)
        is_active = request.data.get('isActive', False)
        if is_active:
            WeeklyTemplate.objects.filter(user_email=user_email).update(is_active=False)

        template_id = request.data.get('id')
        if not template_id:
            return Response({'error': 'id is required'}, status=status.HTTP_400_BAD_REQUEST)

        template = WeeklyTemplate.objects.create(
            id=template_id,
            user_email=user_email,
            name=request.data.get('name', 'Моё расписание'),
            slots=request.data.get('slots', []),
            custom_presets=request.data.get('customPresets', []),
            is_active=is_active,
        )
        return Response(WeeklyTemplateSerializer(template).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        is_active = request.data.get('isActive')
        if is_active is True:
            WeeklyTemplate.objects.filter(user_email=instance.user_email).exclude(
                pk=instance.pk
            ).update(is_active=False)
        if 'name' in request.data:
            instance.name = request.data['name']
        if 'slots' in request.data:
            instance.slots = request.data['slots']
        if 'customPresets' in request.data:
            instance.custom_presets = request.data['customPresets']
        if is_active is not None:
            instance.is_active = is_active
        instance.save()
        return Response(WeeklyTemplateSerializer(instance).data)


class DiaryWeekViewSet(viewsets.ModelViewSet):
    queryset = DiaryWeek.objects.all()
    serializer_class = DiaryWeekSerializer

    def get_queryset(self):
        user_email = getattr(self.request, 'user_email', None)
        if not user_email:
            return DiaryWeek.objects.none()

        qs = DiaryWeek.objects.filter(user_email=user_email)

        week_start = self.request.query_params.get('week_start')
        if week_start:
            qs = qs.filter(week_start=week_start)

        year = self.request.query_params.get('year')
        if year:
            # Keep weeks that overlap the requested year
            qs = qs.filter(
                week_start__startswith=year
            ) | DiaryWeek.objects.filter(user_email=user_email, week_end__startswith=year)

        return qs.order_by('-week_start')

    def create(self, request, *args, **kwargs):
        """Upsert: if week for this user+week_start already exists, update it."""
        user_email = getattr(request, 'user_email', None)
        week_start = request.data.get('weekStart')
        week_id = request.data.get('id')

        if not week_start or not week_id:
            return Response({'error': 'id and weekStart are required'}, status=status.HTTP_400_BAD_REQUEST)

        existing = DiaryWeek.objects.filter(user_email=user_email, week_start=week_start).first()
        if existing:
            # Update existing
            existing.days = request.data.get('days', existing.days)
            existing.week_end = request.data.get('weekEnd', existing.week_end)
            existing.template_id = request.data.get('templateId', existing.template_id)
            existing.save()
            return Response(DiaryWeekSerializer(existing).data)

        try:
            week = DiaryWeek.objects.create(
                id=week_id,
                user_email=user_email,
                week_start=week_start,
                week_end=request.data.get('weekEnd', ''),
                template_id=request.data.get('templateId'),
                days=request.data.get('days', []),
            )
            return Response(DiaryWeekSerializer(week).data, status=status.HTTP_201_CREATED)
        except IntegrityError:
            # Race condition: another request created it, just update
            existing = DiaryWeek.objects.get(user_email=user_email, week_start=week_start)
            existing.days = request.data.get('days', existing.days)
            existing.save()
            return Response(DiaryWeekSerializer(existing).data)

    def update(self, request, *args, **kwargs):
        """Full replace of a week's data."""
        instance = self.get_object()
        user_email = getattr(request, 'user_email', None)
        if instance.user_email != user_email:
            return Response({'error': 'Forbidden'}, status=status.HTTP_403_FORBIDDEN)

        instance.days = request.data.get('days', instance.days)
        instance.week_end = request.data.get('weekEnd', instance.week_end)
        instance.template_id = request.data.get('templateId', instance.template_id)
        instance.save()
        return Response(DiaryWeekSerializer(instance).data)
