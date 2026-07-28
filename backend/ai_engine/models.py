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


class AIUsageEvent(models.Model):
    """Immutable provider-usage ledger used for quotas and billing analytics."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_email = models.EmailField(blank=True, default="", db_index=True)
    provider = models.CharField(max_length=48, default="unknown")
    model_name = models.CharField(max_length=160)
    feature = models.CharField(max_length=80, default="unknown")
    request_id = models.CharField(max_length=160, blank=True, default="")
    input_tokens = models.PositiveBigIntegerField(default=0)
    cached_input_tokens = models.PositiveBigIntegerField(default=0)
    output_tokens = models.PositiveBigIntegerField(default=0)
    reasoning_tokens = models.PositiveBigIntegerField(default=0)
    total_tokens = models.PositiveBigIntegerField(default=0)
    image_count = models.PositiveIntegerField(default=0)
    billable_tokens = models.PositiveBigIntegerField(default=0)
    cost_usd = models.DecimalField(
        max_digits=14,
        decimal_places=8,
        null=True,
        blank=True,
    )
    is_estimated = models.BooleanField(default=False)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["user_email", "created_at"],
                name="ai_usage_user_created_idx",
            ),
            models.Index(
                fields=["model_name", "created_at"],
                name="ai_usage_model_created_idx",
            ),
            models.Index(
                fields=["feature", "created_at"],
                name="ai_usage_feat_created_idx",
            ),
        ]


class ChatSession(models.Model):
    """
    A saved AI Tutor conversation for the whiteboard.

    id is a client-generated UUID string (same convention as
    diary.WeeklyTemplate), so the frontend can create-then-PATCH the same
    session as the conversation grows without a round trip for the id first.
    `messages` stores the whole client-side message array as-is (same shape
    the frontend already sends as `history` to /api/ai/chat). `lesson_plan`
    is the LessonPlan object driving the conversation (topic/goal/tasks) —
    resuming a chat without it would leave sendMessage() unusable, since the
    frontend requires an active plan to send further messages. Whiteboard
    canvas/illustration content is intentionally out of scope for now.
    """
    id = models.CharField(primary_key=True, max_length=36)
    user_email = models.EmailField(db_index=True)
    title = models.CharField(max_length=255, blank=True, default="")
    topic = models.CharField(max_length=255, blank=True, default="")
    messages = models.JSONField(default=list)
    lesson_plan = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # ── Режим тьютора (PRODUCT.md §5.2) ──────────────────────────────────────
    # Сессия чата И ЕСТЬ учебная сессия, поэтому режим живёт здесь, а не в
    # отдельной модели: заводить параллельный TutorSession означало бы держать
    # две строки на один разговор и join ради каждого сообщения.
    #
    # Все поля пустые/нулевые по умолчанию — миграция аддитивная, а уже
    # сохранённые сессии продолжают открываться и вести себя как прежде
    # (пустой `mode` → tutor_modes.DEFAULT_MODE).
    #
    # Важно: `mode`, `help_profile` и `policy` заполняет СЕРВЕР, а не клиент.
    # `lesson_plan` рядом — клиентский, и это осознанная разница: план урока
    # ученик составляет сам, а права на подсказки — нет (§3.3).
    STATUS_CHOICES = [
        ("ACTIVE", "Active"),
        ("COMPLETED", "Completed"),
        ("ABANDONED", "Abandoned"),
    ]

    mode = models.CharField(max_length=32, blank=True, default="")
    help_profile = models.CharField(max_length=32, blank=True, default="")
    policy = models.JSONField(null=True, blank=True)
    goal = models.CharField(max_length=255, blank=True, default="")
    # Состояние лестницы помощи (§5.5) и счётчик самостоятельных попыток —
    # именно их читает help_policy.check_help_allowed.
    hint_level = models.PositiveIntegerField(default=0)
    attempt_count = models.PositiveIntegerField(default=0)
    # Связь с навыком. SET_NULL, а не CASCADE: удаление темы не должно уносить
    # разговор о ней.
    skill_topic = models.ForeignKey(
        Topic,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="tutor_sessions",
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="ACTIVE")

    class Meta:
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["user_email", "updated_at"]),
        ]

    def __str__(self):
        return f"{self.user_email} — {self.title or self.id}"


# ──────────────────────────────────────────────────────────────────────────────
# Типология ошибок (PRODUCT.md §6.8)
#
# Тип ошибки определяет следующую учебную интервенцию, поэтому это закрытый
# перечень, а не свободный текст: на «неверная формула» и «не знает
# prerequisite» система обязана реагировать по-разному. Модель тип ПРЕДЛАГАЕТ,
# backend сверяет его с этим списком (см. learning_events.normalize_error_type).
# ──────────────────────────────────────────────────────────────────────────────
ERROR_TYPE_CHOICES = [
    ("misread_problem", "Неверно понял условие"),
    ("wrong_formula", "Выбрал неверную формулу"),
    ("missing_prerequisite", "Не знает prerequisite"),
    ("arithmetic", "Арифметическая ошибка"),
    ("sign_error", "Ошибка знака"),
    ("units", "Потерял единицы измерения"),
    ("incomplete", "Правильный метод, но не завершил"),
    ("guessed", "Угадал"),
    ("copied", "Списал"),
    ("out_of_time", "Не уложился по времени"),
    ("unknown", "Не удалось определить"),
]

ERROR_TYPES = frozenset(value for value, _ in ERROR_TYPE_CHOICES)

RESULT_CHOICES = [
    ("correct", "Верно"),
    ("incorrect", "Неверно"),
    ("partial", "Частично"),
    ("skipped", "Пропущено"),
    ("abandoned", "Брошено"),
    ("completed", "Завершено"),
]

ACTIVITY_CHOICES = [
    ("explanation", "Объяснение"),
    ("task_attempt", "Попытка решения"),
    ("practice", "Практика"),
    ("review", "Повторение"),
    ("diagnostic", "Диагностика"),
    ("contest", "Контест"),
    ("hint", "Подсказка"),
]


class LearningEvent(models.Model):
    """Единый журнал учебных событий (PRODUCT.md §15.3).

    Из него строятся student state, аналитика и интервальные повторения, поэтому
    он append-only: ни один путь в коде не обновляет и не удаляет строки.
    Дисциплина и форма скопированы с `AIUsageEvent` выше — тот же принцип
    неизменяемого ledger'а с составными индексами и JSON-метаданными.

    Почему новая модель, а не существующие `mind.ReviewLog`/`mind.SrsReviewLog`:
    те не ссылаются на пользователя вовсе (журнал без владельца бесполезен для
    student state), привязаны к subtopic/review_set и, главное, за всю историю
    репозитория ни разу не записывались — `TopicViewSet.review` меняет `Topic`
    на месте. Не заводите четвёртый журнал: расширяйте этот.

    `skill_ref` дублирует название темы строкой намеренно: `topic` уходит в NULL
    при удалении темы, а событие обязано остаться читаемым — это история, а не
    проекция текущего состояния.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_email = models.EmailField(db_index=True)
    topic = models.ForeignKey(
        Topic,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="learning_events",
    )
    skill_ref = models.CharField(max_length=255, blank=True, default="")

    activity = models.CharField(max_length=32, choices=ACTIVITY_CHOICES, default="explanation")
    mode = models.CharField(max_length=32, blank=True, default="")
    task_ref = models.CharField(max_length=255, blank=True, default="")
    result = models.CharField(max_length=20, choices=RESULT_CHOICES, default="completed")

    attempt_count = models.PositiveIntegerField(default=0)
    hint_level = models.PositiveIntegerField(default=0)
    duration_seconds = models.PositiveIntegerField(default=0)
    error_type = models.CharField(
        max_length=32, choices=ERROR_TYPE_CHOICES, blank=True, default=""
    )

    # Метакогнитивная калибровка (§6.9): сравнение уверенности до и после
    # показывает переоценку своих знаний. 0..1, NULL — ученика не спрашивали.
    confidence_before = models.FloatField(null=True, blank=True)
    confidence_after = models.FloatField(null=True, blank=True)

    source = models.CharField(max_length=64, blank=True, default="")
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user_email", "created_at"], name="learn_evt_user_created_idx"),
            models.Index(fields=["user_email", "topic"], name="learn_evt_user_topic_idx"),
            models.Index(fields=["mode", "created_at"], name="learn_evt_mode_created_idx"),
        ]

    def __str__(self):
        return f"{self.user_email} — {self.activity}/{self.result} ({self.skill_ref or '—'})"


