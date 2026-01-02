from django.db import models
import uuid

class DayPlan(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid.uuid4, editable=False)
    date = models.DateField(unique=True)  # YYYY-MM-DD
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return str(self.date)

class Block(models.Model):
    STATUS_CHOICES = [
        ('NOT_STARTED', 'Not Started'),
        ('IN_PROGRESS', 'In Progress'),
        ('DONE', 'Done'),
        ('SKIPPED', 'Skipped'),
    ]

    id = models.CharField(primary_key=True, max_length=255, default=uuid.uuid4, editable=False)
    day_plan = models.ForeignKey(DayPlan, on_delete=models.CASCADE, related_name='blocks')
    type = models.CharField(max_length=50)  # LESSON, EVENT, BREAK
    title = models.CharField(max_length=255)
    duration_minutes = models.IntegerField()
    start_time = models.TimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='NOT_STARTED')
    order_index = models.IntegerField()
    notes = models.TextField(null=True, blank=True)
    color = models.CharField(max_length=9, default="#3b82f6")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.title

class Segment(models.Model):
    STATUS_CHOICES = [
        ('NOT_STARTED', 'Not Started'),
        ('IN_PROGRESS', 'In Progress'),
        ('DONE', 'Done'),
    ]

    id = models.CharField(primary_key=True, max_length=255, default=uuid.uuid4, editable=False)
    block = models.ForeignKey(Block, on_delete=models.CASCADE, related_name='segments')
    title = models.CharField(max_length=255)
    duration_minutes = models.IntegerField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='NOT_STARTED')
    order_index = models.IntegerField()

class Subtask(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid.uuid4, editable=False)
    block = models.ForeignKey(Block, on_delete=models.CASCADE, related_name='subtasks')
    title = models.CharField(max_length=255)
    is_done = models.BooleanField(default=False)
    order_index = models.IntegerField()

class TimerState(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid.uuid4, editable=False)
    block = models.OneToOneField(Block, on_delete=models.CASCADE, related_name='timer_state')
    segment_index = models.IntegerField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    remaining_seconds = models.IntegerField()
    is_running = models.BooleanField(default=False)
