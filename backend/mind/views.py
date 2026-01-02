from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Subject, Topic, ReviewSet
from .serializers import SubjectSerializer, TopicSerializer
from django.utils import timezone
from datetime import timedelta

class SubjectViewSet(viewsets.ModelViewSet):
    queryset = Subject.objects.all()
    serializer_class = SubjectSerializer

class TopicViewSet(viewsets.ModelViewSet):
    queryset = Topic.objects.all()
    serializer_class = TopicSerializer

    @action(detail=False, methods=['post'])
    def reorder(self, request):
        ids = request.data.get('ids', [])
        for index, t_id in enumerate(ids):
            Topic.objects.filter(id=t_id).update(order_index=index)
        return Response({'status': 'reordered'})

    @action(detail=True, methods=['post'])
    def review(self, request, pk=None):
        topic = self.get_object()
        rating = request.data.get('rating') # AGAIN, HARD, GOOD, EASY
        
        # Simple SRS Logic (SM-2 simplified)
        # In reality, complex calculation happens here.
        # For now, simplistic logic based on rating:
        
        interval = 1
        ease_factor = topic.ease_factor
        
        if rating == 'AGAIN':
            interval = 0
            ease_factor = max(1.3, ease_factor - 0.2)
        elif rating == 'HARD':
            interval = 1
            ease_factor = max(1.3, ease_factor - 0.15)
        elif rating == 'GOOD':
            interval = 2 # Placeholder logic
            ease_factor = ease_factor
        elif rating == 'EASY':
             interval = 4
             ease_factor += 0.15
             
        topic.last_revised_at = timezone.now()
        topic.next_review_at = timezone.now() + timedelta(days=interval)
        topic.ease_factor = ease_factor
        if rating == 'EASY' and topic.status != 'MASTERED':
            topic.status = 'SUCCESS'
        if rating == 'MASTERED' or (topic.status == 'SUCCESS' and rating == 'EASY'): # Logic can be refined
            topic.status = 'MASTERED'
            
        topic.save()
        return Response(TopicSerializer(topic).data)
