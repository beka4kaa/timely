"""Доменные модели учебного цикла: цель → источник → структура → программа.

Границы домена (почему отдельный app, а не расширение существующих):

* `mind.Subject/Topic` — это личные предметы и SRS-темы ученика. Учебная цель
  («хочу решать задачи по механике») к ним привязывается, но не сводится: она
  живёт до того, как предмет вообще выбран, и может ссылаться на направление,
  которого в `mind` нет.
* `ai_engine.LearningProgram/TopicPlan` — существующий AI-планировщик поверх
  уже заведённых предметов, без источника-книги, без версионирования и без
  provenance. Достраивать его до книжного курса означало бы сломать текущие
  страницы программы.
* `planner` — исполнение расписания (дни, блоки, слоты). Курс — это вход для
  планировщика, а не его часть.

Поэтому граница проходит здесь: `curriculum` владеет целью, документом,
извлечённой структурой, чанками и программой. Планировщик и tutor остаются
потребителями.

Изоляция пользователя везде через `user_email` (конвенция проекта, см.
`config.middleware.UserEmailMiddleware`), а не через FK на `accounts.CustomUser`:
так же сделаны `habits`, `nutrition` и `mind`.
"""

from __future__ import annotations

import uuid

from django.db import models
from pgvector.django import VectorField

# Размерность эмбеддинга. Константа, а НЕ переменная окружения: она попадает в
# миграцию (`vector(1536)`), и вычислять её из окружения значило бы получать
# разную схему на разных машинах. Смена размерности — это отдельная миграция
# плюс переиндексация всех чанков, а не правка конфига.
#
# 1536 — размерность `text-embedding-3-small` и совместимых. Модель с другой
# размерностью подключать нельзя, пока не сделана миграция: провайдер это
# проверяет и отказывается писать вектор не той длины.
EMBEDDING_DIMENSIONS = 1536

# Версия обработки. Меняется при любом изменении алгоритмов извлечения или
# чанкинга: по ней отличают данные, построенные разными версиями пайплайна, и
# решают, нужно ли переиндексировать документ.
# 1.1.0 — настоящий токенайзер (cl100k_base) вместо эвристики и overlap между
# соседними фрагментами прозы. И то и другое меняет границы фрагментов, а
# значит и `content_hash`, поэтому версия обязана вырасти: иначе переиндексация
# молча переиспользовала бы старые фрагменты под новыми правилами.
PROCESSING_VERSION = "1.1.0"

# Версия схемы обмена с моделью-планировщиком. Отдельна от PROCESSING_VERSION:
# промпт может измениться без переобработки книг.
PLANNING_SCHEMA_VERSION = "1.0.0"


class TimestampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


# ─────────────────────────── PHASE 1. Учебная цель ───────────────────────────


