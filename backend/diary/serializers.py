from rest_framework import serializers
from .models import WeeklyTemplate, DiaryWeek


class WeeklyTemplateSerializer(serializers.ModelSerializer):
    # Expose camelCase fields to match the TypeScript interface
    userId = serializers.EmailField(source='user_email')
    isActive = serializers.BooleanField(source='is_active')
    customPresets = serializers.JSONField(source='custom_presets', default=list)
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)
    updatedAt = serializers.DateTimeField(source='updated_at', read_only=True)

    class Meta:
        model = WeeklyTemplate
        fields = ['id', 'userId', 'name', 'slots', 'customPresets', 'isActive', 'createdAt', 'updatedAt']

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
