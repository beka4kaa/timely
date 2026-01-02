from rest_framework import serializers
from .models import LearningProgram, WeekPlan, TopicPlan, ScheduledTest, UserContext, AiMemory, AiCache

class TopicPlanSerializer(serializers.ModelSerializer):
    # Retrieve topic details when serializing
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
