"""Типы обмена планировщика. Обычные dataclass'ы, без Django.

Движок обязан тестироваться без базы, а один и тот же вход — давать один и тот
же календарь на любой машине. Поэтому здесь нет ни ORM-объектов, ни `datetime`
без зоны: все моменты времени — aware и в UTC, а локальное время живёт только в
`time`/`date` полях шаблона.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime, time

# Часть урока короче этого не заводится отдельным блоком: пятиминутный огрызок
# в календаре — шум, а не занятие. Остаток приклеивается к соседней части.
MIN_PART_MINUTES = 15

# Длительность одного повторения. Одинаковая для всех шагов намеренно:
# повторение — это попытка вспомнить, а не повторный урок, и его ценность не
# растёт с длительностью.
REVIEW_MINUTES = 15

# Через сколько дней после освоения темы идут повторения (§6.6).
REVIEW_OFFSETS_DAYS = (2, 7, 21)

# Сколько дней после целевой даты повторения его ещё имеет смысл ставить.
# Дальше это уже не то повторение, которое планировалось.
REVIEW_SEARCH_WINDOW_DAYS = 7

# Насколько подробно расписан ближайший горизонт. Дальше блок знает дату, тему,
# тип и длительность, но не конкретные упражнения: их дешевле уточнить ближе к
# уроку, чем сгенерировать пятьсот штук заранее.
DEFAULT_DETAILED_HORIZON_DAYS = 14

# Доля недельной ёмкости, остающаяся пустой. План должен быть устойчивым, а не
# максимально плотным: без запаса первый же пропуск рушит всё расписание.
DEFAULT_BUFFER_PERCENTAGE = 0.15


# ────────────────────────────── Вход движка ──────────────────────────────────


@dataclass(frozen=True)
class SlotSpec:
    """Одно повторяющееся окно недели, освобождённое от ORM."""

    slot_id: str
    weekday: int  # 0 = понедельник, как у date.weekday()
    start_time: time
    duration_minutes: int
    allowed_activity_types: tuple[str, ...] = ()  # пусто — любые
    fixed: bool = False
    priority: int = 0


@dataclass(frozen=True)
class TemplateSpec:
    timezone: str
    slots: tuple[SlotSpec, ...]
    max_minutes_per_day: int = 0  # 0 — без ограничения
    max_minutes_per_week: int = 0
    valid_from: date | None = None
    valid_until: date | None = None


@dataclass(frozen=True)
class CommitmentSpec:
    """Занятое время. Либо повторяющееся, либо разовое — не оба сразу."""

    title: str = ""
    weekday: int | None = None
    start_time: time | None = None
    duration_minutes: int = 0
    valid_from: date | None = None
    valid_until: date | None = None
    start_at: datetime | None = None  # UTC, aware
    end_at: datetime | None = None

    @property
    def is_recurring(self) -> bool:
        return self.weekday is not None and self.start_time is not None


@dataclass(frozen=True)
class LessonPart:
    """Одна часть темы: теория, разбор, практика или проверка.

    Части — не выдумка планировщика: они уже посчитаны при построении программы
    и лежат в `CourseTopic.duration_breakdown`.
    """

    topic_id: str
    topic_external_id: str
    module_external_id: str
    part_index: int
    activity_type: str
    duration_minutes: int
    title: str
    objective: str = ""
    mastery_criteria: str = ""
    source_section_ids: tuple[str, ...] = ()
    source_chunk_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class TopicPacing:
    topic_id: str
    topic_external_id: str
    lesson_parts: tuple[LessonPart, ...]
    # Название темы без суффикса части: части называются «Тема — теория», а
    # повторению нужно исходное название, и вырезать его из строки обратно
    # означало бы разбирать то, что мы сами склеили.
    title: str = ""
    module_external_id: str = ""

    @property
    def total_minutes(self) -> int:
        return sum(part.duration_minutes for part in self.lesson_parts)


@dataclass(frozen=True)
class WeeklyPatternDay:
    """Ритм одного дня недели. Описание, а не команда: реальные окна задаёт
    шаблон, а этот объект показывает ученику намерение и уходит в снимок."""

    weekday: int
    activity_types: tuple[str, ...]
    preferred_duration_minutes: int


@dataclass(frozen=True)
class MilestoneSpec:
    title: str
    after_topic_external_id: str = ""


@dataclass(frozen=True)
class PacingPlan:
    """Педагогический ритм без единой календарной даты.

    Ровно то, что на Этапе 2 будет отдавать модель: последовательность,
    формат занятий, примерный темп, распределение теории и практики, точки
    контроля. Даты, время и отсутствие пересечений остаются за движком.
    """

    weekly_pattern: tuple[WeeklyPatternDay, ...]
    topic_pacing: tuple[TopicPacing, ...]
    milestones: tuple[MilestoneSpec, ...] = ()
    buffer_percentage: float = DEFAULT_BUFFER_PERCENTAGE
    rationale: str = ""

    @property
    def total_minutes(self) -> int:
        return sum(topic.total_minutes for topic in self.topic_pacing)


@dataclass(frozen=True)
class ScheduleGenerationRequest:
    """Полный вход планировщика."""

    user_email: str
    course_plan_id: str
    template: TemplateSpec
    pacing: PacingPlan
    start_date: date
    end_date: date
    timezone: str
    commitments: tuple[CommitmentSpec, ...] = ()
    # Уже запланированная учебная нагрузка других курсов в локальных днях
    # этого календаря. Занятое время вычитается через `commitments`, а эта
    # отдельная сумма нужна для общих дневных/недельных лимитов: два курса не
    # должны каждый по отдельности исчерпать один и тот же лимит ученика.
    existing_study_minutes: tuple[tuple[date, int], ...] = ()
    # Зависимости тем: {topic_id: (topic_id, ...)}. Порядок изучения приходит
    # уже топологически отсортированным, но зависимости нужны для проверки.
    prerequisites: dict[str, tuple[str, ...]] = field(default_factory=dict)
    desired_finish_date: date | None = None
    detailed_horizon_days: int = DEFAULT_DETAILED_HORIZON_DAYS


# ────────────────────────────── Выход движка ─────────────────────────────────


@dataclass(frozen=True)
class FreeSlot:
    """Конкретное свободное окно с уже посчитанными границами в UTC."""

    slot_id: str
    local_date: date
    start: datetime
    end: datetime
    duration_minutes: int
    allowed_activity_types: tuple[str, ...] = ()
    priority: int = 0

    def accepts(self, activity_type: str) -> bool:
        return (
            not self.allowed_activity_types
            or activity_type in self.allowed_activity_types
        )


@dataclass(frozen=True)
class PlannedBlock:
    """Урок, размещённый во времени. Самодостаточен для материализации."""

    start: datetime
    end: datetime
    duration_minutes: int
    activity_type: str
    title: str
    kind: str = "lesson"  # lesson | review
    objective: str = ""
    topic_id: str = ""
    topic_external_id: str = ""
    module_external_id: str = ""
    mastery_criteria: str = ""
    source_section_ids: tuple[str, ...] = ()
    source_chunk_ids: tuple[str, ...] = ()
    review_step: int | None = None
    slot_id: str = ""


@dataclass(frozen=True)
class UnplacedPart:
    topic_external_id: str
    activity_type: str
    duration_minutes: int
    reason: str


@dataclass
class ConflictReport:
    """Почему программа не поместилась и что с этим делать.

    Отдаётся вместо тихого сокращения: ни один урок не укорачивается ниже
    минимума и ни одна тема не выбрасывается без ведома ученика.
    """

    feasible: bool
    required_minutes: int
    available_minutes: int
    unplaced: tuple[UnplacedPart, ...] = ()
    overrun_days: int = 0
    suggestions: tuple[str, ...] = ()

    def to_payload(self) -> dict:
        return {
            "feasible": self.feasible,
            "required_minutes": self.required_minutes,
            "available_minutes": self.available_minutes,
            "unplaced": [asdict(part) for part in self.unplaced],
            "overrun_days": self.overrun_days,
            "suggestions": list(self.suggestions),
        }


@dataclass
class ScheduleDraft:
    """Календарь до записи в базу."""

    blocks: tuple[PlannedBlock, ...] = ()
    conflict: ConflictReport | None = None
    warnings: tuple[str, ...] = ()
    stats: dict = field(default_factory=dict)

    @property
    def feasible(self) -> bool:
        return self.conflict is None or self.conflict.feasible

    @property
    def last_block_end(self) -> datetime | None:
        return max((block.end for block in self.blocks), default=None)
