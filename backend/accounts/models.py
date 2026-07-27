from django.db import models
from django.contrib.auth.models import AbstractUser

class CustomUser(AbstractUser):
    AI_PLAN_CHOICES = [
        ('free', 'Free'),
        ('pro', 'Pro'),
        ('max', 'Max'),
    ]
    COUNTRY_CHOICES = [
        ('KZ', 'Kazakhstan'),
        ('RU', 'Russia'),
        ('US', 'United States'),
        # Добавь другие коды стран по необходимости
    ]
    
    country_code = models.CharField(max_length=2, choices=COUNTRY_CHOICES, blank=True, null=True)
    city = models.CharField(max_length=255, blank=True, null=True)
    overall_elo = models.IntegerField(default=1200)          # global rating (drives the global leaderboard)
    contribution_points = models.IntegerField(default=0)
    # Moderators can review/approve submissions alongside is_staff admins.
    # (An AI auto-reviewer can be wired in later as another approver — not yet.)
    is_moderator = models.BooleanField(default=False)
    has_full_access = models.BooleanField(default=False, db_index=True)
    ai_plan = models.CharField(
        max_length=12,
        choices=AI_PLAN_CHOICES,
        default='free',
        db_index=True,
    )

class Discipline(models.Model):
    name = models.CharField(max_length=255)
    parent = models.ForeignKey(
        'self', 
        on_delete=models.CASCADE, 
        null=True, 
        blank=True, 
        related_name='sub_disciplines'
    )

    def __str__(self):
        return self.name

class UserRating(models.Model):
    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='ratings')
    discipline = models.ForeignKey(Discipline, on_delete=models.CASCADE, related_name='user_ratings')
    elo_score = models.IntegerField(default=1200)
    tier_level = models.CharField(max_length=10, default='LT5')

    class Meta:
        unique_together = ('user', 'discipline')

    def __str__(self):
        return f"{self.user.username} - {self.discipline.name}: {self.elo_score}"

class Task(models.Model):
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('active', 'Active'),
        ('rejected', 'Rejected'),
    ]
    DIFFICULTY_CHOICES = [
        ('easy', 'Easy'),
        ('medium', 'Medium'),
        ('hard', 'Hard'),
    ]
    author = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='created_tasks')
    # Optional: contest/admin tasks aren't tied to a peer-review discipline.
    discipline = models.ForeignKey(Discipline, on_delete=models.CASCADE, related_name='tasks', null=True, blank=True)
    title = models.CharField(max_length=512, blank=True, default='')
    condition_text = models.TextField(blank=True, default='')             # problem statement / description (markdown)
    author_solution_image = models.TextField(blank=True, default='')
    difficulty = models.CharField(max_length=10, choices=DIFFICULTY_CHOICES, default='medium')
    points = models.IntegerField(default=100)                             # rating awarded to the user on approval
    base_elo = models.IntegerField(default=1200)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True, null=True)

    def __str__(self):
        return f"Task {self.id} ({self.title or self.status})"

class TaskSubmission(models.Model):
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ]
    student = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='submissions')
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='submissions')
    student_solution_image = models.TextField(blank=True, default='')
    file_url_or_code = models.TextField(blank=True, default='')           # code snippet, GitHub link, or uploaded file URL
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    reviewed_by = models.ForeignKey(
        CustomUser, on_delete=models.SET_NULL, null=True, blank=True, related_name='reviewed_submissions',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Submission by {self.student.username} for Task {self.task.id} ({self.status})"

class ReviewVote(models.Model):
    VOTE_CHOICES = [
        ('correct', 'Correct'),
        ('incorrect', 'Incorrect'),
        ('spam', 'Spam'),
    ]
    submission = models.ForeignKey(TaskSubmission, on_delete=models.CASCADE, related_name='review_votes')
    reviewer = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='given_reviews')
    vote = models.CharField(max_length=20, choices=VOTE_CHOICES, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Review by {self.reviewer.username} on Sub {self.submission.id}: {self.vote}"


class Contest(models.Model):
    """A timed contest bundling a set of tasks (LeetCode-style)."""
    title       = models.CharField(max_length=512)
    description = models.TextField(blank=True, default='')
    start_time  = models.DateTimeField()
    end_time    = models.DateTimeField()
    tasks       = models.ManyToManyField(Task, related_name='contests', blank=True)
    created_by  = models.ForeignKey(
        CustomUser, on_delete=models.SET_NULL, null=True, blank=True, related_name='created_contests',
    )
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-start_time']

    def __str__(self):
        return self.title


class PrivateLeaderboard(models.Model):
    """A user-owned leaderboard scoped to an invited set of members."""
    name       = models.CharField(max_length=255)
    owner      = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='owned_leaderboards')
    members    = models.ManyToManyField(CustomUser, related_name='private_leaderboards', blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.name} (owner: {self.owner.username})"
