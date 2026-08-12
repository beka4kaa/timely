"""Расписание самостоятельного обучения: ритм → даты → конкретный урок.

Граница домена (почему отдельный app, а не расширение существующих):

* `curriculum` владеет ответом на вопрос «чему и в каком порядке учиться».
  Его собственный docstring фиксирует: «Планировщик и tutor остаются
  потребителями». Календарь — потребитель программы, а не её часть.
* `planner` (`DayPlan`/`Block`/`ScheduleSlot`) — прежний планировщик дня со
  строковыми первичными ключами, временем в `CharField` и без часовых поясов.
  Он остаётся работать как есть; строить поверх него расписание с датами в UTC
  и переходами на летнее время означало бы либо ломать его API, либо держать
  две схемы в одном модуле.
* `diary` — школьный дневник. Занятое время сюда НЕ импортируется: ученик
  объявляет его сам (`FixedCommitment`), руками или фразой в чате.

Изоляция пользователя через `user_email`, как в `curriculum`, `mind`, `habits`
и `nutrition` (см. `config.middleware.UserEmailMiddleware`).

**Время.** `TIME_ZONE = "UTC"` и `USE_TZ = True`, поэтому все `DateTimeField`
хранят UTC. Но ритм задан ЛОКАЛЬНЫМ временем: «17:00 по вторникам» обязано
остаться 17:00 и после перевода часов. Поэтому шаблон хранит `TimeField` без
даты, а конкретные моменты считаются как (локальная дата + локальное время) в
зоне расписания — см. `scheduling/slots.py`.
"""

from __future__ import annotations

import uuid

from django.db import models

# Версия алгоритма размещения. Меняется, когда одинаковый вход начинает давать
# другой календарь: по ней отличают расписания, построенные разными версиями
# движка, и решают, нужно ли предлагать перестройку.
SCHEDULING_VERSION = "1.0.0"


class TimestampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class ActivityType(models.TextChoices):
    """Чем ученик занят в блоке. Определяет и педагогику, и рабочую среду."""

    THEORY = "theory", "Теория"
    GUIDED_EXAMPLE = "guided_example", "Разбор примера"
    GUIDED_PRACTICE = "guided_practice", "Практика с подсказками"
    INDEPENDENT_PRACTICE = "independent_practice", "Самостоятельная практика"
    HOMEWORK = "homework", "Домашняя работа"
    REVIEW = "review", "Повторение"
    ASSESSMENT = "assessment", "Проверка"
    PROJECT = "project", "Проект"
    READING = "reading", "Чтение"
    CODING = "coding", "Программирование"
    HANDWRITTEN_PROBLEM = "handwritten_problem", "Задача на бумаге"
    OFFLINE_ACTIVITY = "offline_activity", "Занятие вне приложения"


class WorkspaceType(models.TextChoices):
    """Куда открывается блок. Выводится из `activity_type`, но хранится явно:
    ученик вправе решать задачу на бумаге там, где мы предложили форму ответа.
    """

    TUTOR_CHAT = "tutor_chat", "Чат с тьютором"
    SMART_BOARD = "smart_board", "Научная доска"
    PAPER_NOTEBOOK = "paper_notebook", "Тетрадь"
    ANSWER_FORM = "answer_form", "Форма ответа"
    BUILT_IN_CODE_EDITOR = "built_in_code_editor", "Встроенный редактор кода"
    EXTERNAL_IDE = "external_ide", "Внешняя среда разработки"
    BOOK_READER = "book_reader", "Читалка книги"
    QUIZ = "quiz", "Опрос"
    VOICE = "voice", "Голос"
    OFFLINE = "offline", "Вне приложения"
    PROJECT_WORKSPACE = "project_workspace", "Рабочее пространство проекта"


# Значение по умолчанию для `allowed_activity_types` пустого слота: пустой
# список означает «любой тип», а не «никакой». Так шаблон, созданный без
# уточнений, не блокирует размещение целиком.
def default_activity_types() -> list:
    return []


# ─────────────────────── Недельный ритм и занятое время ──────────────────────


