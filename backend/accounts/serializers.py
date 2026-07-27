from rest_framework import serializers
from django.contrib.auth.password_validation import validate_password
from .models import CustomUser, UserRating, Task, TaskSubmission, Contest, PrivateLeaderboard

class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(
        write_only=True, required=True, validators=[validate_password]
    )
    password2 = serializers.CharField(write_only=True, required=True)
    name = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = CustomUser
        fields = ('email', 'password', 'password2', 'name')

    def validate(self, attrs):
        if attrs['password'] != attrs['password2']:
            raise serializers.ValidationError(
                {"password": "Password fields didn't match."}
            )
        return attrs

    def validate_email(self, value):
        if CustomUser.objects.filter(email=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def create(self, validated_data):
        validated_data.pop('password2')
        name = validated_data.pop('name', '')
        
        # Extract first and last name from full name
        name_parts = name.split(' ', 1) if name else ['', '']
        first_name = name_parts[0]
        last_name = name_parts[1] if len(name_parts) > 1 else ''
        
        user = CustomUser.objects.create_user(
            username=validated_data['email'],  # Use email as username
            email=validated_data['email'],
            password=validated_data['password'],
            first_name=first_name,
            last_name=last_name
        )
        return user


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField(required=True)
    password = serializers.CharField(required=True, write_only=True)


class UserSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()

    class Meta:
        model = CustomUser
        fields = ('id', 'email', 'name')

    def get_name(self, obj):
        return f"{obj.first_name} {obj.last_name}".strip() or obj.username


class UserRatingSerializer(serializers.ModelSerializer):
    discipline_name = serializers.CharField(source='discipline.name', read_only=True)

    class Meta:
        model = UserRating
        fields = ('discipline_name', 'elo_score', 'tier_level')


class LeaderboardSerializer(serializers.ModelSerializer):
    ratings = UserRatingSerializer(many=True, read_only=True)

    class Meta:
        model = CustomUser
        fields = ('id', 'username', 'country_code', 'city', 'overall_elo', 'ratings')

def _display_name(user):
    if not user:
        return ''
    return f"{user.first_name} {user.last_name}".strip() or user.username


class TaskSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = '__all__'
        read_only_fields = ('author', 'status')

    def get_author_name(self, obj):
        return _display_name(obj.author) if obj.author_id else ''


class TaskSubmissionSerializer(serializers.ModelSerializer):
    student_name  = serializers.SerializerMethodField()
    student_email = serializers.EmailField(source='student.email', read_only=True)
    task_title    = serializers.CharField(source='task.title', read_only=True)
    task_points   = serializers.IntegerField(source='task.points', read_only=True)

    class Meta:
        model = TaskSubmission
        fields = '__all__'
        read_only_fields = ('student', 'status', 'reviewed_by', 'reviewed_at', 'created_at')

    def get_student_name(self, obj):
        return _display_name(obj.student)


class ContestSerializer(serializers.ModelSerializer):
    # Write task membership by id; read full task details.
    tasks        = serializers.PrimaryKeyRelatedField(many=True, queryset=Task.objects.all(), required=False)
    task_details = TaskSerializer(source='tasks', many=True, read_only=True)

    class Meta:
        model = Contest
        fields = ('id', 'title', 'description', 'start_time', 'end_time', 'tasks', 'task_details', 'created_at')
        read_only_fields = ('created_at',)


class PrivateLeaderboardSerializer(serializers.ModelSerializer):
    owner_name = serializers.SerializerMethodField()
    members    = LeaderboardSerializer(many=True, read_only=True)

    class Meta:
        model = PrivateLeaderboard
        fields = ('id', 'name', 'owner', 'owner_name', 'members', 'created_at')
        read_only_fields = ('owner', 'created_at')

    def get_owner_name(self, obj):
        return _display_name(obj.owner)


class MeSerializer(serializers.ModelSerializer):
    name        = serializers.SerializerMethodField()
    is_admin    = serializers.SerializerMethodField()
    ai_plan     = serializers.SerializerMethodField()

    class Meta:
        model = CustomUser
        fields = (
            'id', 'email', 'username', 'name', 'overall_elo',
            'is_staff', 'is_moderator', 'is_admin', 'has_full_access', 'ai_plan',
        )

    def get_name(self, obj):
        return _display_name(obj)

    def get_is_admin(self, obj):
        # Single flag the frontend can gate on (admin OR moderator).
        return bool(obj.is_staff or obj.is_superuser or obj.is_moderator)

    def get_ai_plan(self, obj):
        return 'max' if obj.is_staff or obj.is_superuser else obj.ai_plan


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
        return _display_name(obj)

    def get_is_admin(self, obj):
        return bool(obj.is_staff or obj.is_superuser or obj.is_moderator)
