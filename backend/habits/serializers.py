from rest_framework import serializers
from .models import Habit, HabitLog


class HabitLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = HabitLog
        fields = ['id', 'date', 'note', 'minutes', 'photo']


class HabitSerializer(serializers.ModelSerializer):
    class Meta:
        model = Habit
        fields = ['id', 'name', 'emoji', 'color', 'goal_text', 'freeze_budget', 'created_at']
        read_only_fields = ['id', 'created_at']
