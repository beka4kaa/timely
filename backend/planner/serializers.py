from rest_framework import serializers
from .models import DayPlan, Block, Segment, Subtask, TimerState, ScheduleSlot

class SubtaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = Subtask
        fields = '__all__'

class SegmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Segment
        fields = '__all__'

class TimerStateSerializer(serializers.ModelSerializer):
    class Meta:
        model = TimerState
        fields = '__all__'

class BlockSerializer(serializers.ModelSerializer):
    segments = SegmentSerializer(many=True, read_only=True)
    subtasks = SubtaskSerializer(many=True, read_only=True)
    timer_state = TimerStateSerializer(read_only=True)

    class Meta:
        model = Block
        fields = '__all__'

class DayPlanSerializer(serializers.ModelSerializer):
    blocks = BlockSerializer(many=True, read_only=True)

    class Meta:
        model = DayPlan
        fields = '__all__'

class ScheduleSlotSerializer(serializers.ModelSerializer):
    # Map snake_case to camelCase for frontend
    dayOfWeek = serializers.IntegerField(source='day_of_week')
    startTime = serializers.CharField(source='start_time')
    endTime = serializers.CharField(source='end_time')
    subjectEmoji = serializers.CharField(source='subject_emoji', required=False, allow_null=True)
    subjectName = serializers.CharField(source='subject_name', required=False, allow_null=True)
    
    class Meta:
        model = ScheduleSlot
        fields = ['id', 'dayOfWeek', 'startTime', 'endTime', 'task', 'color', 'status', 'subjectEmoji', 'subjectName']
