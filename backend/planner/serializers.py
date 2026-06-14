from rest_framework import serializers
from .models import DayPlan, Block, Segment, Subtask, TimerState, ScheduleSlot, Goal, GoalLink


class GoalLinkSerializer(serializers.ModelSerializer):
    class Meta:
        model = GoalLink
        fields = ['id', 'source', 'target', 'type', 'strength']


class GoalSerializer(serializers.ModelSerializer):
    computed_progress = serializers.SerializerMethodField()
    children_count    = serializers.SerializerMethodField()
    # Expose parent id as parentId for camelCase frontend
    parentId = serializers.CharField(source='parent_id', required=False, allow_null=True)
    startDate       = serializers.DateField(source='start_date', required=False, allow_null=True)
    endDate         = serializers.DateField(source='end_date',   required=False, allow_null=True)
    dueDate         = serializers.DateField(source='due_date',   required=False, allow_null=True)
    planningScale   = serializers.CharField(source='planning_scale', required=False, allow_null=True)
    order           = serializers.IntegerField(source='order_index', required=False)
    targetAmount    = serializers.DecimalField(source='target_amount',  max_digits=15, decimal_places=2, required=False, allow_null=True)
    currentAmount   = serializers.DecimalField(source='current_amount', max_digits=15, decimal_places=2, required=False, allow_null=True)
    createdAt       = serializers.DateTimeField(source='created_at', read_only=True)
    updatedAt       = serializers.DateTimeField(source='updated_at', read_only=True)

    class Meta:
        model = Goal
        fields = [
            'id', 'user_email', 'title', 'description', 'type', 'status', 'priority',
            'planningScale', 'parentId',
            'year', 'month', 'startDate', 'endDate', 'dueDate',
            'progress', 'order', 'computed_progress', 'children_count',
            'targetAmount', 'currentAmount', 'currency',
            'createdAt', 'updatedAt',
        ]
        read_only_fields = ['user_email', 'computed_progress', 'children_count', 'createdAt', 'updatedAt']

    def get_computed_progress(self, obj):
        return obj.computed_progress()

    def get_children_count(self, obj):
        return obj.children.count()

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
