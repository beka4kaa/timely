from rest_framework import serializers
from config.ownership import OwnedRelationsMixin, request_email
from curriculum.models import LearningGoal
from .models import DayPlan, Block, Segment, Subtask, TimerState, ScheduleSlot, Goal, GoalLink, has_parent_cycle


class GoalLinkSerializer(OwnedRelationsMixin, serializers.ModelSerializer):
    owned_relations = {'source': 'user_email', 'target': 'user_email'}

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
    progress        = serializers.IntegerField(min_value=0, max_value=100, required=False)
    isMain          = serializers.BooleanField(source='is_main', required=False)
    lessons         = serializers.PrimaryKeyRelatedField(
        many=True, required=False, queryset=LearningGoal.objects.all(), pk_field=serializers.UUIDField(),
    )

    class Meta:
        model = Goal
        fields = [
            'id', 'user_email', 'title', 'description', 'type', 'status', 'priority',
            'planningScale', 'parentId',
            'year', 'month', 'startDate', 'endDate', 'dueDate',
            'progress', 'order', 'computed_progress', 'children_count',
            'targetAmount', 'currentAmount', 'currency',
            'tone', 'scope', 'isMain', 'lessons',
            'createdAt', 'updatedAt',
        ]
        read_only_fields = ['user_email', 'computed_progress', 'children_count', 'createdAt', 'updatedAt']

    def get_fields(self):
        # Чужой предмет выглядит так же, как несуществующий: как у OwnedRelationsMixin,
        # только тот не умеет связи «многие ко многим».
        fields = super().get_fields()
        email = request_email(self.context.get('request'))
        fields['lessons'].child_relation.queryset = (
            LearningGoal.objects.none() if email is None else LearningGoal.objects.filter(user_email=email)
        )
        return fields

    def validate(self, attrs):
        if attrs.get('is_main'):
            probe = Goal(
                type=attrs.get('type') or (self.instance.type if self.instance else ''),
                status=attrs.get('status') or (self.instance.status if self.instance else 'not_started'),
            )
            if not probe.can_be_main():
                raise serializers.ValidationError({'isMain': 'Главной может быть только незавершённая цель.'})
        return attrs

    def validate_parentId(self, value):
        email = request_email(self.context.get('request'))
        if not value:
            return value
        if not Goal.objects.filter(id=value, user_email=email).exists():
            raise serializers.ValidationError('Parent goal not found.')
        if self.instance is not None:
            parents = dict(Goal.objects.filter(user_email=email).values_list('id', 'parent_id'))
            parents[self.instance.pk] = value
            if has_parent_cycle(parents):
                raise serializers.ValidationError('A goal cannot be moved under itself.')
        return value

    def get_computed_progress(self, obj):
        return obj.computed_progress()

    def get_children_count(self, obj):
        return obj.children.count()

class SubtaskSerializer(OwnedRelationsMixin, serializers.ModelSerializer):
    owned_relations = {'block': 'day_plan__user_email'}

    class Meta:
        model = Subtask
        fields = '__all__'

class SegmentSerializer(OwnedRelationsMixin, serializers.ModelSerializer):
    owned_relations = {'block': 'day_plan__user_email'}

    class Meta:
        model = Segment
        fields = '__all__'

class TimerStateSerializer(serializers.ModelSerializer):
    class Meta:
        model = TimerState
        fields = '__all__'

class BlockSerializer(OwnedRelationsMixin, serializers.ModelSerializer):
    owned_relations = {'day_plan': 'user_email'}

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
        read_only_fields = ['user_email']

    def validate_date(self, value):
        plan = self.instance
        if plan and DayPlan.objects.filter(user_email=plan.user_email, date=value).exclude(pk=plan.pk).exists():
            raise serializers.ValidationError('A plan for this date already exists.')
        return value

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
