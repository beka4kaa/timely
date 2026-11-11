from django.db.models import Exists, OuterRef, Q
from django.utils import timezone
from rest_framework import serializers
from .models import Contest, CustomUser, UserRating, Task, TaskSubmission, PrivateLeaderboard


def is_admin_or_mod(user):
    return bool(user and (user.is_staff or user.is_superuser or user.is_moderator))


def with_openness(tasks):
    """Marks whether a student may read each task's statement and author's solution.

    All of a task's contests decide, not the one it is viewed through: a task from a
    past contest can be set again in a future one. A task in no contest stays closed,
    because an admin creates the tasks first and the contest later.
    """
    now = timezone.now()
    contests = Contest.objects.filter(tasks=OuterRef('pk'))
    past = Exists(contests.filter(end_time__lte=now))
    running = Exists(contests.filter(start_time__lte=now, end_time__gt=now))
    upcoming = Exists(contests.filter(start_time__gt=now))
    return tasks.annotate(
        statement_open=running | (past & ~upcoming),
        solution_open=past & ~running & ~upcoming,
    )


def visible_tasks(viewer):
    """The tasks this person can open: staff all, a student what has come out, and their own."""
    tasks = with_openness(Task.objects.select_related('author'))
    if is_admin_or_mod(viewer):
        return tasks
    open_to_viewer = Q(statement_open=True)
    if viewer:
        open_to_viewer |= Q(author=viewer, status='active')
    return tasks.filter(open_to_viewer)


class UserRatingSerializer(serializers.ModelSerializer):
    discipline_name = serializers.CharField(source='discipline.name', read_only=True)

    class Meta:
        model = UserRating
        fields = ('discipline_name', 'elo_score', 'tier_level')


def public_username(user):
    """Older accounts have their address as `username`: show others no part of it."""
    return f"Ученик {user.pk}" if "@" in user.username else user.username


class LeaderboardSerializer(serializers.ModelSerializer):
    # No city: students are minors, and the model holds no consent to a local rating.
    ratings = UserRatingSerializer(many=True, read_only=True)
    username = serializers.SerializerMethodField()

    class Meta:
        model = CustomUser
        fields = ('id', 'username', 'country_code', 'overall_elo', 'ratings')

    def get_username(self, obj):
        return public_username(obj)

def display_name(user):
    if not user:
        return ''
    return f"{user.first_name} {user.last_name}".strip() or public_username(user)


def own_name(user):
    """For the account itself and for admins, who can see the address anyway."""
    return f"{user.first_name} {user.last_name}".strip() or user.username.split('@')[0]


class TaskSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = '__all__'
        read_only_fields = ('author', 'status')

    def get_author_name(self, obj):
        return public_username(obj.author) if obj.author_id else ''

    def to_representation(self, task):
        data = super().to_representation(task)
        viewer = self.context.get('viewer')
        # The author wrote it, so hiding it from them protects nothing. Without the
        # marks from `with_openness` it stays closed.
        may_read = (
            is_admin_or_mod(viewer)
            or (viewer and task.author_id == viewer.pk)
            or getattr(task, 'solution_open', False)
        )
        if not may_read:
            data.pop('author_solution_image')
        return data


class TaskSubmissionSerializer(serializers.ModelSerializer):
    student_name  = serializers.SerializerMethodField()
    student_email = serializers.EmailField(source='student.email', read_only=True)
    task_title    = serializers.CharField(source='task.title', read_only=True)
    task_points   = serializers.IntegerField(source='task.points', read_only=True)

    class Meta:
        model = TaskSubmission
        fields = '__all__'
        read_only_fields = ('student', 'status', 'reviewed_by', 'reviewed_at', 'created_at')

    def get_fields(self):
        fields = super().get_fields()
        # The answer names the task and its points, so only a task already open can be
        # chosen. A closed one gets the same refusal as a number that doesn't exist.
        fields['task'].queryset = visible_tasks(self.context.get('viewer'))
        return fields

    def get_student_name(self, obj):
        return display_name(obj.student)


class PrivateLeaderboardSerializer(serializers.ModelSerializer):
    owner_name = serializers.SerializerMethodField()
    members    = LeaderboardSerializer(many=True, read_only=True)

    class Meta:
        model = PrivateLeaderboard
        fields = ('id', 'name', 'owner', 'owner_name', 'members', 'invite_code', 'created_at')
        read_only_fields = ('owner', 'invite_code', 'created_at')

    def get_owner_name(self, obj):
        return public_username(obj.owner)

    def to_representation(self, board):
        data = super().to_representation(board)
        viewer = self.context.get('viewer')
        # The owner decides who gets the code, so a member can't pass it on from here.
        if not viewer or board.owner_id != viewer.pk:
            data.pop('invite_code')
        return data


class MeSerializer(serializers.ModelSerializer):
    name            = serializers.SerializerMethodField()
    is_admin        = serializers.SerializerMethodField()
    ai_plan         = serializers.SerializerMethodField()
    public_username = serializers.SerializerMethodField()

    class Meta:
        model = CustomUser
        fields = (
            'id', 'email', 'username', 'name', 'overall_elo',
            'is_staff', 'is_moderator', 'is_admin', 'has_full_access', 'ai_plan',
            'bio', 'show_in_leaderboard', 'public_username', 'city',
        )

    def get_name(self, obj):
        return own_name(obj)

    def get_public_username(self, obj):
        # The name others would see, so the student can be told it before agreeing.
        return public_username(obj)

    def get_is_admin(self, obj):
        # Single flag the frontend can gate on (admin OR moderator).
        return bool(obj.is_staff or obj.is_superuser or obj.is_moderator)

    def get_ai_plan(self, obj):
        return 'max' if obj.is_staff or obj.is_superuser else obj.ai_plan


class MeUpdateSerializer(serializers.ModelSerializer):
    """What a student may change about themselves. Roles and rating are not here on purpose."""

    class Meta:
        model = CustomUser
        fields = ('bio', 'show_in_leaderboard')


class AdminUserSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()
    is_admin = serializers.SerializerMethodField()
    submissions_total = serializers.IntegerField(read_only=True)
    submissions_approved = serializers.IntegerField(read_only=True)
    submissions_pending = serializers.IntegerField(read_only=True)
    submissions_rejected = serializers.IntegerField(read_only=True)

    class Meta:
        model = CustomUser
        fields = (
            'id', 'email', 'username', 'name', 'overall_elo',
            'contribution_points', 'is_staff', 'is_superuser', 'is_moderator',
            'is_admin', 'has_full_access', 'ai_plan', 'date_joined', 'last_login',
            'submissions_total', 'submissions_approved', 'submissions_pending',
            'submissions_rejected',
        )

    def get_name(self, obj):
        return own_name(obj)

    def get_is_admin(self, obj):
        return bool(obj.is_staff or obj.is_superuser or obj.is_moderator)