class WeeklyScheduleTemplate(TimestampedModel):
    """Устойчивый повторяющийся ритм недели.

    Меняется редко и осознанно. Именно его стабильность отличает расписание от
    списка задач: тема и задание меняются каждую неделю, а «вторник и четверг в
    17:00 по 45 минут» — нет.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_email = models.EmailField(db_index=True)
    title = models.CharField(max_length=200, default="Мой ритм")

    # IANA-зона («Europe/Moscow»). Персонального поля часового пояса в проекте
    # нет, а без зоны локальное время шаблона не превратить в момент времени.
    timezone = models.CharField(max_length=64, default="UTC")

    active = models.BooleanField(default=True, db_index=True)
    valid_from = models.DateField(null=True, blank=True)
    valid_until = models.DateField(null=True, blank=True)

    # Потолки нагрузки. Ноль означает «без ограничения»: отсутствие лимита —
    # это состояние, а не ошибка, и отдельный `null` для него избыточен.
    max_minutes_per_day = models.PositiveIntegerField(default=0)
    max_minutes_per_week = models.PositiveIntegerField(default=0)

    created_by = models.CharField(max_length=32, default="student")

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user_email", "active"])]

    def __str__(self) -> str:
        return f"{self.user_email} — {self.title}"


class TemplateSlot(models.Model):
    """Одно повторяющееся окно недели.

    `weekday` целым числом (0 = понедельник, как у `date.weekday()`) и
    `start_time` типом `TimeField` — сознательное расхождение с
    `diary.TemplateLesson`, где лежат `"monday"` и `"08:00"`. Планировщику нужна
    арифметика, а не готовая к показу строка.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    template = models.ForeignKey(
        WeeklyScheduleTemplate, on_delete=models.CASCADE, related_name="slots"
    )
    weekday = models.PositiveSmallIntegerField()
    start_time = models.TimeField()
    duration_minutes = models.PositiveIntegerField()

    # Какие типы занятий допустимы в этом окне. Пустой список — любые.
    allowed_activity_types = models.JSONField(
        default=default_activity_types, blank=True
    )

    # Предмет, за которым закреплено окно. Пусто — окно общее.
    subject_id = models.CharField(max_length=64, blank=True, default="")

    # Окно, которое движок не имеет права занять учебным блоком: ученик держит
    # его под что-то своё, но хочет видеть в ритме.
    fixed = models.BooleanField(default=False)

    # Чем выше, тем раньше окно занимают. Буфер, наоборот, съедает окна с
    # наименьшим приоритетом — план должен быть устойчивым, а не плотным.
    priority = models.IntegerField(default=0)

    class Meta:
        ordering = ["weekday", "start_time"]
        indexes = [models.Index(fields=["template", "weekday"])]

    def __str__(self) -> str:
        return f"{self.weekday} {self.start_time} +{self.duration_minutes}м"


class FixedCommitment(TimestampedModel):
    """Занятое время, которое движок обязан обойти и не имеет права двигать.

    Школа, репетитор, экзамен, семейное событие. Источник — сам ученик: либо
    руками, либо фразой в чат-панели («со 2 сентября по будням с 8:00 до 14:00
    школа»), которую разбирает schedule-tool. Расписание из `diary` сюда НЕ
    импортируется: дневник заполняется не всеми и не всегда, а молча
    пропущенный там урок означал бы учебный блок поверх школы.

    Задаётся ОДНИМ из двух способов:

    * повторяющееся — `weekday` + `start_time` + `duration_minutes`, с
      необязательным сроком действия;
    * разовое — `start_at` / `end_at` в UTC.

    Проверку взаимоисключения делает `clean()`, а не БД: условие «ровно один из
    двух наборов заполнен» выражается через CheckConstraint громоздко и
    по-разному на разных СУБД, а строки сюда попадают только через сериализатор.
    """

    class Kind(models.TextChoices):
        SCHOOL = "school", "Школа"
        TUTOR = "tutor", "Репетитор"
        EXAM = "exam", "Экзамен"
        FAMILY = "family", "Семейное событие"
        OTHER = "other", "Другое"

    class Source(models.TextChoices):
        MANUAL = "manual", "Задано вручную"
        CHAT = "chat", "Разобрано из сообщения"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_email = models.EmailField(db_index=True)
    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.OTHER)
    title = models.CharField(max_length=200)

    # Повторяющаяся форма.
    weekday = models.PositiveSmallIntegerField(null=True, blank=True)
    start_time = models.TimeField(null=True, blank=True)
    duration_minutes = models.PositiveIntegerField(default=0)
    valid_from = models.DateField(null=True, blank=True)
    valid_until = models.DateField(null=True, blank=True)

    # Разовая форма.
    start_at = models.DateTimeField(null=True, blank=True)
    end_at = models.DateTimeField(null=True, blank=True)

    source = models.CharField(
        max_length=16, choices=Source.choices, default=Source.MANUAL
    )
    # Исходная фраза ученика. Хранится, чтобы он видел, из чего мы сделали блок,
    # и мог исправить нас, а не удалять и заводить заново.
    source_text = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["weekday", "start_time", "start_at"]
        indexes = [
            models.Index(fields=["user_email", "weekday"]),
            models.Index(fields=["user_email", "start_at"]),
        ]

    @property
    def is_recurring(self) -> bool:
        return self.weekday is not None and self.start_time is not None

    def clean(self):
        from django.core.exceptions import ValidationError

        recurring = self.weekday is not None or self.start_time is not None
        one_off = self.start_at is not None or self.end_at is not None
        if recurring and one_off:
            raise ValidationError(
                "Занятость задаётся либо повторяющейся, либо разовой, но не обеими."
            )
        if not recurring and not one_off:
            raise ValidationError("Не задано ни повторение, ни конкретная дата.")
        if recurring and (self.weekday is None or self.start_time is None):
            raise ValidationError("У повторяющейся занятости нужны день недели и время.")
        if recurring and self.duration_minutes <= 0:
            raise ValidationError("Длительность повторяющейся занятости должна быть больше нуля.")
        if one_off and (self.start_at is None or self.end_at is None):
            raise ValidationError("У разовой занятости нужны начало и конец.")
        if one_off and self.end_at <= self.start_at:
            raise ValidationError("Конец занятости должен быть позже начала.")

    def __str__(self) -> str:
        return f"{self.title} ({self.get_kind_display()})"


