from rest_framework import serializers
from .models import Subject, Topic, Subtopic, ReviewSet, SrsState, ReviewLog, SrsReviewLog, MindSession

class SubtopicSerializer(serializers.ModelSerializer):
    class Meta:
        model = Subtopic
        fields = '__all__'

class TopicSerializer(serializers.ModelSerializer):
    subtopics = SubtopicSerializer(many=True, read_only=True)
    subject_id = serializers.PrimaryKeyRelatedField(
        queryset=Subject.objects.all(),
        source='subject',
        write_only=True,
        required=False
    )

    class Meta:
        model = Topic
        fields = '__all__'
        extra_kwargs = {
            'subject': {'required': False}
        }

class SubjectSerializer(serializers.ModelSerializer):
    topics = TopicSerializer(many=True, read_only=True)

    class Meta:
        model = Subject
        fields = '__all__'

class ReviewSetSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReviewSet
        fields = '__all__'

class SrsStateSerializer(serializers.ModelSerializer):
    class Meta:
        model = SrsState
        fields = '__all__'

class ReviewLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReviewLog
        fields = '__all__'

class SrsReviewLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = SrsReviewLog
        fields = '__all__'

class MindSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = MindSession
        fields = '__all__'
