from django.db import models
from django.contrib.auth.models import AbstractUser

class CustomUser(AbstractUser):
    COUNTRY_CHOICES = [
        ('KZ', 'Kazakhstan'),
        ('RU', 'Russia'),
        ('US', 'United States'),
        # Добавь другие коды стран по необходимости
    ]
    
    country_code = models.CharField(max_length=2, choices=COUNTRY_CHOICES, blank=True, null=True)
    city = models.CharField(max_length=255, blank=True, null=True)
    overall_elo = models.IntegerField(default=1200)
    contribution_points = models.IntegerField(default=0)

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
    author = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='created_tasks')
    discipline = models.ForeignKey(Discipline, on_delete=models.CASCADE, related_name='tasks')
    condition_text = models.TextField()
    author_solution_image = models.TextField()
    base_elo = models.IntegerField(default=1200)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')

    def __str__(self):
        return f"Task {self.id} by {self.author.username} ({self.status})"

class TaskSubmission(models.Model):
    STATUS_CHOICES = [
        ('under_review', 'Under Review'),
        ('correct', 'Correct'),
        ('incorrect', 'Incorrect'),
    ]
    student = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='submissions')
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='submissions')
    student_solution_image = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='under_review')
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Submission by {self.student.username} for Task {self.task.id}"

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
