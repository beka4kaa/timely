import uuid
from django.db import models


class WeeklyTemplate(models.Model):
    """
    User's weekly schedule template.
    id is a client-generated UUID string.
    slots is a JSON array kept in sync with TemplateLesson rows (backward compat).
    Only one template per user can be active at a time.
    """
    id = models.CharField(primary_key=True, max_length=36)
    user_email = models.EmailField(db_index=True)
    name = models.CharField(max_length=255)
    slots = models.JSONField(default=list)           # kept for backward compat / fast reads
    custom_presets = models.JSONField(default=list)  # user-saved block name presets
    is_active = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['user_email', 'is_active']),
        ]

    def __str__(self):
        return f"{self.user_email} — {self.name}"


class TemplateLesson(models.Model):
    """
    Normalised lesson slot that belongs to a WeeklyTemplate via FK.

    This is the source of truth for the template's lessons; the parent
    WeeklyTemplate.slots JSON field is kept in sync for backward-compatible
    reads.  When duplicating a template new TemplateLesson rows are created
    (the JSON slot IDs are NOT re-used so they remain unique).
    """
    DAY_CHOICES = [
        ('monday',    'Monday'),
        ('tuesday',   'Tuesday'),
        ('wednesday', 'Wednesday'),
        ('thursday',  'Thursday'),
        ('friday',    'Friday'),
        ('saturday',  'Saturday'),
        ('sunday',    'Sunday'),
    ]

    id = models.CharField(
        primary_key=True, max_length=36,
        default=uuid.uuid4, editable=False,
    )
    template = models.ForeignKey(
        WeeklyTemplate,
        on_delete=models.CASCADE,
        related_name='template_lessons',
    )
    day_of_week    = models.CharField(max_length=10, choices=DAY_CHOICES)
    lesson_number  = models.IntegerField()
    start_time     = models.CharField(max_length=5)   # "08:00"
    end_time       = models.CharField(max_length=5)   # "08:45"
    subject_id     = models.CharField(max_length=36, blank=True, default='')
    block_type     = models.CharField(max_length=50, default='lesson')
    label          = models.CharField(max_length=255, blank=True, default='')
    created_at     = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['day_of_week', 'lesson_number']
        indexes = [
            models.Index(fields=['template', 'day_of_week']),
        ]

    def __str__(self):
        return (
            f"{self.template.name} — {self.day_of_week} "
            f"#{self.lesson_number} ({self.block_type})"
        )

    def to_slot_dict(self) -> dict:
        """Convert to the TemplateLessonSlot shape used in slots JSON / API."""
        return {
            'id':           self.id,
            'dayOfWeek':    self.day_of_week,
            'lessonNumber': self.lesson_number,
            'startTime':    self.start_time,
            'endTime':      self.end_time,
            'subjectId':    self.subject_id,
            'blockType':    self.block_type,
            'label':        self.label,
        }


class DiaryWeek(models.Model):
    """
    Frozen snapshot of a diary week.
    id is a client-generated UUID string.
    days is a JSON array of DiaryDay objects (with lessons, grades, youtube links).
    """
    id = models.CharField(primary_key=True, max_length=36)
    user_email = models.EmailField(db_index=True)
    week_start = models.CharField(max_length=10, db_index=True)  # YYYY-MM-DD Monday
    week_end = models.CharField(max_length=10)                   # YYYY-MM-DD Sunday
    template_id = models.CharField(max_length=36, null=True, blank=True)
    days = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('user_email', 'week_start')]
        indexes = [
            models.Index(fields=['user_email', 'week_start']),
        ]

    def __str__(self):
        return f"{self.user_email} — {self.week_start}"
