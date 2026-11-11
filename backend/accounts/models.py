from django.db import models
from django.db.models import Q
from django.contrib.auth.models import AbstractUser
from django.utils.crypto import get_random_string

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
    # Разделы открыты по умолчанию, а флаг служит для того, чтобы ЗАКРЫТЬ их
    # конкретному человеку. Раньше умолчание было обратным, и любой заведённый
    # в Django аккаунт упирался в `FullAccessGate`, пока админ не выдаст доступ
    # руками.
    has_full_access = models.BooleanField(default=True, db_index=True)
    ai_plan = models.CharField(
        max_length=12,
        choices=AI_PLAN_CHOICES,
        default='free',
        db_index=True,
    )
    # «О себе» из профиля. Видит только сам ученик: в рейтинге и поиске этого поля нет.
    bio = models.CharField(max_length=280, blank=True, default='')
    # Согласие показываться другим в рейтинге и поиске. Ученики несовершеннолетние,
    # поэтому новый аккаунт скрыт, пока сам не включит показ. Себя ученик видит всегда.
    show_in_leaderboard = models.BooleanField(default=False)

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

class ContestFile(models.Model):
    """PDF условия или решения задачи контеста.

    Лежит в базе, а не на диске: диск контейнера пропадает при каждой выкладке,
    а внешнего хранилища нет. Файлы маленькие и редкие, отдаются только через API
    с проверкой прав. Содержимое не читается в списках.
    """
    data = models.BinaryField()
    name = models.CharField(max_length=180)
    size = models.PositiveIntegerField()
    pages = models.PositiveSmallIntegerField(default=0)
    sha256 = models.CharField(max_length=64)
    # Текст из PDF нужен только для разбора с тьютором после конца контеста.
    text = models.TextField(blank=True, default='')
    uploaded_by = models.ForeignKey(
        CustomUser, on_delete=models.SET_NULL, null=True, blank=True, related_name='contest_files',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.size} байт)"


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
    # Порядок задачи в контесте: номер задачи у ученика.
    position = models.PositiveSmallIntegerField(default=0)
    # Правильный ответ, варианты через «;». Ученику уходит только после конца контеста.
    answer = models.CharField(max_length=300, blank=True, default='')
    statement_file = models.ForeignKey(
        ContestFile, on_delete=models.SET_NULL, null=True, blank=True, related_name='+',
    )
    solution_file = models.ForeignKey(
        ContestFile, on_delete=models.SET_NULL, null=True, blank=True, related_name='+',
    )

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
    # Ответ, отправленный в контесте. У старых ответов вне контеста пусто.
    contest = models.ForeignKey(
        'Contest', on_delete=models.SET_NULL, null=True, blank=True, related_name='submissions',
    )

    class Meta:
        constraints = [
            # Баллы за задачу контеста начисляются один раз: держит база, а не код.
            models.UniqueConstraint(
                fields=['student', 'task', 'contest'],
                condition=Q(status='approved') & Q(contest__isnull=False),
                name='one_accepted_answer_per_contest_task',
            ),
        ]
        indexes = [models.Index(fields=['contest', 'created_at'], name='submission_contest_time')]

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
    TIER_CHOICES = [(1, 'Аметист'), (2, 'Алмаз'), (3, 'Золото'), (4, 'Серебро'), (5, 'Бронза')]

    title       = models.CharField(max_length=512)
    description = models.TextField(blank=True, default='')
    start_time  = models.DateTimeField()
    end_time    = models.DateTimeField()
    tasks       = models.ManyToManyField(Task, related_name='contests', blank=True)
    created_by  = models.ForeignKey(
        CustomUser, on_delete=models.SET_NULL, null=True, blank=True, related_name='created_contests',
    )
    created_at  = models.DateTimeField(auto_now_add=True)
    # Тир задаёт потолок баллов и цвет плашки, рисунок выбирает админ.
    tier         = models.PositiveSmallIntegerField(default=5, choices=TIER_CHOICES)
    art          = models.CharField(max_length=20, default='rings')
    # Черновик видит только админка.
    is_published = models.BooleanField(default=False, db_index=True)

    class Meta:
        ordering = ['-start_time']

    def __str__(self):
        return self.title


# Код набирают и на русской раскладке, поэтому здесь нет букв с кириллическими двойниками
# (A и А не отличить на глаз), а заодно 0, O, 1 и I.
INVITE_CODE_ALPHABET = 'DFGJLNQRSUVWZ23456789'
INVITE_CODE_LENGTH = 10


def new_invite_code():
    return get_random_string(INVITE_CODE_LENGTH, INVITE_CODE_ALPHABET)


class PrivateLeaderboard(models.Model):
    """A user-owned leaderboard. Everyone in it joined on their own, with the code."""
    name       = models.CharField(max_length=255)
    owner      = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name='owned_leaderboards')
    members    = models.ManyToManyField(CustomUser, related_name='private_leaderboards', blank=True)
    # Добавить другого человека нельзя: он вступает сам, по коду. Код видит только создатель.
    invite_code = models.CharField(max_length=INVITE_CODE_LENGTH, unique=True, default=new_invite_code, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.name} (owner: {self.owner.username})"
