from django.db import models


class WeeklyTemplate(models.Model):
    """
    User's weekly schedule template.
    id is a client-generated UUID string.
    slots is a JSON array of TemplateLessonSlot objects.
    Only one template per user can be active at a time.
    """
    id = models.CharField(primary_key=True, max_length=36)
    user_email = models.EmailField(db_index=True)
    name = models.CharField(max_length=255)
    slots = models.JSONField(default=list)
    is_active = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['user_email', 'is_active']),
        ]

    def __str__(self):
        return f"{self.user_email} — {self.name}"


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
