from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Subject, Topic, ReviewSet, Subtopic, MindSession
from .serializers import SubjectSerializer, TopicSerializer, SubtopicSerializer, MindSessionSerializer
from django.utils import timezone
from datetime import timedelta
from django.db.models import Q
from django.core.cache import cache

class SubjectViewSet(viewsets.ModelViewSet):
    queryset = Subject.objects.all()
    serializer_class = SubjectSerializer
    
    def get_queryset(self):
        user_email = getattr(self.request, 'user_email', None)
        queryset = Subject.objects.all().prefetch_related('topics')
        
        # Filter by user - each user only sees their own data
        if user_email:
            queryset = queryset.filter(user_email=user_email)
        
        return queryset.order_by('created_at')
    
    def perform_create(self, serializer):
        user_email = getattr(self.request, 'user_email', None)
        serializer.save(user_email=user_email)

class TopicViewSet(viewsets.ModelViewSet):
    queryset = Topic.objects.all()
    serializer_class = TopicSerializer
    
    def get_queryset(self):
        user_email = getattr(self.request, 'user_email', None)
        queryset = Topic.objects.all().select_related('subject').prefetch_related('subtopics')
        
        # Filter by user (through subject) OR orphaned topics (no subject or subject without user_email)
        if user_email:
            queryset = queryset.filter(
                Q(subject__user_email=user_email) |  # User's topics
                Q(subject__user_email__isnull=True) |  # Orphaned topics (subject has no user)
                Q(subject__user_email='') |  # Orphaned topics (subject has empty user)
                Q(subject__isnull=True)  # Topics without subject
            )
        
        # Filter by subject
        subject_id = self.request.query_params.get('subjectId') or self.request.query_params.get('subject_id')
        if subject_id:
            queryset = queryset.filter(subject_id=subject_id)
        
        # Filter by status/category
        filter_param = self.request.query_params.get('filter', 'all')
        now = timezone.now()
        
        if filter_param == 'weak' or filter_param == 'weaknesses':
            queryset = queryset.filter(
                Q(ease_factor__lt=2.0) | 
                Q(next_review_at__lt=now) |
                Q(status__in=['NOT_STARTED', 'LEARNING'])
            )
        elif filter_param == 'mastered':
            queryset = queryset.filter(status='MASTERED')
        elif filter_param == 'in_progress' or filter_param == 'learning':
            queryset = queryset.filter(status__in=['LEARNING', 'IN_PROGRESS'])
        elif filter_param == 'due':
            queryset = queryset.filter(next_review_at__lte=now)
        elif filter_param == 'not_started':
            queryset = queryset.filter(status='NOT_STARTED')
        
        return queryset.order_by('order_index', 'created_at')

    def perform_create(self, serializer):
        """Associate topic with a subject that belongs to the user"""
        serializer.save()
    
    def list(self, request, *args, **kwargs):
        queryset = self.get_queryset()
        serializer = self.get_serializer(queryset, many=True)
        data = serializer.data
        
        # Add subject_name to each topic for frontend convenience
        for item in data:
            topic = queryset.filter(id=item['id']).first()
            if topic and topic.subject:
                item['subject_name'] = topic.subject.name
                item['subject_emoji'] = topic.subject.emoji
                item['subject_color'] = topic.subject.color
        
        return Response(data)

    @action(detail=False, methods=['post'])
    def reorder(self, request):
        ids = request.data.get('ids') or request.data.get('topicIds') or request.data.get('topic_ids', [])
        subject_id = request.data.get('subjectId') or request.data.get('subject_id')
        
        for index, t_id in enumerate(ids):
            Topic.objects.filter(id=t_id).update(order_index=index)
        return Response({'status': 'reordered', 'count': len(ids)})

    @action(detail=True, methods=['post'])
    def review(self, request, pk=None):
        """Spaced repetition review with GOOD (like) and AGAIN (dislike)"""
        topic = self.get_object()
        rating = request.data.get('rating', 'GOOD')
        
        current_interval = topic.interval_days or 1
        ease_factor = topic.ease_factor or 2.5
        
        if rating == 'AGAIN':  # Dislike - reset progress, set to MEDIUM (orange)
            interval = 1  # Review tomorrow
            ease_factor = max(1.3, ease_factor - 0.2)
            topic.status = 'MEDIUM'
        elif rating == 'HARD':
            interval = max(1, int(current_interval * 1.2))
            ease_factor = max(1.3, ease_factor - 0.15)
            if topic.status == 'NOT_STARTED':
                topic.status = 'MEDIUM'
        elif rating == 'GOOD':  # Like - increase interval
            if topic.status == 'NOT_STARTED':
                interval = 1  # First review: 1 day
                topic.status = 'MEDIUM'
            elif topic.status == 'MEDIUM':
                interval = max(2, int(current_interval * ease_factor))
                if current_interval >= 3:
                    topic.status = 'SUCCESS'
            elif topic.status == 'SUCCESS':
                interval = max(4, int(current_interval * ease_factor))
                if current_interval >= 7:
                    topic.status = 'MASTERED'
            else:  # MASTERED
                interval = max(7, int(current_interval * ease_factor))
        elif rating == 'EASY':  # Super like - big interval jump
            interval = max(7, int(current_interval * ease_factor * 1.5))
            ease_factor = min(3.0, ease_factor + 0.15)
            if topic.status in ['NOT_STARTED', 'MEDIUM']:
                topic.status = 'SUCCESS'
            elif topic.status == 'SUCCESS':
                topic.status = 'MASTERED'
             
        topic.last_revised_at = timezone.now()
        topic.next_review_at = timezone.now() + timedelta(days=interval)
        topic.ease_factor = ease_factor
        topic.interval_days = interval
            
        topic.save()
        return Response(TopicSerializer(topic).data)

class SubtopicViewSet(viewsets.ModelViewSet):
    queryset = Subtopic.objects.all()
    serializer_class = SubtopicSerializer
    
    def get_queryset(self):
        queryset = Subtopic.objects.all().select_related('topic')
        
        # Filter by topic
        topic_id = self.request.query_params.get('topicId') or self.request.query_params.get('topic_id')
        if topic_id:
            queryset = queryset.filter(topic_id=topic_id)
        
        return queryset.order_by('order_index', 'created_at')
    
    @action(detail=True, methods=['post', 'patch'])
    def review(self, request, pk=None):
        subtopic = self.get_object()
        subtopic.last_reviewed_at = timezone.now()
        subtopic.review_count = (subtopic.review_count or 0) + 1
        subtopic.save()
        return Response(SubtopicSerializer(subtopic).data)

class MindSessionViewSet(viewsets.ModelViewSet):
    queryset = MindSession.objects.all()
    serializer_class = MindSessionSerializer
    
    def get_queryset(self):
        user_email = getattr(self.request, 'user_email', None)
        queryset = MindSession.objects.all()
        
        # Filter by user - each user only sees their own data
        if user_email:
            queryset = queryset.filter(user_email=user_email)
        
        # Filter by days (last N days)
        days = self.request.query_params.get('days')
        if days:
            try:
                days_int = int(days)
                cutoff = timezone.now() - timedelta(days=days_int)
                queryset = queryset.filter(started_at__gte=cutoff)
            except ValueError:
                pass
        
        return queryset.order_by('-started_at')
    
    def perform_create(self, serializer):
        user_email = getattr(self.request, 'user_email', None)
        serializer.save(user_email=user_email)
