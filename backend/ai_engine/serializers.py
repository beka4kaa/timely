from rest_framework import serializers
from .models import LearningProgram, WeekPlan, TopicPlan, ScheduledTest, UserContext, AiMemory, AiCache
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
