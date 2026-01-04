from django.db import models
import uuid
from mind.models import Topic, Subject

class LearningProgram(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_email = models.EmailField(null=True, blank=True, db_index=True)  # User-based data isolation
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
    hours_planned = models.FloatField(default=0)  # Total hours planned for this week

    class Meta:
        unique_together = ('program', 'week_number')


class StudySession(models.Model):
    """Individual study session within a day - can be THEORY, PRACTICE, REVIEW, or TEST"""
    SESSION_TYPES = [
        ('THEORY', 'Theory - Initial Learning'),
        ('PRACTICE', 'Practice - Exercises'),
        ('REVIEW', 'Review - Spaced Repetition'),
        ('TEST', 'Test - Knowledge Check'),
    ]
    STATUS_CHOICES = [
        ('SCHEDULED', 'Scheduled'),
        ('IN_PROGRESS', 'In Progress'),
        ('COMPLETED', 'Completed'),
        ('SKIPPED', 'Skipped'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    program = models.ForeignKey(LearningProgram, on_delete=models.CASCADE, related_name='study_sessions')
    topic = models.ForeignKey(Topic, on_delete=models.CASCADE, related_name='ai_study_sessions', null=True, blank=True)
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE, related_name='ai_study_sessions')
    
    session_type = models.CharField(max_length=20, choices=SESSION_TYPES, default='THEORY')
    scheduled_date = models.DateField()
    scheduled_time = models.CharField(max_length=5, default='08:00')  # HH:MM
    duration_minutes = models.IntegerField(default=45)
    day_number = models.IntegerField(default=1)
    order_in_day = models.IntegerField(default=1)  # Order of session within the day
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='SCHEDULED')
    completed_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    
    # For TEST sessions
    title = models.CharField(max_length=255, null=True, blank=True)
    topics_covered = models.TextField(null=True, blank=True)  # JSON array of topic names for tests
    
    class Meta:
        ordering = ['scheduled_date', 'scheduled_time', 'order_in_day']
    
    def __str__(self):
        return f"{self.session_type}: {self.topic.name if self.topic else 'Test'} on {self.scheduled_date}"


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
    planned_day = models.IntegerField(default=1)  # Day number for initial learning
    estimated_hours = models.FloatField()
    priority = models.IntegerField(default=1) # 1-5
    deadline = models.DateTimeField(null=True, blank=True)
    is_flexible = models.BooleanField(default=True)
    manually_moved = models.BooleanField(default=False)
    
    # Spaced repetition tracking
    theory_day = models.IntegerField(null=True, blank=True)  # Day for theory session
    practice_day = models.IntegerField(null=True, blank=True)  # Day for practice session
    review1_day = models.IntegerField(null=True, blank=True)  # Day for first review
    review2_day = models.IntegerField(null=True, blank=True)  # Day for second review
    
    # Legacy fields for compatibility
    reinforce_week1 = models.IntegerField(null=True, blank=True)
    reinforce_week2 = models.IntegerField(null=True, blank=True)
    
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    completed_at = models.DateTimeField(null=True, blank=True)

class SubjectDeadline(models.Model):
    """Canonical deadline entity per subject - single source of truth"""
    SCOPE_CHOICES = [
        ('UP_TO_TOPIC', 'Learn up to specific topic'),
        ('ALL_TOPICS', 'Learn all topics'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    program = models.ForeignKey(LearningProgram, on_delete=models.CASCADE, related_name='subject_deadlines')
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE, related_name='program_deadlines')
    target_topic = models.ForeignKey(Topic, on_delete=models.SET_NULL, null=True, blank=True, related_name='deadline_milestones')
    due_date = models.DateTimeField()  # User-local midnight end-of-day
    scope_mode = models.CharField(max_length=20, choices=SCOPE_CHOICES, default='ALL_TOPICS')
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = ('program', 'subject')
    
    def __str__(self):
        scope = f"up to {self.target_topic.name}" if self.scope_mode == 'UP_TO_TOPIC' and self.target_topic else "all topics"
        return f"{self.subject.name}: {scope} by {self.due_date.strftime('%Y-%m-%d')}"

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
