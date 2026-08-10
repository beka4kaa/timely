"""Что планировщик знает о разделе книги, кроме его заголовка.

Планировщик до сих пор видел только оглавление: строку «§ 24. Работа силы» и
номера страниц. Из заголовка нельзя понять, вводит ли раздел новое понятие или
закрепляет предыдущее, требует ли он производной, чему ученик научится. Поэтому
модель и не могла осмысленно объединять параграфы в темы — объединять было не
по чему, оставалось переписывать оглавление подряд.

Профиль — это то, что вычитано из самого текста раздела: понятия, навыки,
сложность, чего раздел требует заранее. Считается один раз на раздел и
кэшируется по содержимому, потому что книга не меняется, а планов по ней ученик
строит много.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Версия входит в ключ кэша: сменился промпт — прежние профили больше не
# отражают того, что мы просили у модели, и должны быть пересчитаны.
PROFILE_PROMPT_VERSION = "section-profile-1.0.0"

# Потолок на раздел. Профиль — это выжимка, а не пересказ: сотня понятий из
# одной главы означает, что модель перечислила каждое существительное.
MAX_CONCEPTS = 12
MAX_SKILLS = 8
MAX_PREREQUISITES = 8


@dataclass
class ProfileResult:
    """Профиль одного раздела: то, что вернула модель, до записи в базу.

    Отдельно от Django-модели `SectionProfile` по той же причине, по которой
    отделены `CoursePlanningResult` и `CoursePlan`: провайдер должен собираться
    и тестироваться без базы.
    """

    section_id: str
    summary: str = ""
    concepts: list[str] = field(default_factory=list)
    skills: list[str] = field(default_factory=list)
    prerequisites: list[str] = field(default_factory=list)
    difficulty: str = "medium"
    # Заголовок обещал теорию, а внутри оказались одни упражнения — такое
    # видно только по тексту. Разметка оглавления при расхождении уточняется.
    is_teachable: bool = True
    content_statistics: dict = field(default_factory=dict)
    model: str = ""
    prompt_version: str = PROFILE_PROMPT_VERSION

    def clamp(self) -> "ProfileResult":
        """Обрезает списки до потолков. Модель не всегда соблюдает просьбу."""
        self.concepts = [c for c in self.concepts if c][:MAX_CONCEPTS]
        self.skills = [s for s in self.skills if s][:MAX_SKILLS]
        self.prerequisites = [p for p in self.prerequisites if p][:MAX_PREREQUISITES]
        return self

    def to_payload(self) -> dict:
        return {
            "summary": self.summary,
            "concepts": list(self.concepts),
            "skills": list(self.skills),
            "prerequisites": list(self.prerequisites),
            "difficulty": self.difficulty,
            "is_teachable": self.is_teachable,
            "content_statistics": dict(self.content_statistics),
        }


@dataclass(frozen=True)
class ProfilingRequest:
    """Раздел плюс его текст — всё, что нужно для одного вызова."""

    section_id: str
    title: str
    number_label: str
    structural_role: str
    level: int
    page_start: int
    page_end: int
    context: str
    content_statistics: dict = field(default_factory=dict)
