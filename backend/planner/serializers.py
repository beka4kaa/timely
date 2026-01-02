from rest_framework import serializers
from .models import DayPlan, Block, Segment, Subtask, TimerState

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
