import json

from rest_framework import serializers
from .help_policy import HELP_PROFILES
from .models import LearningProgram, WeekPlan, TopicPlan, ScheduledTest, SubjectDeadline, UserContext, AiMemory, AiCache, ChatSession
from .tutor_modes import get_mode
from mind.models import Subject, Topic

# Потолок на сохраняемый холст. Считан по факту: одна иллюстрация приезжает
# data-URI примерно на 590 КБ, то есть 12 МБ — это порядка двадцати картинок
# плюс рисунки и тексты. Больше на одной доске не бывает, а предел защищает
# и запрос, и строку в базе от разрастания без границ.
MAX_CANVAS_BYTES = 12 * 1024 * 1024

# Try to import StudySession (may not exist if migration not applied)
try:
    from .models import StudySession
    STUDY_SESSION_AVAILABLE = True
except ImportError:
    STUDY_SESSION_AVAILABLE = False
    StudySession = None

class SubjectNestedSerializer(serializers.ModelSerializer):
    class Meta:
        model = Subject
        fields = ['id', 'name', 'emoji', 'color']

class TopicNestedSerializer(serializers.ModelSerializer):
    subject = SubjectNestedSerializer(read_only=True)
    
    class Meta:
        model = Topic
        fields = ['id', 'name', 'subject']

# Only define StudySessionSerializer if model is available
if STUDY_SESSION_AVAILABLE and StudySession is not None:
    class StudySessionSerializer(serializers.ModelSerializer):
        """Serializer for individual study sessions (THEORY, PRACTICE, REVIEW, TEST)"""
        topic = TopicNestedSerializer(read_only=True)
        subject = SubjectNestedSerializer(read_only=True)
        topic_name = serializers.CharField(source='topic.name', read_only=True, allow_null=True)
        subject_name = serializers.CharField(source='subject.name', read_only=True)
        
        class Meta:
            model = StudySession
            fields = [
                'id', 'session_type', 'scheduled_date', 'scheduled_time', 
                'duration_minutes', 'day_number', 'order_in_day', 'status',
                'topic', 'subject', 'topic_name', 'subject_name',
                'title', 'topics_covered', 'completed_at', 'notes'
        ]

class TopicPlanSerializer(serializers.ModelSerializer):
    # Include full topic object with nested subject
    topic = TopicNestedSerializer(read_only=True)
    # Keep flat fields for backward compatibility
    topic_name = serializers.CharField(source='topic.name', read_only=True)
    subject_name = serializers.CharField(source='topic.subject.name', read_only=True)

    class Meta:
        model = TopicPlan
        fields = '__all__'

class WeekPlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = WeekPlan
        fields = '__all__'

class ScheduledTestSerializer(serializers.ModelSerializer):
    subject = SubjectNestedSerializer(read_only=True)
    
    class Meta:
        model = ScheduledTest
        fields = '__all__'

class SubjectDeadlineSerializer(serializers.ModelSerializer):
    """Serializer for canonical subject deadlines"""
    subject = SubjectNestedSerializer(read_only=True)
    target_topic = TopicNestedSerializer(read_only=True)
    
    class Meta:
        model = SubjectDeadline
        fields = ['id', 'subject', 'target_topic', 'due_date', 'scope_mode', 'created_at']

class LearningProgramSerializer(serializers.ModelSerializer):
    week_plans = WeekPlanSerializer(many=True, read_only=True)
    topic_plans = TopicPlanSerializer(many=True, read_only=True)
    scheduled_tests = ScheduledTestSerializer(many=True, read_only=True)
    subject_deadlines = SubjectDeadlineSerializer(many=True, read_only=True)
    
    # Only include study_sessions if model is available
    if STUDY_SESSION_AVAILABLE:
        study_sessions = StudySessionSerializer(many=True, read_only=True)

    class Meta:
        model = LearningProgram
        fields = '__all__'

class UserContextSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserContext
        fields = '__all__'

class AiMemorySerializer(serializers.ModelSerializer):
    class Meta:
        model = AiMemory
        fields = '__all__'


class ChatSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChatSession
        fields = [
            'id', 'user_email', 'title', 'topic', 'messages', 'lesson_plan',
            'canvas', 'mode', 'help_profile', 'policy', 'goal', 'hint_level',
            'attempt_count', 'status', 'created_at', 'updated_at',
        ]
        # `policy` — вычисленные права, а не пожелание: их выдаёт
        # help_policy.resolve_profile на сервере. Разрешить клиенту писать сюда
        # значило бы разрешить ему самому включить готовые ответы (§3.3).
        read_only_fields = ['user_email', 'policy', 'created_at', 'updated_at']

    def validate_messages(self, value):
        """`messages` is a free-form JSONField written straight from the
        client; the frontend always sends the chat array, and anything else
        would break loadChatSession()'s setMessages()."""
        if not isinstance(value, list):
            raise serializers.ValidationError('messages must be a list')
        return value

    def validate_lesson_plan(self, value):
        if value is not None and not isinstance(value, dict):
            raise serializers.ValidationError('lesson_plan must be an object or null')
        return value

    def validate_canvas(self, value):
        """Содержимое доски: элементы и камера.

        Проверяем форму и ВЕРХНЮЮ ГРАНИЦУ. Иллюстрации лежат в элементах как
        data-URI по сотне-другой килобайт каждая, и без предела один холст с
        десятком картинок положил бы и запрос, и строку в базе. Превышение —
        это ошибка клиента (он обязан обрезать сам, см. MAX_CANVAS_BYTES во
        фронтенде), поэтому отвечаем 400, а не молча режем: молчаливая обрезка
        означала бы потерю рисунков без ведома ученика.
        """
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError('canvas must be an object')
        elements = value.get('elements')
        if elements is not None and not isinstance(elements, list):
            raise serializers.ValidationError('canvas.elements must be a list')
        size = len(json.dumps(value, ensure_ascii=False))
        if size > MAX_CANVAS_BYTES:
            raise serializers.ValidationError(
                f'canvas too large: {size} bytes (limit {MAX_CANVAS_BYTES})'
            )
        return value

    def validate_mode(self, value):
        """Нормализуем slug режима вместо отказа.

        Опечатка в режиме не повод потерять сохранение целого разговора, а
        `get_mode` уже умеет безопасный фолбэк. Пустая строка сохраняется как
        есть: это «режим не выбран», то есть поведение по умолчанию.
        """
        if not value:
            return ''
        return get_mode(value).slug

    def validate_help_profile(self, value):
        if not value:
            return ''
        return value if value in HELP_PROFILES else ''


class ChatSessionListSerializer(serializers.ModelSerializer):
    """Lightweight variant for the history list: omits `messages` so listing
    many saved chats doesn't ship every message body over the wire."""

    class Meta:
        # `mode` нужен списку: по нему история показывает, чем была сессия —
        # объяснением темы или контестом.
        model = ChatSession
        fields = ['id', 'title', 'topic', 'mode', 'status', 'created_at', 'updated_at']
