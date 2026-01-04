from rest_framework import serializers
from .models import LearningProgram, WeekPlan, TopicPlan, ScheduledTest, UserContext, AiMemory, AiCache, StudySession
from mind.models import Subject, Topic

class SubjectNestedSerializer(serializers.ModelSerializer):
    class Meta:
        model = Subject
        fields = ['id', 'name', 'emoji', 'color']

class TopicNestedSerializer(serializers.ModelSerializer):
    subject = SubjectNestedSerializer(read_only=True)
    
    class Meta:
        model = Topic
        fields = ['id', 'name', 'subject']

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

class LearningProgramSerializer(serializers.ModelSerializer):
    week_plans = WeekPlanSerializer(many=True, read_only=True)
    topic_plans = TopicPlanSerializer(many=True, read_only=True)
    scheduled_tests = ScheduledTestSerializer(many=True, read_only=True)
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