class LearningGoal(TimestampedModel):
    """Что ученик хочет изучить, до того как выбран источник.

    `original_text` НИКОГДА не перезаписывается нормализацией: если модель
    ошиблась в разборе «профильная математика ЕГЭ», ученик должен видеть свою
    формулировку и иметь возможность исправить нашу. Все AI-поля
    (`normalized_*`, `*_confidence`) считаются предложением до тех пор, пока
    `normalization_confirmed` не выставлен самим учеником.
    """

    class GoalType(models.TextChoices):
        SKILL = "skill", "Навык"
        EXAM = "exam", "Экзамен"
        COURSE = "course", "Курс целиком"
        TOPIC = "topic", "Отдельная тема"
        LANGUAGE = "language", "Язык"

    class Level(models.TextChoices):
        NONE = "none", "С нуля"
        BEGINNER = "beginner", "Начальный"
        SCHOOL_BASIC = "school_basic", "Школьный базовый"
        SCHOOL_CONFIDENT = "school_confident", "Школьный уверенный"
        ADVANCED = "advanced", "Продвинутый"
        UNIVERSITY = "university", "Университетский"

    class Balance(models.TextChoices):
        THEORY = "theory", "Больше теории"
        BALANCED = "balanced", "Поровну"
        PRACTICE = "practice", "Больше практики"

    class Status(models.TextChoices):
        DRAFT = "draft", "Черновик"
        CONFIRMED = "confirmed", "Подтверждена"
        ARCHIVED = "archived", "В архиве"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_email = models.EmailField(db_index=True)

    # Исходная формулировка ученика — источник истины для UI.
    original_text = models.TextField()

    # Результат нормализации. Пусто, пока модель не отработала.
    normalized_subject = models.CharField(max_length=160, blank=True, default="")
    normalized_direction = models.CharField(max_length=160, blank=True, default="")
    normalization_confidence = models.FloatField(null=True, blank=True)
    normalization_confirmed = models.BooleanField(default=False)
    normalization_model = models.CharField(max_length=160, blank=True, default="")
    normalization_prompt_version = models.CharField(max_length=32, blank=True, default="")

    # Привязка к существующему домену — необязательная и мягкая.
    subject = models.ForeignKey(
        "mind.Subject",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="learning_goals",
    )
    topic = models.ForeignKey(
        "mind.Topic",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="learning_goals",
    )

    goal_type = models.CharField(
        max_length=16, choices=GoalType.choices, default=GoalType.SKILL
    )
    current_level = models.CharField(
        max_length=24, choices=Level.choices, default=Level.BEGINNER
    )
    target_level = models.CharField(
        max_length=24, choices=Level.choices, default=Level.SCHOOL_CONFIDENT
    )
    preferred_language = models.CharField(max_length=8, default="ru")
    source_language_preferences = models.JSONField(default=list, blank=True)
    theory_practice_balance = models.CharField(
        max_length=16, choices=Balance.choices, default=Balance.BALANCED
    )
    access_preference = models.CharField(max_length=32, default="any")
    desired_finish_date = models.DateField(null=True, blank=True)

    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.DRAFT, db_index=True
    )

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user_email", "-created_at"])]

    def __str__(self) -> str:
        return f"{self.user_email}: {self.original_text[:60]}"


# ───────────────────── PHASE 2. Кандидаты-книги (рекомендации) ─────────────────


