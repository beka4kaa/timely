"""Контракты обмена с моделью-планировщиком курса.

Ключевое разделение (§«Архитектурный принцип»): модель возвращает ТОЛЬКО
семантику — темы, зависимости, приблизительные длительности и ссылки на уже
переданные ей chunk_id. Календарные даты, права, порядок публикации и итоговый
расчёт нагрузки остаются за backend'ом.

Все структуры — обычные dataclass'ы без Django: провайдер должен быть
тестируемым без БД, а benchmark — уметь гонять один и тот же вход через разные
модели, не поднимая приложение.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field

# 1.1.0: в SYSTEM_PROMPT добавлены допустимые значения перечислений
# (difficulty / theory_practice_balance / review_strategy). До этого промпт
# перечислял только ИМЕНА полей, а валидатор блокировал план за любое чужое
# значение — модель не могла выполнить контракт, которого ей не сообщили.
#
# 2.0.0: модель получает иерархию книги (level/parent) и обязана ссылаться
# на `source_section_ids`, а требование «покрывать оглавление» убрано. До
# этого вход был плоским списком, и модель делала модуль на каждую строку:
# 38 модулей ровно по одной теме на одной книге.
#
# 1.2.0: форма ответа переехала из прозы в JSON Schema (`planning/schema.py`),
# и промпт похудел ровно на неё. Дублировать контракт в двух местах — способ
# однажды их разъехать; в промпте осталось то, чего схема выразить не может.
PROMPT_VERSION = "course-planner-2.0.0"
REVIEW_PROMPT_VERSION = "course-reviewer-1.0.0"


@dataclass(frozen=True)
class BookMetadata:
    title: str
    authors: tuple[str, ...] = ()
    language: str = "ru"
    year: int | None = None
    document_id: str = ""


@dataclass(frozen=True)
class TocEntry:
    """Раздел книги, переданный модели.

    `level` и `parent_path` появились не для полноты: без них модель видела
    плоский список из полутора сотен строк и делала модуль на каждую. На
    «Механике» Мякишева это дало 38 модулей ровно по одной теме, включая
    шестнадцать одинаковых «Упражнений». Иерархия в базе была — до модели она
    просто не доезжала.
    """

    path: str
    title: str
    page_start: int
    page_end: int
    # Уровень в книге: 1 — часть, 2 — глава, 3 — параграф.
    level: int = 1
    # Педагогическая роль раздела (`outline.contracts.Role`).
    role: str = "section"
    # Путь родителя. Пусто у верхнего уровня.
    parent_path: str = ""
    # Номер раздела как он напечатан: «Глава 3», «§ 9.5». Пусто у заголовков без
    # номера. `path` для этого не годится — при отсутствии номера туда кладётся
    # порядковый индекс, и «7» неотличимо от настоящего номера.
    number_label: str = ""
    # Идентификатор родителя. Отдельно от `parent_path`, потому что пути не
    # уникальны: у разделов без номера они порядковые и совпадают между книгами
    # и внутри одной. Строить дерево по неуникальному ключу нельзя.
    parent_section_id: str = ""
    # Идентификатор раздела. Модель ссылается на него в `source_section_ids`,
    # и он же проверяется валидатором.
    section_id: str = ""
    # Из профиля раздела (`curriculum.profiles`). По заголовку «§ 24. Работа
    # силы» нельзя понять, вводит раздел новое понятие или закрепляет прошлое;
    # понятия и навыки — то, по чему параграфы вообще можно объединять в тему.
    # Пусто, если книга ещё не профилирована: тогда модель работает как раньше.
    concepts: tuple[str, ...] = ()
    skills: tuple[str, ...] = ()
    summary: str = ""


@dataclass(frozen=True)
class PlanningConstraints:
    """Рамки, которые сообщаются модели вместе с запросом.

    Числа подняты после живого прогона на «Механике, 10 класс» Мякишева: в
    книге 513 страниц и больше сотни параграфов, и программа по ней физически не
    укладывается в 12 модулей. Прежние значения приводили к тому, что план,
    честно покрывающий учебник, отбраковывался целиком, и ученик после трёх
    минут ожидания не получал НИЧЕГО.

    Это ориентир для модели, а не закон физики: превышение теперь фиксируется
    предупреждением, а не блокером (см. `validation.validate_plan`).
    """

    max_modules: int = 24
    max_topics_per_module: int = 20
    min_topic_minutes: int = 10
    max_topic_minutes: int = 240
    # Осталось блокером: это не «многовато», а признак сломанных чисел, по
    # которым потом строится прогноз сроков. Потолок поднят так, чтобы даже
    # предельно крупный допустимый план (24 × 20 тем по 240 минут = 115 200) в
    # него укладывался и блокер срабатывал только на настоящей чепухе.
    max_total_minutes: int = 200_000
    required_language: str = "ru"


@dataclass(frozen=True)
class CoursePlanningRequest:
    """Полный вход планировщика. Один и тот же для всех моделей в benchmark."""

    goal_text: str
    normalized_subject: str
    normalized_direction: str
    current_level: str
    target_level: str
    language: str
    theory_practice_balance: str
    desired_finish_date: str | None
    book: BookMetadata
    toc: tuple[TocEntry, ...]
    # chunk_id, на которые модели РАЗРЕШЕНО ссылаться. Всё остальное —
    # галлюцинация, и валидатор это отловит.
    available_chunk_ids: tuple[str, ...]
    # Разделы, на которые модели РАЗРЕШЕНО ссылаться. Тот же принцип, что и
    # у фрагментов: всё остальное — выдумка, и валидатор её отловит.
    available_section_ids: tuple[str, ...] = ()
    source_excerpts: str = ""
    constraints: PlanningConstraints = field(default_factory=PlanningConstraints)
    schema_version: str = "1.0.0"
    prompt_version: str = PROMPT_VERSION
    # Претензии валидатора к ПРЕДЫДУЩЕЙ попытке. Заполняется только при повторном
    # вызове планировщика и в `input_hash` не входит: хеш отвечает на вопрос
    # «одинаковый ли вход у моделей в benchmark», а починка — свойство попытки,
    # а не входных данных.
    repair_issues: tuple[str, ...] = ()

    def input_hash(self) -> str:
        """Стабильный хеш входа.

        Benchmark обязан доказать, что все модели получили идентичный вход;
        сравнение хешей — единственный способ это гарантировать после того, как
        данные прошли через сериализацию.
        """
        data = asdict(self)
        data.pop("repair_issues", None)
        payload = json.dumps(data, ensure_ascii=False, sort_keys=True)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()


# ───────────────────────────── Ответ модели ──────────────────────────────────


@dataclass
class ProposedTopic:
    external_id: str
    title: str
    objective: str
    estimated_minutes: int
    difficulty: str = "medium"
    suggested_lesson_count: int = 1
    theory_practice_balance: str = "balanced"
    mastery_criteria: str = ""
    review_strategy: str = ""
    prerequisites: list[str] = field(default_factory=list)
    source_chunk_ids: list[str] = field(default_factory=list)
    # Разделы книги, из которых собрана тема. Именно они делают
    # группировку проверяемой: тема из трёх параграфов перечисляет все три.
    source_section_ids: list[str] = field(default_factory=list)
    # Из чего сложились минуты: теория, практика, проверка. Заполняет backend
    # (`services.plans.apply_durations`), модель этого поля не видит.
    duration_breakdown: dict = field(default_factory=dict)


@dataclass
class ProposedModule:
    external_id: str
    title: str
    objective: str
    estimated_minutes: int = 0
    completion_criteria: str = ""
    milestone: str = ""
    topics: list[ProposedTopic] = field(default_factory=list)


@dataclass
class CoursePlanningResult:
    """Сырое предложение модели ДО валидации. Не сохранять напрямую."""

    title: str
    objective: str
    modules: list[ProposedModule] = field(default_factory=list)
    rationale: str = ""
    model: str = ""
    prompt_version: str = PROMPT_VERSION
    schema_version: str = "1.0.0"
    raw_json: str = ""
    # Поля, которых нет в схеме. Не игнорируются: их наличие — сигнал, что
    # модель отвечает не по контракту, и это отдельная метрика benchmark.
    unknown_fields: list[str] = field(default_factory=list)

    def all_topics(self) -> list[ProposedTopic]:
        return [topic for module in self.modules for topic in module.topics]

    def total_minutes(self) -> int:
        return sum(t.estimated_minutes for t in self.all_topics())


@dataclass
class ReviewFinding:
    kind: str  # missing_topic | wrong_prerequisite | goal_mismatch | ...
    message: str
    topic_external_id: str = ""
    severity: str = "warning"  # info | warning | blocker


@dataclass
class CourseReviewResult:
    """Заключение рецензента. Публиковать курс он не может."""

    findings: list[ReviewFinding] = field(default_factory=list)
    approved: bool = True
    model: str = ""
    prompt_version: str = REVIEW_PROMPT_VERSION

    @property
    def blockers(self) -> list[ReviewFinding]:
        return [f for f in self.findings if f.severity == "blocker"]
