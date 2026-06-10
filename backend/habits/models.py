from django.db import models


class Habit(models.Model):
    user_email = models.EmailField(db_index=True)
    name = models.CharField(max_length=255)
    emoji = models.CharField(max_length=10, default='✨')
    color = models.CharField(max_length=7, default='#6366f1')
    # Micro-goal hint, e.g. "хотя бы 5 минут" — encourages tiny wins.
    goal_text = models.CharField(max_length=120, blank=True, default='')
    # Forgiving streaks: how many gap days a streak can survive ("shields").
    freeze_budget = models.PositiveSmallIntegerField(default=2)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']
        indexes = [models.Index(fields=['user_email'])]

    def __str__(self):
        return f"{self.user_email} — {self.name}"


class HabitLog(models.Model):
    habit = models.ForeignKey(Habit, on_delete=models.CASCADE, related_name='logs')
    date = models.DateField(db_index=True)
    # Optional per-day detail (added via long-press modal).
    note = models.TextField(blank=True, default='')
    minutes = models.PositiveIntegerField(default=0)   # flow-timer minutes
    photo = models.TextField(blank=True, default='')   # base64 data URL (small, client-resized)

    class Meta:
        unique_together = ('habit', 'date')
        ordering = ['-date']