class SkillState(models.Model):
    """Student state v1 — состояние одного навыка у одного ученика (§6.1).

    Производная величина: источник истины — `LearningEvent`, а эта таблица лишь
    кэширует пересчёт (`learning_events.recompute_skill_state`), чтобы не
    агрегировать журнал на каждый запрос. Поэтому её всегда можно построить
    заново из событий, и любое расхождение решается пересчётом, а не правкой
    строки руками.

    Сознательно НЕ заменяет SRS-поля на `mind.Topic` (`status`, `ease_factor`,
    `next_review_at`): от них зависят страница слабых тем и `TopicViewSet.review`.
    Сведение двух представлений (и мёртвого `mind.SrsState.mastery`, у которого
    нет ни пользователя, ни маршрута) — отдельная задача, не Этап 1.
    """

    # Пять состояний, которые видит ученик (§6.1). Внутренние числа —
    # mastery_probability и confidence — наружу не показываются.
    STATUS_CHOICES = [
        ("NOT_STARTED", "Не начато"),
        ("LEARNING", "Изучаю"),
        ("NEEDS_PRACTICE", "Нужна практика"),
        ("MASTERED", "Усвоено"),
        ("DUE_REVIEW", "Пора повторить"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_email = models.EmailField(db_index=True)
    # CASCADE здесь уместен, в отличие от LearningEvent: это не история, а
    # текущее состояние, и без темы оно смысла не имеет.
    topic = models.ForeignKey(Topic, on_delete=models.CASCADE, related_name="skill_states")

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="NOT_STARTED")
    mastery_probability = models.FloatField(default=0.0)
    confidence = models.FloatField(default=0.0)

    last_practiced_at = models.DateTimeField(null=True, blank=True)
    next_review_at = models.DateTimeField(null=True, blank=True)

    success_count = models.PositiveIntegerField(default=0)
    fail_count = models.PositiveIntegerField(default=0)
    hint_count = models.PositiveIntegerField(default=0)
    avg_hint_level = models.FloatField(default=0.0)
    evidence_count = models.PositiveIntegerField(default=0)

    # {error_type: сколько раз} — по нему видно системную ошибку, а не разовую.
    common_errors = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("user_email", "topic")
        indexes = [
            models.Index(fields=["user_email", "status"], name="skill_state_user_status_idx"),
            models.Index(fields=["user_email", "next_review_at"], name="skill_state_user_due_idx"),
        ]

    def __str__(self):
        return f"{self.user_email} — {self.topic_id}: {self.status}"