class BookCandidate(TimestampedModel):
    """Книга, предложенная рекомендательным провайдером.

    Библиографические факты (ISBN, год, издание) хранятся ТОЛЬКО с признаком
    подтверждения. Модель регулярно выдумывает правдоподобный ISBN, поэтому
    неподтверждённое значение обязано оставаться неподтверждённым: см.
    `isbn_verified` и `citations`.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    goal = models.ForeignKey(
        LearningGoal, on_delete=models.CASCADE, related_name="book_candidates"
    )
    user_email = models.EmailField(db_index=True)

    title = models.CharField(max_length=400)
    authors = models.JSONField(default=list, blank=True)
    isbn = models.CharField(max_length=32, blank=True, default="")
    isbn_verified = models.BooleanField(default=False)
    edition = models.CharField(max_length=120, blank=True, default="")
    year = models.PositiveIntegerField(null=True, blank=True)
    year_verified = models.BooleanField(default=False)
    publisher = models.CharField(max_length=200, blank=True, default="")
    language = models.CharField(max_length=8, default="ru")

    difficulty = models.CharField(max_length=32, blank=True, default="")
    description = models.TextField(blank=True, default="")
    coverage = models.JSONField(default=list, blank=True)
    prerequisites = models.JSONField(default=list, blank=True)

    theory_score = models.FloatField(null=True, blank=True)
    practice_score = models.FloatField(null=True, blank=True)
    goal_match_score = models.FloatField(null=True, blank=True)
    limitations = models.TextField(blank=True, default="")
    availability_note = models.TextField(blank=True, default="")

    # Каждый библиографический факт должен опираться на источник.
    citations = models.JSONField(default=list, blank=True)
    confidence = models.FloatField(null=True, blank=True)
    recommendation_rank = models.PositiveIntegerField(default=0)

    research_model = models.CharField(max_length=160, blank=True, default="")
    prompt_version = models.CharField(max_length=32, blank=True, default="")
    researched_at = models.DateTimeField(null=True, blank=True)

    selected = models.BooleanField(default=False)

    class Meta:
        ordering = ["recommendation_rank", "-created_at"]
        indexes = [models.Index(fields=["user_email", "goal"])]

    def __str__(self) -> str:
        return self.title[:80]


# ──────────────────────── PHASE 3. Документы и файлы ─────────────────────────


class Document(TimestampedModel):
    """Учебный источник ученика. Сам файл здесь НЕ хранится."""

    class SourceType(models.TextChoices):
        UPLOAD = "upload", "Загружен пользователем"
        RECOMMENDED = "recommended", "По рекомендации"
        BUILTIN = "builtin", "Материал Timely"

    class DocType(models.TextChoices):
        TEXTBOOK = "textbook", "Учебник"
        PROBLEM_SET = "problem_set", "Задачник"
        NOTES = "notes", "Конспект"
        HANDOUT = "handout", "Методичка"
        OTHER = "other", "Другое"

    class Status(models.TextChoices):
        UPLOADED = "uploaded", "Загружен"
        VALIDATING = "validating", "Проверка"
        EXTRACTING = "extracting_native_text", "Извлечение текста"
        CLASSIFYING = "classifying_pages", "Классификация страниц"
        OCR = "ocr", "Распознавание"
        RECONSTRUCTING = "reconstructing_structure", "Восстановление структуры"
        EXTRACTING_BLOCKS = "extracting_blocks", "Извлечение блоков"
        CHUNKING = "chunking", "Разбиение на фрагменты"
        INDEXING = "indexing", "Индексация"
        QUALITY_CHECK = "quality_check", "Проверка качества"
        READY = "ready", "Готов"
        FAILED = "failed", "Ошибка"

    class Visibility(models.TextChoices):
        PRIVATE = "private", "Только владелец"
        SHARED = "shared", "По ссылке участникам"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_email = models.EmailField(db_index=True)

    title = models.CharField(max_length=400)
    authors = models.JSONField(default=list, blank=True)
    language = models.CharField(max_length=8, default="ru")
    document_type = models.CharField(
        max_length=24, choices=DocType.choices, default=DocType.TEXTBOOK
    )
    source_type = models.CharField(
        max_length=24, choices=SourceType.choices, default=SourceType.UPLOAD
    )

    page_count = models.PositiveIntegerField(default=0)
    ingestion_status = models.CharField(
        max_length=32, choices=Status.choices, default=Status.UPLOADED, db_index=True
    )
    processing_version = models.CharField(max_length=16, default=PROCESSING_VERSION)
    visibility = models.CharField(
        max_length=16, choices=Visibility.choices, default=Visibility.PRIVATE
    )

    # Юридическая декларация загрузившего: без неё нельзя строить каталог.
    copyright_declaration = models.CharField(max_length=64, blank=True, default="")

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user_email", "-created_at"]),
            models.Index(fields=["user_email", "ingestion_status"]),
        ]

    def __str__(self) -> str:
        return self.title[:80]


class DocumentFile(TimestampedModel):
    """Физический файл документа: только метаданные и ключ в storage.

    PDF намеренно не лежит в PostgreSQL (§15.5): `storage_key` указывает на
    объект в подключённом storage adapter, а доступ выдаётся подписанной
    ссылкой с ограниченным временем жизни.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.OneToOneField(
        Document, on_delete=models.CASCADE, related_name="file"
    )
    original_filename = models.CharField(max_length=400)
    sanitized_filename = models.CharField(max_length=400)
    storage_backend = models.CharField(max_length=32, default="local")
    storage_key = models.CharField(max_length=600)
    mime_type = models.CharField(max_length=120)
    byte_size = models.PositiveBigIntegerField()
    # sha256 содержимого: дедупликация и проверка целостности.
    content_hash = models.CharField(max_length=64, db_index=True)
    antivirus_status = models.CharField(max_length=24, default="skipped")
    antivirus_detail = models.CharField(max_length=200, blank=True, default="")

    def __str__(self) -> str:
        return self.sanitized_filename


