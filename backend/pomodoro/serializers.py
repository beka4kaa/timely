from rest_framework import serializers
from .models import FocusSession


class FocusSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = FocusSession
        fields = [
            'id',
            'kind',
            'started_at',
            'seconds',
            'planned_seconds',
            'preset_focus_min',
            'preset_break_min',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']
