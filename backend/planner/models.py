from django.db import models
from django.core.exceptions import ValidationError
import uuid


# ──────────────────────────────────────────────────────────────
# Goals planning models
# ──────────────────────────────────────────────────────────────

class Goal(models.Model):
    TYPE_CHOICES = [
        ('global_goal', 'Global Goal'),
        ('subgoal', 'Subgoal'),
        ('milestone', 'Milestone'),
        ('task', 'Task'),
        ('habit', 'Habit'),
        ('financial_goal', 'Financial Goal'),
    ]
    STATUS_CHOICES = [
        ('not_started', 'Not Started'),
        ('active', 'Active'),
        ('on_track', 'On Track'),
        ('at_risk', 'At Risk'),
        ('blocked', 'Blocked'),
        ('done', 'Done'),
        ('archived', 'Archived'),
    ]
    PRIORITY_CHOICES = [
        ('critical', 'Critical'),
        ('high', 'High'),
        ('medium', 'Medium'),
        ('low', 'Low'),
    ]
    SCALE_CHOICES = [
        ('year', 'Year'),
        ('month', 'Month'),
        ('day', 'Day'),
    ]

    id             = models.CharField(primary_key=True, max_length=64, default=uuid.uuid4, editable=False)
    user_email     = models.EmailField(db_index=True)

    title          = models.CharField(max_length=512)
    description    = models.TextField(blank=True, default='')
    type           = models.CharField(max_length=20, choices=TYPE_CHOICES)
    status         = models.CharField(max_length=20, choices=STATUS_CHOICES, default='not_started')
    priority       = models.CharField(max_length=10, choices=PRIORITY_CHOICES, null=True, blank=True)
    planning_scale = models.CharField(max_length=10, choices=SCALE_CHOICES, null=True, blank=True)

    parent         = models.ForeignKey(
        'self', null=True, blank=True,
        on_delete=models.SET_NULL, related_name='children',
    )

    # Temporal context
    year       = models.IntegerField(null=True, blank=True)
    month      = models.CharField(max_length=7, null=True, blank=True)   # "YYYY-MM"
    start_date = models.DateField(null=True, blank=True)
    end_date   = models.DateField(null=True, blank=True)
    due_date   = models.DateField(null=True, blank=True)

    # Progress (0–100); computed from children when they exist
    progress = models.IntegerField(default=0)

    # Financial fields
    target_amount  = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    current_amount = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    currency       = models.CharField(max_length=3, default='USD')

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title

    def computed_progress(self):
        """Recursively compute progress from children when they exist."""
        children = list(self.children.exclude(status='archived'))
        if not children:
            return self.progress
        return round(sum(c.computed_progress() for c in children) / len(children))

    def get_blockers(self):
        """Return goals that block this one (active blocks links pointing here)."""
        return Goal.objects.filter(
            outgoing_links__target=self,
            outgoing_links__type='blocks',
        ).exclude(status__in=['done', 'archived'])


class GoalLink(models.Model):
    """Directed relationship between two goals."""
    LINK_TYPE_CHOICES = [
        ('depends_on', 'Depends On'),    # source cannot start until target is done
        ('blocks',     'Blocks'),         # source being blocked means target is blocked
        ('supports',   'Supports'),       # soft positive contribution
        ('related_to', 'Related To'),     # informational grouping
        ('parent_child', 'Parent-Child'), # explicit hierarchy edge (mirrors Goal.parent)
    ]

    id       = models.CharField(primary_key=True, max_length=64, default=uuid.uuid4, editable=False)
    source   = models.ForeignKey(Goal, on_delete=models.CASCADE, related_name='outgoing_links')
    target   = models.ForeignKey(Goal, on_delete=models.CASCADE, related_name='incoming_links')
    type     = models.CharField(max_length=20, choices=LINK_TYPE_CHOICES)
    strength = models.IntegerField(default=1)   # 1–3, visual weight in graph

    class Meta:
        unique_together = ('source', 'target', 'type')

    def clean(self):
        if self.source_id == self.target_id:
            raise ValidationError('A goal cannot link to itself.')

    def __str__(self):
        return f'{self.source} —[{self.type}]→ {self.target}'

class DayPlan(models.Model):
    id = models.CharField(primary_key=True, max_length=255, default=uuid.uuid4, editable=False)
    user_email = models.EmailField(null=True, blank=True, db_index=True)  # User-based data isolation
    date = models.DateField()  # YYYY-MM-DD
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        unique_together = ('user_email', 'date')  # Unique per user

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

class ScheduleSlot(models.Model):
    """Weekly schedule slots - recurring time blocks"""
    STATUS_CHOICES = [
        ('PENDING', 'Pending'),
        ('IN_PROGRESS', 'In Progress'),
        ('COMPLETED', 'Completed'),
        ('SKIPPED', 'Skipped'),
    ]
    
    id = models.CharField(primary_key=True, max_length=255, default=uuid.uuid4, editable=False)
    user_email = models.EmailField(null=True, blank=True, db_index=True)  # User-based data isolation
    day_of_week = models.IntegerField()  # 0=Mon, 6=Sun
    start_time = models.CharField(max_length=10)  # "09:00"
    end_time = models.CharField(max_length=10)  # "10:00"
    task = models.CharField(max_length=255)
    color = models.CharField(max_length=9, default="#3b82f6")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    subject_emoji = models.CharField(max_length=10, null=True, blank=True)
    subject_name = models.CharField(max_length=100, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    def __str__(self):
        return f"{self.task} ({self.day_of_week}: {self.start_time}-{self.end_time})"