class DocumentPermission(TimestampedModel):
    """Явное разрешение на чужой документ. Отсутствие строки = нет доступа."""

    class Role(models.TextChoices):
        READER = "reader", "Чтение"
        REVIEWER = "reviewer", "Проверяющий"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        Document, on_delete=models.CASCADE, related_name="permissions"
    )
    grantee_email = models.EmailField(db_index=True)
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.READER)
    # Проверяющий имеет право видеть решения — обычный читатель нет.
    can_view_solutions = models.BooleanField(default=False)

    class Meta:
        unique_together = ("document", "grantee_email")


class DocumentPage(models.Model):
    """Одна страница. `needs_ocr` решает, тратить ли на неё vision-модель."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        Document, on_delete=models.CASCADE, related_name="pages"
    )
    page_number = models.PositiveIntegerField()
    width = models.FloatField(null=True, blank=True)
    height = models.FloatField(null=True, blank=True)
    native_text_length = models.PositiveIntegerField(default=0)
    needs_ocr = models.BooleanField(default=False)
    ocr_applied = models.BooleanField(default=False)
    ocr_model = models.CharField(max_length=160, blank=True, default="")
    extraction_method = models.CharField(max_length=32, default="native")
    confidence = models.FloatField(null=True, blank=True)

    class Meta:
        ordering = ["page_number"]
        unique_together = ("document", "page_number")
        indexes = [models.Index(fields=["document", "page_number"])]


class DocumentSection(models.Model):
    """Узел оглавления: глава → раздел → подраздел."""

    class Kind(models.TextChoices):
        CHAPTER = "chapter", "Глава"
        SECTION = "section", "Раздел"
        SUBSECTION = "subsection", "Подраздел"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        Document, on_delete=models.CASCADE, related_name="sections"
    )
    parent = models.ForeignKey(
        "self", on_delete=models.CASCADE, null=True, blank=True, related_name="children"
    )
    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.SECTION)
    title = models.CharField(max_length=400)
    # Материализованный путь «1.2.3» — быстрее рекурсии и стабилен в citations.
    path = models.CharField(max_length=120, default="")
    order_index = models.PositiveIntegerField(default=0)
    start_page = models.PositiveIntegerField(default=0)
    end_page = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order_index"]
        indexes = [models.Index(fields=["document", "order_index"])]

    def __str__(self) -> str:
        return f"{self.path} {self.title}"[:80]


class DocumentBlock(models.Model):
    """Наименьшая типизированная единица содержимого с provenance."""

    class Kind(models.TextChoices):
        PARAGRAPH = "paragraph", "Абзац"
        HEADING = "heading", "Заголовок"
        DEFINITION = "definition", "Определение"
        THEOREM = "theorem", "Теорема"
        PROOF = "proof", "Доказательство"
        FORMULA = "formula", "Формула"
        TABLE = "table", "Таблица"
        FIGURE = "figure", "Рисунок"
        CAPTION = "caption", "Подпись"
        EXAMPLE = "example", "Пример"
        EXERCISE = "exercise", "Задача"
        SOLUTION = "solution", "Решение"
        SUMMARY = "summary", "Итоги"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        Document, on_delete=models.CASCADE, related_name="blocks"
    )
    # Nullable, потому что страница есть не у всякого формата. У EPUB её нет
    # вовсе: текст перетекает под размер экрана. Без null такой блок было
    # невозможно записать, и фрагменты ссылались бы в `block_ids` на строки,
    # которых не существует, — тот самый висячий провенанс, против которого
    # существует весь раздел.
    page = models.ForeignKey(
        DocumentPage,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="blocks",
    )
    section = models.ForeignKey(
        DocumentSection,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="blocks",
    )
    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.PARAGRAPH)
    reading_order = models.PositiveIntegerField(default=0)
    raw_text = models.TextField(blank=True, default="")
    normalized_text = models.TextField(blank=True, default="")
    latex = models.TextField(blank=True, default="")
    # [x0, y0, x1, y1] в координатах страницы; пусто, если извлекатель не дал.
    bbox = models.JSONField(default=list, blank=True)
    confidence = models.FloatField(null=True, blank=True)
    extraction_method = models.CharField(max_length=32, default="native")
    content_hash = models.CharField(max_length=64, default="", db_index=True)

    class Meta:
        ordering = ["reading_order"]
        indexes = [
            models.Index(fields=["document", "reading_order"]),
            models.Index(fields=["document", "kind"]),
        ]


# ───────────────────────── PHASE 4. Ingestion pipeline ────────────────────────


class IngestionJob(TimestampedModel):
    """Одна попытка провести документ по пайплайну.

    Джоб идемпотентен по паре (документ, processing_version): повторный запуск
    при той же версии не создаёт дублей страниц и блоков, а продолжает с
    текущего шага. Это обязательное свойство — воркер может быть убит в любой
    момент (контейнер эфемерный, gunicorn --timeout 200).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        Document, on_delete=models.CASCADE, related_name="ingestion_jobs"
    )
    user_email = models.EmailField(db_index=True)
    status = models.CharField(
        max_length=32,
        choices=Document.Status.choices,
        default=Document.Status.UPLOADED,
        db_index=True,
    )
    processing_version = models.CharField(max_length=16, default=PROCESSING_VERSION)
    retry_count = models.PositiveIntegerField(default=0)
    error_code = models.CharField(max_length=64, blank=True, default="")
    # Текст для пользователя: без путей, стектрейсов и содержимого документа.
    error_message = models.CharField(max_length=400, blank=True, default="")
    # Предупреждения обработки (`ocr_not_configured`, `ocr_limited_to_N_of_M_pages`).
    # Хранить обязательно: при асинхронном запуске ответ на POST уходит раньше, чем
    # они появятся, и без этого поля пользователь их никогда не увидит.
    warnings = models.JSONField(default=list, blank=True)
    # Идентификатор задачи Celery. Пусто при синхронном запуске.
    celery_task_id = models.CharField(max_length=64, blank=True, default="")
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["document", "-created_at"])]


