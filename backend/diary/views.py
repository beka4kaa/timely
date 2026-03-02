import uuid
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db import IntegrityError, transaction
from .models import WeeklyTemplate, TemplateLesson, DiaryWeek
from .serializers import WeeklyTemplateSerializer, DiaryWeekSerializer


# ── helpers ──────────────────────────────────────────────────

def _sync_template_lessons(template: WeeklyTemplate, slots: list) -> None:
    """
    Replace all TemplateLesson rows for *template* with the supplied slot list.
    Also writes the slots back to the JSON field so both storages stay in sync.

    Wrapped in try/except: if the migration hasn't run yet and the
    diary_templatelesson table doesn't exist, we silently fall back to
    JSON-only storage so the endpoint keeps working.
    """
    try:
        TemplateLesson.objects.filter(template=template).delete()
        rows = []
        for slot in slots:
            rows.append(TemplateLesson(
                id            = slot.get('id') or str(uuid.uuid4()),
                template      = template,
                day_of_week   = slot.get('dayOfWeek', ''),
                lesson_number = slot.get('lessonNumber', 1),
                start_time    = slot.get('startTime', ''),
                end_time      = slot.get('endTime', ''),
                subject_id    = slot.get('subjectId', ''),
                block_type    = slot.get('blockType', 'lesson'),
                label         = slot.get('label', ''),
            ))
        TemplateLesson.objects.bulk_create(rows)
        # Keep JSON snapshot in sync
        template.slots = [r.to_slot_dict() for r in rows]
        template.save(update_fields=['slots', 'updated_at'])
    except Exception:
        # Table may not exist yet (migration pending) — just update JSON field
        template.slots = slots
        template.save(update_fields=['slots', 'updated_at'])


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
        if is_active:
            WeeklyTemplate.objects.filter(user_email=user_email).update(is_active=False)
        serializer.save(user_email=user_email)

    def perform_update(self, serializer):
        is_active = self.request.data.get('isActive')
        if is_active is True or is_active == 'true':
            user_email = serializer.instance.user_email
            WeeklyTemplate.objects.filter(user_email=user_email).exclude(
                pk=serializer.instance.pk
            ).update(is_active=False)
        serializer.save()

    def create(self, request, *args, **kwargs):
        """
        Support client-provided id (UUID from JS).
        Persists slots in both the JSON field *and* normalised TemplateLesson rows.
        """
        user_email = getattr(request, 'user_email', None)
        is_active = request.data.get('isActive', False)
        if is_active:
            WeeklyTemplate.objects.filter(user_email=user_email).update(is_active=False)

        template_id = request.data.get('id')
        if not template_id:
            return Response({'error': 'id is required'}, status=status.HTTP_400_BAD_REQUEST)

        slots = request.data.get('slots', [])
        with transaction.atomic():
            template = WeeklyTemplate.objects.create(
                id            = template_id,
                user_email    = user_email,
                name          = request.data.get('name', 'Моё расписание'),
                slots         = slots,
                custom_presets= request.data.get('customPresets', []),
                is_active     = is_active,
            )
            _sync_template_lessons(template, slots)

        return Response(WeeklyTemplateSerializer(template).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        is_active = request.data.get('isActive')
        if is_active is True:
            WeeklyTemplate.objects.filter(user_email=instance.user_email).exclude(
                pk=instance.pk
            ).update(is_active=False)

        with transaction.atomic():
            if 'name' in request.data:
                instance.name = request.data['name']
            if 'slots' in request.data:
                _sync_template_lessons(instance, request.data['slots'])
                # slots JSON already updated inside helper; reload
                instance.refresh_from_db(fields=['slots'])
            if 'customPresets' in request.data:
                instance.custom_presets = request.data['customPresets']
            if is_active is not None:
                instance.is_active = is_active
            instance.save()

        return Response(WeeklyTemplateSerializer(instance).data)

    # ── Custom actions ────────────────────────────────────────

    @action(detail=False, methods=['post'], url_path='create_empty')
    def create_empty(self, request):
        """
        POST /api/diary/templates/create_empty/
        Body: { "name": "My New Template" }

        Creates a brand-new empty template (no lessons).
        Does NOT deactivate the current active template.
        """
        user_email = getattr(request, 'user_email', None)
        name = request.data.get('name', 'Новый шаблон')
        template_id = str(uuid.uuid4())

        template = WeeklyTemplate.objects.create(
            id         = template_id,
            user_email = user_email,
            name       = name,
            slots      = [],
            is_active  = False,
        )
        return Response(WeeklyTemplateSerializer(template).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='duplicate')
    def duplicate(self, request, pk=None):
        """
        POST /api/diary/templates/{id}/duplicate/
        Body: { "name": "Optional override name" }   (optional)

        Clones an existing template:
        1. Creates a new WeeklyTemplate with name "<original> (Copy)".
        2. Copies every TemplateLesson row to the new template with fresh IDs.
        3. Returns the new template object.
        """
        user_email = getattr(request, 'user_email', None)
        original = self.get_object()

        # Guard: only the owner may duplicate
        if original.user_email != user_email:
            return Response({'error': 'Forbidden'}, status=status.HTTP_403_FORBIDDEN)

        new_name = request.data.get('name') or f"{original.name} (Copy)"
        new_id   = str(uuid.uuid4())

        with transaction.atomic():
            # 1. Clone the template header
            new_template = WeeklyTemplate.objects.create(
                id             = new_id,
                user_email     = user_email,
                name           = new_name,
                slots          = [],       # will be rebuilt below
                custom_presets = list(original.custom_presets),
                is_active      = False,    # copy is never active by default
            )

            # 2. Copy TemplateLesson rows (or fall back to JSON slots)
            try:
                source_lessons = list(
                    TemplateLesson.objects.filter(template=original)
                )
                if source_lessons:
                    new_rows = [
                        TemplateLesson(
                            id            = str(uuid.uuid4()),
                            template      = new_template,
                            day_of_week   = l.day_of_week,
                            lesson_number = l.lesson_number,
                            start_time    = l.start_time,
                            end_time      = l.end_time,
                            subject_id    = l.subject_id,
                            block_type    = l.block_type,
                            label         = l.label,
                        )
                        for l in source_lessons
                    ]
                else:
                    # Fallback: copy from JSON slots field (legacy / migration pending)
                    new_rows = [
                        TemplateLesson(
                            id            = str(uuid.uuid4()),
                            template      = new_template,
                            day_of_week   = s.get('dayOfWeek', ''),
                            lesson_number = s.get('lessonNumber', 1),
                            start_time    = s.get('startTime', ''),
                            end_time      = s.get('endTime', ''),
                            subject_id    = s.get('subjectId', ''),
                            block_type    = s.get('blockType', 'lesson'),
                            label         = s.get('label', ''),
                        )
                        for s in original.slots
                    ]
                TemplateLesson.objects.bulk_create(new_rows)
                new_template.slots = [r.to_slot_dict() for r in new_rows]
            except Exception:
                # TemplateLesson table not yet migrated — copy JSON slots directly
                new_template.slots = [
                    {**s, 'id': str(uuid.uuid4())} for s in original.slots
                ]
            new_template.save(update_fields=['slots', 'updated_at'])

        return Response(
            WeeklyTemplateSerializer(new_template).data,
            status=status.HTTP_201_CREATED,
        )


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
