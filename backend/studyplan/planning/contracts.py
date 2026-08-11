"""Вход и версии промпта для планировщика ритма."""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field

from ..scheduling.pacing import TopicInput

PROMPT_VERSION = "schedule-pacing-1.0.0"
SCHEMA_VERSION = "1.0.0"


@dataclass(frozen=True)
class PacingConstraints:
    """Рамки, которые сообщаются модели вместе с запросом.

    Это ориентиры и одновременно то, по чему валидатор проверяет ответ: модель
    не может получить отказ за нарушение правила, о котором ей не сказали.
    """

    min_part_minutes: int = 15
    max_part_minutes: int = 45
    max_minutes_per_day: int = 0
    max_minutes_per_week: int = 0
    # Потолок общей длительности. Не «многовато», а признак сломанных чисел, по
    # которым дальше строится календарь на три месяца.
    max_total_minutes: int = 200_000
    min_buffer: float = 0.0
    max_buffer: float = 0.5


@dataclass(frozen=True)
class PacingRequest:
    """Полный вход планировщика ритма.

    Темы приходят уже в учебном порядке и с посчитанной разбивкой: модель
    решает, как разложить их по неделе, а не пересчитывает длительности заново.
    """

    goal_text: str
    subject: str
    current_level: str
    target_level: str
    theory_practice_balance: str
    language: str
    topics: tuple[TopicInput, ...]
    prerequisites: dict[str, tuple[str, ...]] = field(default_factory=dict)
    available_weekdays: tuple[int, ...] = ()
    sessions_per_week: int = 3
    session_minutes: int = 45
    constraints: PacingConstraints = field(default_factory=PacingConstraints)
    prompt_version: str = PROMPT_VERSION
    schema_version: str = SCHEMA_VERSION

    @property
    def allowed_topic_ids(self) -> tuple[str, ...]:
        return tuple(topic.topic_id for topic in self.topics)

    def input_hash(self) -> str:
        """Стабильный хеш входа — для сравнения моделей на одинаковых данных."""
        payload = json.dumps(asdict(self), ensure_ascii=False, sort_keys=True, default=str)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()
