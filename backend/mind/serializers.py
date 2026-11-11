from django.utils import timezone
from rest_framework import serializers
from config.ownership import OwnedRelationsMixin, request_email
from . import reviews, srs
from .models import Subject, Topic, Subtopic, ReviewSet, SrsState, ReviewLog, SrsReviewLog, MindSession

class SubtopicSerializer(OwnedRelationsMixin, serializers.ModelSerializer):
    owned_relations = {'topic': 'subject__user_email'}

    class Meta:
        model = Subtopic
        fields = '__all__'

class TopicSerializer(OwnedRelationsMixin, serializers.ModelSerializer):
    owned_relations = {'subject': 'user_email', 'subject_id': 'user_email'}

    subtopics = SubtopicSerializer(many=True, read_only=True)
    subject_id = serializers.PrimaryKeyRelatedField(
        queryset=Subject.objects.all(),
        source='subject',
        write_only=True,
        required=False
    )
    # Add subject info fields
    subject_name = serializers.SerializerMethodField()
    subject_emoji = serializers.SerializerMethodField()
    subject_color = serializers.SerializerMethodField()
    # Шанс вспомнить тему сейчас по FSRS. Только для порядка тем: ученику число
    # не показывается. `None`, пока тему ни разу не оценили.
    recall_probability = serializers.SerializerMethodField()
    # Через сколько дней вернётся тема при каждой из четырёх оценок: подпись на
    # кнопке. Считает тот же `mind.srs`, что и само повторение.
    review_intervals = serializers.SerializerMethodField()

    class Meta:
        model = Topic
        fields = '__all__'
        extra_kwargs = {
            'subject': {'required': False}
        }

    def _fsrs_context(self):
        """Общее на весь ответ: один момент «сейчас» и один запрос о контрольных."""
        cache = self.context.setdefault('_fsrs', {})
        if 'now' not in cache:
            cache['now'] = timezone.now()
        return cache

    def _exam(self, obj):
        """Цель вспоминания и ближайшая контрольная предмета, как при самом повторении."""
        cache = self._fsrs_context()
        if 'exam_days' not in cache:
            email = request_email(self.context.get('request'))
            cache['exam_days'] = reviews.exam_days(email, cache['now']) if email else None
        if cache['exam_days'] is None:
            return reviews.exam_outlook_for(obj, cache['now'])
        return reviews.exam_outlook(obj.subject_id, cache['exam_days'], cache['now'])

    def get_recall_probability(self, obj):
        chance = srs.recall_probability(srs.memory_of(obj), self._fsrs_context()['now'])
        return None if chance is None else round(chance, 4)

    def get_review_intervals(self, obj):
        retention, next_test = self._exam(obj)
        return srs.preview_intervals(
            srs.memory_of(obj), self._fsrs_context()['now'], retention, next_test=next_test
        )
    
    def get_subject_name(self, obj):
        return obj.subject.name if obj.subject else None
    
    def get_subject_emoji(self, obj):
        return obj.subject.emoji if obj.subject else None
    
    def get_subject_color(self, obj):
        return obj.subject.color if obj.subject else None

class SubjectSerializer(serializers.ModelSerializer):
    topics = TopicSerializer(many=True, read_only=True)

    class Meta:
        model = Subject
        fields = '__all__'
        read_only_fields = ['user_email']

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

class MindSessionSerializer(OwnedRelationsMixin, serializers.ModelSerializer):
    owned_relations = {'topic': 'subject__user_email'}

    class Meta:
        model = MindSession
        fields = '__all__'
        read_only_fields = ['user_email']