# ───────────────────────────── Расписание курса ──────────────────────────────


class StudySchedule(TimestampedModel):
    """Календарь одной программы на конкретный период.

    `version` растёт при каждом подтверждённом изменении и служит токеном
    оптимистичной блокировки: ревизия, построенная от устаревшей версии, будет
    отклонена, а не применена поверх чужих правок.
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "Черновик"
        PROPOSED = "proposed", "Предложено"
        CONFIRMED = "confirmed", "Подтверждено"
        ACTIVE = "active", "Активно"
        COMPLETED = "completed", "Завершено"
        ARCHIVED = "archived", "В архиве"

    # Один общий календарь показывает текущую рабочую версию каждого курса.
    # Завершённые и архивные версии остаются в истории, но не занимают время
    # нового плана и не попадают в обычную календарную ленту.
    CALENDAR_STATUSES = (
        Status.DRAFT,
        Status.PROPOSED,
        Status.CONFIRMED,
        Status.ACTIVE,
    )

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_email = models.EmailField(db_index=True)
    course_plan = models.ForeignKey(
        "curriculum.CoursePlan", on_delete=models.CASCADE, related_name="schedules"
    )
    template = models.ForeignKey(
        WeeklyScheduleTemplate,
        on_delete=models.PROTECT,
        related_name="schedules",
    )

    start_date = models.DateField()
    end_date = models.DateField()
    # Копия зоны шаблона на момент построения: смена зоны в шаблоне не должна
    # задним числом сдвигать уже показанный ученику календарь.
    timezone = models.CharField(max_length=64, default="UTC")

    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.DRAFT, db_index=True
    )
    version = models.PositiveIntegerField(default=1)
    generation_source = models.CharField(max_length=32, default="deterministic")
    scheduling_version = models.CharField(max_length=16, default=SCHEDULING_VERSION)

    # Из чего собран календарь: недельный шаблон, разбивка тем на части,
    # буфер. Нужен, чтобы объяснить ученику решение и чтобы перестройка
    # повторяла те же входные данные.
    pacing_snapshot = models.JSONField(default=dict, blank=True)
    # Пусто у выполнимого расписания. Непустое означает, что часть программы не
    # поместилась, и ученику показывают варианты, а не урезанный план.
    conflict_report = models.JSONField(default=dict, blank=True)
    warnings = models.JSONField(default=list, blank=True)

    confirmed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user_email", "status"]),
            models.Index(fields=["course_plan", "status"]),
        ]

    @property
    def feasible(self) -> bool:
        return not self.conflict_report

    @property
    def setup_restartable(self) -> bool:
        """An unconfirmed /start proposal may be replaced by another /start."""
        snapshot = self.pacing_snapshot if isinstance(self.pacing_snapshot, dict) else {}
        setup_snapshot = snapshot.get("schedule_setup")
        return (
            self.status in {self.Status.DRAFT, self.Status.PROPOSED}
            and isinstance(setup_snapshot, dict)
            and bool(setup_snapshot.get("nonce"))
        )

    def __str__(self) -> str:
        return f"{self.user_email}: {self.start_date}–{self.end_date}"


class LearningBlock(TimestampedModel):
    """Один урок в календаре.

    `topic` уходит в NULL при удалении темы, а не уносит блок каскадом:
    перестройка программы не должна молча стирать историю календаря — по ней
    считается посещаемость и стабильность расписания.
    """

    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Запланирован"
        READY = "ready", "Готов к началу"
        IN_PROGRESS = "in_progress", "Идёт"
        PAUSED = "paused", "Пауза"
        COMPLETED = "completed", "Завершён"
        PARTIALLY_COMPLETED = "partially_completed", "Завершён частично"
        MISSED = "missed", "Пропущен"
        SKIPPED = "skipped", "Пропущен намеренно"
        RESCHEDULED = "rescheduled", "Перенесён"
        CANCELLED = "cancelled", "Отменён"

    class DetailLevel(models.TextChoices):
        # Дата, тема, тип и длительность известны — задания ещё нет.
        OUTLINE = "outline", "Контур"
        # Есть `lesson_payload`: что читать, что разобрать, что решить.
        DETAILED = "detailed", "Подробно"

    class Source(models.TextChoices):
        SCHEDULER = "scheduler", "Планировщик"
        REVIEW = "review", "Повторение"
        MANUAL = "manual", "Вручную"
        RECOVERY = "recovery", "Восстановление пропуска"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_email = models.EmailField(db_index=True)
    schedule = models.ForeignKey(
        StudySchedule, on_delete=models.CASCADE, related_name="blocks"
    )
    course_plan = models.ForeignKey(
        "curriculum.CoursePlan",
        on_delete=models.CASCADE,
        related_name="learning_blocks",
    )
    module = models.ForeignKey(
        "curriculum.CourseModule",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="learning_blocks",
    )
    topic = models.ForeignKey(
        "curriculum.CourseTopic",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="learning_blocks",
    )
    subject_id = models.CharField(max_length=64, blank=True, default="")

    title = models.CharField(max_length=300)
    objective = models.TextField(blank=True, default="")
    activity_type = models.CharField(
        max_length=24, choices=ActivityType.choices, default=ActivityType.THEORY
    )
    workspace_type = models.CharField(
        max_length=24, choices=WorkspaceType.choices, default=WorkspaceType.TUTOR_CHAT
    )

    # UTC. Локальное время восстанавливается через `schedule.timezone`.
    start_at = models.DateTimeField(db_index=True)
    end_at = models.DateTimeField()
    duration_minutes = models.PositiveIntegerField()

    # Закреплённый блок движок не двигает никогда — ни при перепланировании, ни
    # по просьбе модели.
    fixed = models.BooleanField(default=False)
    # Окно гибкости: раньше/позже этих границ блок ставить нельзя.
    earliest_start = models.DateTimeField(null=True, blank=True)
    latest_end = models.DateTimeField(null=True, blank=True)
    allowed_weekdays = models.JSONField(default=list, blank=True)
    priority = models.IntegerField(default=0)

    status = models.CharField(
        max_length=24, choices=Status.choices, default=Status.SCHEDULED, db_index=True
    )
    detail_level = models.CharField(
        max_length=16, choices=DetailLevel.choices, default=DetailLevel.OUTLINE
    )
    source = models.CharField(
        max_length=16, choices=Source.choices, default=Source.SCHEDULER
    )

    lesson_payload = models.JSONField(default=dict, blank=True)
    mastery_criteria = models.TextField(blank=True, default="")
    source_section_ids = models.JSONField(default=list, blank=True)
    source_chunk_ids = models.JSONField(default=list, blank=True)
    prerequisite_block_ids = models.JSONField(default=list, blank=True)

    # Повторение ссылается на тему, которую повторяет, и на свой шаг (0/1/2 —
    # через 2, 7 и 21 день). Заполнено только у `activity_type = review`.
    review_of_topic = models.ForeignKey(
        "curriculum.CourseTopic",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="review_blocks",
    )
    review_step = models.PositiveSmallIntegerField(null=True, blank=True)

    rescheduled_from = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reschedules",
    )
    created_by = models.CharField(max_length=32, default="scheduler")
    version = models.PositiveIntegerField(default=1)

    class Meta:
        ordering = ["start_at"]
        indexes = [
            models.Index(fields=["schedule", "start_at"]),
            models.Index(fields=["user_email", "start_at"]),
            models.Index(fields=["user_email", "status"]),
            models.Index(fields=["schedule", "status"]),
        ]

    def __str__(self) -> str:
        return f"{self.start_at:%Y-%m-%d %H:%M} {self.title[:40]}"


class ScheduleRevision(TimestampedModel):
    """Предложенное изменение расписания и его diff.

    Ни AI, ни drag-and-drop не правят календарь напрямую: сначала ревизия,
    потом подтверждение. `inverse_diff` хранится рядом, потому что Undo
    применяет обратное изменение, а не восстанавливает снимок: снимок календаря
    на три месяца весит несопоставимо больше и затёр бы правки, сделанные
    после.
    """

    class Status(models.TextChoices):
        PROPOSED = "proposed", "Предложена"
        CONFIRMED = "confirmed", "Подтверждена"
        REJECTED = "rejected", "Отклонена"
        REVERTED = "reverted", "Отменена"
        EXPIRED = "expired", "Устарела"

    class RequestedBy(models.TextChoices):
        STUDENT = "student", "Ученик"
        AI = "ai", "AI"
        SYSTEM = "system", "Система"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_email = models.EmailField(db_index=True)
    schedule = models.ForeignKey(
        StudySchedule, on_delete=models.CASCADE, related_name="revisions"
    )
    base_version = models.PositiveIntegerField()
    proposed_version = models.PositiveIntegerField()
    requested_by = models.CharField(
        max_length=16, choices=RequestedBy.choices, default=RequestedBy.STUDENT
    )
    request_text = models.TextField(blank=True, default="")
    reason = models.CharField(max_length=300, blank=True, default="")
    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.PROPOSED, db_index=True
    )

    # {"moved": [], "created": [], "removed": [], "shortened": [], "extended": []}
    diff = models.JSONField(default=dict, blank=True)
    inverse_diff = models.JSONField(default=dict, blank=True)
    # Последствия, которые видит ученик до применения: сдвиг даты завершения,
    # рост нагрузки, задетые повторения.
    impact = models.JSONField(default=dict, blank=True)

    confirmed_at = models.DateTimeField(null=True, blank=True)
    reverted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["schedule", "status"]),
            models.Index(fields=["user_email", "-created_at"]),
        ]

    def __str__(self) -> str:
        return f"Ревизия {self.base_version}→{self.proposed_version} ({self.status})"


# ─────────────────────── Исполнение (пишется на Этапе 5) ─────────────────────


class BlockCheckIn(models.Model):
    """Короткий опрос перед блоком: сколько времени есть, сколько сил.

    Таблица заводится сразу вместе с остальными, чтобы не плодить волны
    миграций, но записывается только на этапе исполнения.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    block = models.ForeignKey(
        LearningBlock, on_delete=models.CASCADE, related_name="check_ins"
    )
    user_email = models.EmailField(db_index=True)
    available_minutes = models.PositiveIntegerField()
    # 1..5. Ноль означает «не спрашивали».
    energy_level = models.PositiveSmallIntegerField(default=0)
    stress_level = models.PositiveSmallIntegerField(default=0)
    has_urgent_task = models.BooleanField(default=False)
    note = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class LearningBlockResult(models.Model):
    """Чем закончился блок.

    НЕ дублирует `ai_engine.LearningEvent`: там учебное доказательство (что
    ученик умеет), здесь — факт исполнения расписания (начал ли вовремя, сколько
    отработал). Связь односторонняя: завершение блока дополнительно пишет
    `LearningEvent` через существующий `apply_learning_event`.
    """

    class Result(models.TextChoices):
        COMPLETED = "completed", "Завершён"
        PARTIAL = "partial", "Частично"
        FAILED = "failed", "Не получилось"
        ABANDONED = "abandoned", "Брошен"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    block = models.OneToOneField(
        LearningBlock, on_delete=models.CASCADE, related_name="result"
    )
    user_email = models.EmailField(db_index=True)

    notified_at = models.DateTimeField(null=True, blank=True)
    opened_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    actual_minutes = models.PositiveIntegerField(default=0)
    completion_percent = models.PositiveSmallIntegerField(default=0)
    completion_reason = models.CharField(max_length=64, blank=True, default="")

    result = models.CharField(
        max_length=16, choices=Result.choices, default=Result.COMPLETED
    )
    attempt_count = models.PositiveIntegerField(default=0)
    hint_count = models.PositiveIntegerField(default=0)
    mastery_result = models.CharField(max_length=32, blank=True, default="")
    error_types = models.JSONField(default=list, blank=True)
    focus_events = models.JSONField(default=list, blank=True)
    student_feedback = models.TextField(blank=True, default="")
    artifact_ids = models.JSONField(default=list, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user_email", "-created_at"])]
