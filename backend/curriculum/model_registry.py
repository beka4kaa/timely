"""Роли моделей вместо одной глобальной текстовой модели.

Проблема, которую это решает: сейчас всё текстовое идёт через
`ai_engine.text_llm.TEXT_LLM_MODEL` (DeepSeek V4 Flash). Планирование курса —
редкая и дорогая операция, чат — частая и дешёвая. Одна переменная на двоих
означает, что переключить планировщик на сильную модель нельзя, не сделав
дорогим каждое сообщение в чате.

Приоритет разрешения роли:

    <ROLE>_MODEL  →  TEXT_LLM_MODEL  →  пусто (детерминированный fake в тестах)

Пустой результат — не ошибка: он означает «реальная модель не настроена», и
вызывающий код обязан взять fake-провайдер вместо того, чтобы падать.
Существующее поведение чата не меняется: `TEXT_LLM_MODEL` остаётся как есть.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

# Роли. Значения — префиксы переменных окружения.
ROLE_BOOK_RESEARCH = "BOOK_RESEARCH"
ROLE_GOAL_NORMALIZATION = "GOAL_NORMALIZATION"
ROLE_COURSE_PLANNING = "COURSE_PLANNING"
ROLE_COURSE_REVIEW = "COURSE_REVIEW"
ROLE_LESSON_GENERATION = "LESSON_GENERATION"
ROLE_EMBEDDING = "EMBEDDING"
ROLE_RERANKER = "RERANKER"
ROLE_OCR = "OCR"

ALL_ROLES = (
    ROLE_BOOK_RESEARCH,
    ROLE_GOAL_NORMALIZATION,
    ROLE_COURSE_PLANNING,
    ROLE_COURSE_REVIEW,
    ROLE_LESSON_GENERATION,
    ROLE_EMBEDDING,
    ROLE_RERANKER,
    ROLE_OCR,
)

# Роли, которые осмысленно откатывать на общую текстовую модель. Для эмбеддингов
# и OCR это бессмысленно: чат-модель не выдаёт векторы и не распознаёт страницу.
_TEXT_FALLBACK_ROLES = frozenset(
    {
        ROLE_BOOK_RESEARCH,
        # Нормализация цели — отдельная роль, а не часть COURSE_PLANNING:
        # ученик правит формулировку цели много раз, а курс планируется редко.
        # Одна переменная на двоих заставила бы гонять дорогую planner-модель на
        # каждое нажатие «уточнить цель».
        ROLE_GOAL_NORMALIZATION,
        ROLE_COURSE_PLANNING,
        ROLE_COURSE_REVIEW,
        ROLE_LESSON_GENERATION,
    }
)


@dataclass(frozen=True)
class ModelBinding:
    """Разрешённая для роли модель и то, как её получили."""

    role: str
    model: str
    source: str  # "role" | "text_llm_fallback" | "unset"
    timeout_seconds: int = 180
    max_tokens: int = 8000
    reasoning_effort: str | None = "medium"
    # Слаги провайдеров OpenRouter, которым разрешено обслуживать роль. Пусто —
    # маршрутизация по умолчанию.
    #
    # Список нужен там, где важна не только модель, но и КТО её обслуживает.
    # Измерено на `minimax/minimax-m3`: провайдеры одной и той же модели
    # различаются втрое по скорости (57 с против 178 с на одном запросе) и по
    # поддержке strict-схемы (3 из 9). Штатный `provider.require_parameters`
    # эту задачу не решает — он стабильно уводил на самого медленного из
    # подходящих и не выбирал быстрого даже по явному `order`.
    providers: tuple[str, ...] = ()

    @property
    def configured(self) -> bool:
        return bool(self.model)


def _env(name: str) -> str:
    return (os.getenv(name, "") or "").strip()


def resolve_model(role: str) -> ModelBinding:
    """Возвращает привязку модели к роли, не обращаясь к сети."""
    if role not in ALL_ROLES:
        raise ValueError(f"Неизвестная роль модели: {role}")

    explicit = _env(f"{role}_MODEL")
    if explicit:
        return ModelBinding(
            role=role,
            model=explicit,
            source="role",
            timeout_seconds=_int_env(f"{role}_TIMEOUT", 180),
            max_tokens=_int_env(f"{role}_MAX_TOKENS", 8000),
            reasoning_effort=_env(f"{role}_REASONING_EFFORT") or "medium",
            providers=_list_env(f"{role}_PROVIDERS"),
        )

    if role in _TEXT_FALLBACK_ROLES:
        shared = _env("TEXT_LLM_MODEL")
        if shared:
            return ModelBinding(role=role, model=shared, source="text_llm_fallback")

    return ModelBinding(role=role, model="", source="unset")


def _list_env(name: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in _env(name).split(",") if part.strip())


def _int_env(name: str, default: int) -> int:
    raw = _env(name)
    if not raw:
        return default
    try:
        return max(1, int(raw))
    except ValueError:
        return default


def registry_snapshot() -> dict[str, dict[str, object]]:
    """Состояние всех ролей — для диагностики и отчёта benchmark."""
    snapshot: dict[str, dict[str, object]] = {}
    for role in ALL_ROLES:
        binding = resolve_model(role)
        snapshot[role] = {
            "model": binding.model,
            "source": binding.source,
            "configured": binding.configured,
        }
    return snapshot


def evaluation_candidates() -> list[str]:
    """Модели-кандидаты для сравнения (`COURSE_EVAL_MODELS`).

    Читается из конфигурации, чтобы пятого кандидата можно было добавить без
    правки кода. Пустая переменная означает «сравнивать нечего» — harness в
    этом случае обязан отказаться от запуска, а не подставлять список по
    умолчанию: неявный список кандидатов приводит к неожиданным платным вызовам.
    """
    raw = _env("COURSE_EVAL_MODELS")
    return [part.strip() for part in raw.split(",") if part.strip()]
