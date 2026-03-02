from rest_framework import serializers
from .models import WeeklyTemplate, TemplateLesson, DiaryWeek


class TemplateLessonSerializer(serializers.ModelSerializer):
    """
    Serializes a TemplateLesson row into the TemplateLessonSlot shape expected
    by the TypeScript frontend (camelCase keys).
    """
    dayOfWeek    = serializers.CharField(source='day_of_week')
    lessonNumber = serializers.IntegerField(source='lesson_number')
    startTime    = serializers.CharField(source='start_time')
    endTime      = serializers.CharField(source='end_time')
    subjectId    = serializers.CharField(source='subject_id')
    blockType    = serializers.CharField(source='block_type')

    class Meta:
        model = TemplateLesson
        fields = [
            'id', 'dayOfWeek', 'lessonNumber',
            'startTime', 'endTime',
            'subjectId', 'blockType', 'label',
        ]


class WeeklyTemplateSerializer(serializers.ModelSerializer):
    """
    Exposes camelCase fields to match the TypeScript WeeklyTemplate interface.

    `slots` is kept for backward-compatible reads.
    `lessons` is the normalized list from TemplateLesson rows; guarded with a
    try/except so that if the migration hasn't run yet it falls back gracefully.
    """
    userId        = serializers.EmailField(source='user_email')
    isActive      = serializers.BooleanField(source='is_active')
    customPresets = serializers.JSONField(source='custom_presets', default=list)
    createdAt     = serializers.DateTimeField(source='created_at', read_only=True)
    updatedAt     = serializers.DateTimeField(source='updated_at', read_only=True)

    class Meta:
        model = WeeklyTemplate
        fields = [
            'id', 'userId', 'name',
            'slots',        # JSON snapshot — source of truth until migration runs
            'customPresets', 'isActive',
            'createdAt', 'updatedAt',
        ]

    def create(self, validated_data):
        return WeeklyTemplate.objects.create(**validated_data)

    def update(self, instance, validated_data):
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        return instance


class DiaryWeekSerializer(serializers.ModelSerializer):
    userId = serializers.EmailField(source='user_email')
    weekStart = serializers.CharField(source='week_start')
    weekEnd = serializers.CharField(source='week_end')
    templateId = serializers.CharField(source='template_id', allow_null=True, required=False)
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)

    class Meta:
        model = DiaryWeek
        fields = ['id', 'userId', 'weekStart', 'weekEnd', 'templateId', 'days', 'createdAt']

    def create(self, validated_data):
        return DiaryWeek.objects.create(**validated_data)

    def update(self, instance, validated_data):
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        return instance