class IngestionAttempt(models.Model):
    """Журнал переходов состояний. Append-only, как AIUsageEvent."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job = models.ForeignKey(
        IngestionJob, on_delete=models.CASCADE, related_name="attempts"
    )
    from_status = models.CharField(max_length=32, blank=True, default="")
    to_status = models.CharField(max_length=32)
    succeeded = models.BooleanField(default=True)
    error_code = models.CharField(max_length=64, blank=True, default="")
    error_message = models.CharField(max_length=400, blank=True, default="")
    duration_ms = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]


# ─────────────── PHASE 5. Задачи и решения — РАЗДЕЛЬНОЕ хранение ──────────────


class ExtractedTask(models.Model):
    """Условие задачи. Решение сюда не попадает НИКОГДА.

    Разделение — требование безопасности, а не удобства: если условие и решение
    окажутся в одном retrieval-чанке, решение утечёт в контекст модели в режиме
    самостоятельной работы. Связь только по FK, см. `ExtractedSolution`.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        Document, on_delete=models.CASCADE, related_name="tasks"
    )
    section = models.ForeignKey(
        DocumentSection,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="tasks",
    )
    block = models.ForeignKey(
        DocumentBlock,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    number_label = models.CharField(max_length=32, blank=True, default="")
    statement = models.TextField()
    page_start = models.PositiveIntegerField(default=0)
    page_end = models.PositiveIntegerField(default=0)
    difficulty_hint = models.CharField(max_length=32, blank=True, default="")
    content_hash = models.CharField(max_length=64, default="", db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["page_start", "number_label"]
        indexes = [models.Index(fields=["document", "page_start"])]


class ExtractedSolution(models.Model):
    """Решение задачи. Отдельная таблица и отдельная политика доступа."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    task = models.ForeignKey(
        ExtractedTask, on_delete=models.CASCADE, related_name="solutions"
    )
    document = models.ForeignKey(
        Document, on_delete=models.CASCADE, related_name="solutions"
    )
    body = models.TextField()
    page_start = models.PositiveIntegerField(default=0)
    page_end = models.PositiveIntegerField(default=0)
    content_hash = models.CharField(max_length=64, default="", db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["page_start"]


# ───────────────────────────── PHASE 6. Чанки ────────────────────────────────


class KnowledgeChunk(models.Model):
    """Смысловой фрагмент для retrieval.

    `access_scope` и `solution_visibility` — не украшение, а то, по чему
    `retrieval.apply_access_policy` отсекает фрагменты ДО поиска.
    """

    class ChunkType(models.TextChoices):
        DEFINITION = "definition", "Определение"
        THEOREM = "theorem", "Теорема"
        PROOF = "proof", "Доказательство"
        EXAMPLE = "example", "Пример"
        TASK = "task", "Задача"
        SOLUTION = "solution", "Решение"
        TABLE = "table", "Таблица"
        FIGURE = "figure", "Рисунок"
        PROSE = "prose", "Текст раздела"
        SUMMARY = "summary", "Итоги"

    class AccessScope(models.TextChoices):
        OWNER = "owner", "Только владелец"
        SHARED = "shared", "Владелец и приглашённые"

    class SolutionVisibility(models.TextChoices):
        # Обычный фрагмент — виден всегда, когда есть доступ к документу.
        ALWAYS = "always", "Всегда"
        # Решение — только по явной политике режима.
        RESTRICTED = "restricted", "По политике режима"

    class EmbeddingStatus(models.TextChoices):
        PENDING = "pending", "Ждёт вектора"
        READY = "ready", "Вектор посчитан"
        # Провайдер не настроен или чанк отброшен потолком: это НЕ ошибка, и
        # повторять такой чанк при каждом прогоне бессмысленно.
        SKIPPED = "skipped", "Пропущен"
        # Батч упал. Помечаются только свои чанки, чужие остаются pending.
        FAILED = "failed", "Не удалось"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    document = models.ForeignKey(
        Document, on_delete=models.CASCADE, related_name="chunks"
    )
    section = models.ForeignKey(
        DocumentSection,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="chunks",
    )
    chunk_type = models.CharField(
        max_length=16, choices=ChunkType.choices, default=ChunkType.PROSE
    )
    section_path = models.CharField(max_length=120, blank=True, default="")
    page_start = models.PositiveIntegerField(default=0)
    page_end = models.PositiveIntegerField(default=0)
    block_ids = models.JSONField(default=list, blank=True)
    normalized_text = models.TextField()
    token_count = models.PositiveIntegerField(default=0)

    parent = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="children"
    )
    previous = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    next = models.ForeignKey(
        "self", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    # Связь с задачей/решением — чтобы политика могла отсечь решение по task_id.
    task = models.ForeignKey(
        ExtractedTask,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="chunks",
    )

    content_hash = models.CharField(max_length=64, db_index=True)
    processing_version = models.CharField(max_length=16, default=PROCESSING_VERSION)
    access_scope = models.CharField(
        max_length=16, choices=AccessScope.choices, default=AccessScope.OWNER
    )
    solution_visibility = models.CharField(
        max_length=16,
        choices=SolutionVisibility.choices,
        default=SolutionVisibility.ALWAYS,
    )
    # ── Эмбеддинг ────────────────────────────────────────────────────────────
    #
    # `embedding_status` был мёртвым полем: `CharField` без choices и без
    # индекса, который никто не выставлял. Теперь по нему выбираются чанки на
    # индексацию, поэтому у него есть и то и другое.
    embedding_status = models.CharField(
        max_length=16,
        choices=EmbeddingStatus.choices,
        default=EmbeddingStatus.PENDING,
        db_index=True,
    )
    # Колонка существует на всех бэкендах, а векторными операторами и HNSW
    # пользуется только Postgres — см. гейт в миграции. На SQLite (тесты) она
    # остаётся обычной колонкой, и плотный поиск туда не ходит.
    embedding = VectorField(dimensions=EMBEDDING_DIMENSIONS, null=True, blank=True)
    # Какой моделью посчитан вектор. Без этого нельзя понять, можно ли сравнивать
    # два чанка между собой: векторы разных моделей несопоставимы.
    embedding_model = models.CharField(max_length=120, blank=True, default="")
    embedded_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["page_start", "id"]
        indexes = [
            models.Index(fields=["document", "chunk_type"]),
            models.Index(fields=["document", "page_start"]),
            models.Index(fields=["content_hash"]),
            # Выбор очереди на индексацию: «чанки этого документа, ещё не
            # посчитанные».
            models.Index(fields=["document", "embedding_status"]),
        ]


# ───────────────────────── PHASE 9. Программа курса ──────────────────────────


class CoursePlan(TimestampedModel):
    """Программа по книге. Подтверждённая версия неизменяема (см. Version)."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Черновик"
        REVIEWING = "reviewing", "На проверке"
        AWAITING_APPROVAL = "awaiting_approval", "Ждёт подтверждения"
        ACTIVE = "active", "Активна"
        REJECTED = "rejected", "Отклонена"
        ARCHIVED = "archived", "В архиве"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_email = models.EmailField(db_index=True)
    goal = models.ForeignKey(
        LearningGoal, on_delete=models.CASCADE, related_name="course_plans"
    )
    document = models.ForeignKey(
        Document,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="course_plans",
    )

    title = models.CharField(max_length=300)
    objective = models.TextField(blank=True, default="")
    current_level = models.CharField(max_length=24, default="")
    target_level = models.CharField(max_length=24, default="")
    language = models.CharField(max_length=8, default="ru")

    estimated_total_minutes = models.PositiveIntegerField(default=0)
    recommended_sessions_per_week = models.PositiveSmallIntegerField(default=3)
    recommended_session_minutes = models.PositiveSmallIntegerField(default=40)
    forecast_finish_date = models.DateField(null=True, blank=True)
    forecast = models.JSONField(default=dict, blank=True)

    status = models.CharField(
        max_length=24, choices=Status.choices, default=Status.DRAFT, db_index=True
    )

    generation_model = models.CharField(max_length=160, blank=True, default="")
    reviewer_model = models.CharField(max_length=160, blank=True, default="")
    generation_prompt_version = models.CharField(max_length=32, blank=True, default="")
    review_prompt_version = models.CharField(max_length=32, blank=True, default="")
    source_processing_version = models.CharField(max_length=16, blank=True, default="")
    schema_version = models.CharField(max_length=16, default=PLANNING_SCHEMA_VERSION)

    approved_at = models.DateTimeField(null=True, blank=True)
    current_version = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user_email", "-created_at"])]

    def __str__(self) -> str:
        return self.title[:80]


class CoursePlanVersion(models.Model):
    """Снимок программы. AI не правит подтверждённый курс задним числом.

    Любое изменение создаёт НОВУЮ версию с diff'ом и требует подтверждения
    ученика. Поэтому `snapshot` хранится целиком: без него нельзя показать, что
    именно ученик одобрял.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plan = models.ForeignKey(
        CoursePlan, on_delete=models.CASCADE, related_name="versions"
    )
    version = models.PositiveIntegerField()
    snapshot = models.JSONField()
    diff = models.JSONField(default=dict, blank=True)
    reason = models.CharField(max_length=300, blank=True, default="")
    requested_by = models.CharField(max_length=32, default="student")
    approved_by_student = models.BooleanField(default=False)
    approved_at = models.DateTimeField(null=True, blank=True)
    generation_model = models.CharField(max_length=160, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["version"]
        unique_together = ("plan", "version")


class CourseModule(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plan = models.ForeignKey(
        CoursePlan, on_delete=models.CASCADE, related_name="modules"
    )
    # Идентификатор из ответа модели — по нему связываются зависимости.
    external_id = models.CharField(max_length=64)
    title = models.CharField(max_length=300)
    objective = models.TextField(blank=True, default="")
    order_index = models.PositiveIntegerField(default=0)
    estimated_minutes = models.PositiveIntegerField(default=0)
    completion_criteria = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["order_index"]
        unique_together = ("plan", "external_id")


class CourseTopic(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    module = models.ForeignKey(
        CourseModule, on_delete=models.CASCADE, related_name="topics"
    )
    external_id = models.CharField(max_length=64)
    title = models.CharField(max_length=300)
    objective = models.TextField(blank=True, default="")
    order_index = models.PositiveIntegerField(default=0)
    difficulty = models.CharField(max_length=24, blank=True, default="")
    estimated_minutes = models.PositiveIntegerField(default=0)
    suggested_lesson_count = models.PositiveSmallIntegerField(default=1)
    theory_practice_balance = models.CharField(max_length=16, default="balanced")
    mastery_criteria = models.TextField(blank=True, default="")
    review_strategy = models.CharField(max_length=64, blank=True, default="")

    class Meta:
        ordering = ["order_index"]


class CourseDependency(models.Model):
    """Ребро графа prerequisites. Цикл запрещён валидатором, не БД."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plan = models.ForeignKey(
        CoursePlan, on_delete=models.CASCADE, related_name="dependencies"
    )
    topic = models.ForeignKey(
        CourseTopic, on_delete=models.CASCADE, related_name="dependencies"
    )
    depends_on = models.ForeignKey(
        CourseTopic, on_delete=models.CASCADE, related_name="dependents"
    )

    class Meta:
        unique_together = ("topic", "depends_on")


class CourseMilestone(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plan = models.ForeignKey(
        CoursePlan, on_delete=models.CASCADE, related_name="milestones"
    )
    module = models.ForeignKey(
        CourseModule,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="milestones",
    )
    title = models.CharField(max_length=300)
    description = models.TextField(blank=True, default="")
    order_index = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["order_index"]


class CourseSourceBinding(models.Model):
    """Привязка темы курса к конкретным фрагментам книги.

    Без неё тема считается неподтверждённой: валидатор помечает такие темы как
    hallucinated, потому что модель не имела права придумывать содержание вне
    переданных источников.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    topic = models.ForeignKey(
        CourseTopic, on_delete=models.CASCADE, related_name="source_bindings"
    )
    document = models.ForeignKey(
        Document, on_delete=models.CASCADE, related_name="course_bindings"
    )
    chunk = models.ForeignKey(
        KnowledgeChunk,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="course_bindings",
    )
    section_path = models.CharField(max_length=120, blank=True, default="")
    page_start = models.PositiveIntegerField(default=0)
    page_end = models.PositiveIntegerField(default=0)


class CourseEnrollment(TimestampedModel):
    """Факт того, что ученик начал заниматься по подтверждённой версии."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    plan = models.ForeignKey(
        CoursePlan, on_delete=models.CASCADE, related_name="enrollments"
    )
    user_email = models.EmailField(db_index=True)
    version = models.ForeignKey(
        CoursePlanVersion, on_delete=models.PROTECT, related_name="enrollments"
    )
    started_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        unique_together = ("plan", "user_email")
