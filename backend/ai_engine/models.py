from django.db import models
import uuid
from mind.models import Topic, Subject

class LearningProgram(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, default="Моя программа обучения")
    start_date = models.DateTimeField(auto_now_add=True)
    end_date = models.DateTimeField(null=True, blank=True)
    total_weeks = models.IntegerField(default=12)
    hours_per_week = models.IntegerField(default=20)
    is_active = models.BooleanField(default=True)
    generated_at = models.DateTimeField(auto_now_add=True)
    description = models.TextField(null=True, blank=True)
    strategy = models.TextField(null=True, blank=True) # JSON stored as text
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

class WeekPlan(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    program = models.ForeignKey(LearningProgram, on_delete=models.CASCADE, related_name='week_plans')
    week_number = models.IntegerField()
    start_date = models.DateTimeField()
    end_date = models.DateTimeField()
    subject_hours = models.TextField(default="{}") # JSON: { subjectId: hours }
    focus = models.TextField(null=True, blank=True)
    notes = models.TextField(null=True, blank=True)

    class Meta:
        unique_together = ('program', 'week_number')

class TopicPlan(models.Model):
    STATUS_CHOICES = [
        ('PENDING', 'Pending'),
        ('IN_PROGRESS', 'In Progress'),
        ('COMPLETED', 'Completed'),
        ('SKIPPED', 'Skipped'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    program = models.ForeignKey(LearningProgram, on_delete=models.CASCADE, related_name='topic_plans')
    topic = models.ForeignKey(Topic, on_delete=models.CASCADE, related_name='topic_plans')
    planned_week = models.IntegerField()
    estimated_hours = models.FloatField()
    priority = models.IntegerField(default=1) # 1-5
    deadline = models.DateTimeField(null=True, blank=True)
    is_flexible = models.BooleanField(default=True)
    manually_moved = models.BooleanField(default=False)
    reinforce_week1 = models.IntegerField(null=True, blank=True)
    reinforce_week2 = models.IntegerField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    completed_at = models.DateTimeField(null=True, blank=True)

class ScheduledTest(models.Model):
    STATUS_CHOICES = [
        ('SCHEDULED', 'Scheduled'),
        ('COMPLETED', 'Completed'),
        ('SKIPPED', 'Skipped'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    program = models.ForeignKey(LearningProgram, on_delete=models.CASCADE, related_name='scheduled_tests')
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE, related_name='scheduled_tests')
    scheduled_date = models.DateTimeField()
    scheduled_time = models.CharField(max_length=5, null=True, blank=True) # HH:MM
    topics_covered = models.TextField() # JSON array of topic IDs
    title = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    type = models.CharField(max_length=50, default="TOPIC_TEST")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='SCHEDULED')
    completed_at = models.DateTimeField(null=True, blank=True)
    score = models.FloatField(null=True, blank=True)

class UserContext(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key = models.CharField(max_length=255, unique=True)
    value = models.TextField() # JSON string
    updated_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

class AiMemory(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    type = models.CharField(max_length=50) # fact, preference, goal
    content = models.TextField()
    importance = models.IntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

class AiCache(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key = models.CharField(max_length=255, unique=True)
    response = models.TextField() # JSON response
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
