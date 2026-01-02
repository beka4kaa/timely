from django.db import models
import uuid

class Subject(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid.uuid4, editable=False)
    user_email = models.EmailField(null=True, blank=True, db_index=True)  # For user-based data isolation
    name = models.CharField(max_length=255)
    emoji = models.CharField(max_length=10, default="📚")
    color = models.CharField(max_length=9, default="#8b5cf6")
    target_hours_week = models.FloatField(default=5)
    textbook_url = models.URLField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

class Topic(models.Model):
    STATUS_CHOICES = [
        ('NOT_STARTED', 'Not Started'),
        ('MEDIUM', 'Medium'),
        ('SUCCESS', 'Success'),
        ('MASTERED', 'Mastered'),
    ]
    STUDY_STATE_CHOICES = [
        ('STUDIED', 'Studied'),
        ('NOT_STUDIED', 'Not Studied'),
    ]

    id = models.CharField(primary_key=True, max_length=255, default=uuid.uuid4, editable=False)
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE, related_name='topics')
    name = models.CharField(max_length=255)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='NOT_STARTED')
    study_state = models.CharField(max_length=20, choices=STUDY_STATE_CHOICES, default='NOT_STUDIED')
    picked = models.BooleanField(default=False)
    order_index = models.IntegerField(default=0)
    archived = models.BooleanField(default=False)
    last_revised_at = models.DateTimeField(null=True, blank=True)
    next_review_at = models.DateTimeField(null=True, blank=True)
    interval_days = models.IntegerField(null=True, blank=True)
    ease_factor = models.FloatField(default=2.5)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

class Subtopic(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid.uuid4, editable=False)
    topic = models.ForeignKey(Topic, on_delete=models.CASCADE, related_name='subtopics')
    title = models.CharField(max_length=255)
    order_index = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.title

class ReviewSet(models.Model):
    TYPE_CHOICES = [
        ('END_OF_CHAPTER', 'End of Chapter'),
        ('CROSS_TOPIC', 'Cross Topic'),
    ]

    id = models.CharField(primary_key=True, max_length=255, default=uuid.uuid4, editable=False)
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE, null=True, blank=True, related_name='review_sets')
    topic = models.ForeignKey(Topic, on_delete=models.SET_NULL, null=True, blank=True, related_name='review_sets')
    title = models.CharField(max_length=255)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    order_index = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

class SrsState(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid.uuid4, editable=False)
    entity_type = models.CharField(max_length=20) # "SUBTOPIC" | "REVIEW_SET"
    subtopic = models.OneToOneField(Subtopic, on_delete=models.CASCADE, null=True, blank=True, related_name='srs_state')
    review_set = models.OneToOneField(ReviewSet, on_delete=models.CASCADE, null=True, blank=True, related_name='srs_state')
    last_reviewed_at = models.DateTimeField(null=True, blank=True)
    next_review_at = models.DateTimeField(null=True, blank=True)
    interval_days = models.IntegerField(null=True, blank=True)
    ease_factor = models.FloatField(default=2.5)
    mastery = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

class ReviewSetLink(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid.uuid4, editable=False)
    review_set = models.ForeignKey(ReviewSet, on_delete=models.CASCADE, related_name='links')
    topic = models.ForeignKey(Topic, on_delete=models.CASCADE, related_name='review_set_links')

    class Meta:
        unique_together = ('review_set', 'topic')

class ReviewLog(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid.uuid4, editable=False)
    topic = models.ForeignKey(Topic, on_delete=models.CASCADE, related_name='review_logs')
    rating = models.CharField(max_length=10) # AGAIN, HARD, GOOD, EASY
    reviewed_at = models.DateTimeField(auto_now_add=True)
    interval_days_after = models.IntegerField()

class SrsReviewLog(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid.uuid4, editable=False)
    entity_type = models.CharField(max_length=20) # "SUBTOPIC" | "REVIEW_SET"
    entity_id = models.CharField(max_length=255) # Store UUID as string or use GenericForeignKey
    rating = models.CharField(max_length=10)
    reviewed_at = models.DateTimeField(auto_now_add=True)
    interval_days_after = models.IntegerField()

class MindSession(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid.uuid4, editable=False)
    user_email = models.EmailField(null=True, blank=True, db_index=True)
    task_name = models.CharField(max_length=255)
    topic = models.ForeignKey(Topic, on_delete=models.SET_NULL, null=True, blank=True, related_name='study_sessions')
    started_at = models.DateTimeField(auto_now_add=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    breaks_minutes = models.IntegerField(default=0)
    total_minutes = models.IntegerField(null=True, blank=True)
