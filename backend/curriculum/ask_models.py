"""Какой моделью и с какой глубиной отвечает тьютор в чате.

Выбирают из короткого списка, а проверяет выбор сервер: идентификатор модели с клиента
напрямую в провайдера не идёт (CLAUDE.md §13). Незнакомое значение значит вариант по
умолчанию: устаревшая вкладка не должна ломать вопрос.

Рассуждение у GLM 5.3 обязательное и выключить его нельзя: OpenRouter знает только уровни
low, high и max. Его токены списываются из `max_tokens`, поэтому лимит растёт с уровнем,
иначе модель потратила бы всё на раздумья и ответила пустотой.

Окно контекста и цены сверены с `GET openrouter.ai/api/v1/models` 2026-11-05.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from decimal import Decimal

from ai_engine.usage import UsageNumbers


@dataclass(frozen=True)
class AskModel:
    key: str
    model_id: str
    name: str
    note: str
    context_window: int
    # Долларов за миллион токенов.
    input_per_million: Decimal
    output_per_million: Decimal


@dataclass(frozen=True)
class ReasoningLevel:
    key: str
    name: str
    note: str
    max_tokens: int


ASK_MODELS = (
    AskModel(
        key="glm-5.3",
        model_id=os.getenv("ASK_MODEL_MAIN", "z-ai/glm-5.3"),
        name="GLM 5.3",
        note="Основная модель, сильнее в сложных задачах",
        context_window=1_048_576,
        input_per_million=Decimal("0.07"),
        output_per_million=Decimal("1.40"),
    ),
    AskModel(
        key="glm-5.3-flash",
        model_id=os.getenv("ASK_MODEL_FLASH", "z-ai/glm-5.3-flash"),
        name="GLM 5.3 Flash",
        note="Быстрее, длинные ответы дешевле",
        context_window=1_048_576,
        input_per_million=Decimal("0.15"),
        output_per_million=Decimal("0.50"),
    ),
)

REASONING_LEVELS = (
    ReasoningLevel("low", "Низкий", "Отвечает быстро, подходит почти всегда", 4000),
    ReasoningLevel("high", "Высокий", "Думает дольше и тратит больше", 16000),
    ReasoningLevel("max", "Максимум", "Для самых сложных задач, дороже всего", 32000),
)

DEFAULT_MODEL = ASK_MODELS[0]
DEFAULT_REASONING = REASONING_LEVELS[0]


@dataclass(frozen=True)
class AskChoice:
    model: AskModel
    reasoning: ReasoningLevel


def resolve_choice(model: object = None, reasoning: object = None) -> AskChoice:
    """Выбор из запроса. Всё незнакомое становится вариантом по умолчанию."""
    return AskChoice(
        model=next((row for row in ASK_MODELS if row.key == model), DEFAULT_MODEL),
        reasoning=next((row for row in REASONING_LEVELS if row.key == reasoning), DEFAULT_REASONING),
    )


def ask_options() -> dict:
    """То, из чего выбирают в поле чата."""
    return {
        "default_model": DEFAULT_MODEL.key,
        "default_reasoning": DEFAULT_REASONING.key,
        "models": [
            {
                "key": row.key,
                "name": row.name,
                "note": row.note,
                "context_window": row.context_window,
                "input_per_million": float(row.input_per_million),
                "output_per_million": float(row.output_per_million),
            }
            for row in ASK_MODELS
        ],
        "reasoning": [{"key": row.key, "name": row.name, "note": row.note} for row in REASONING_LEVELS],
    }


def usage_payload(choice: AskChoice, rounds: list) -> dict:
    """Расход одного ответа для клиента. Цена от провайдера, а если он её не прислал, по прайсу.

    Круг с инструментами это отдельный запрос к модели, поэтому токены и цена складываются. А окно
    занимает только последний: в него уже входит всё, что было на прошлых кругах.
    """
    last = rounds[-1]
    numbers = UsageNumbers(
        input_tokens=sum(row.input_tokens for row in rounds),
        cached_input_tokens=sum(row.cached_input_tokens for row in rounds),
        output_tokens=sum(row.output_tokens for row in rounds),
        reasoning_tokens=sum(row.reasoning_tokens for row in rounds),
        total_tokens=sum(row.total_tokens for row in rounds),
        cost_usd=None if any(row.cost_usd is None for row in rounds) else sum(row.cost_usd for row in rounds),
    )
    cost = numbers.cost_usd
    estimated = cost is None
    if estimated:
        cost = (
            numbers.input_tokens * choice.model.input_per_million
            + numbers.output_tokens * choice.model.output_per_million
        ) / Decimal(1_000_000)
    return {
        "model": choice.model.key,
        "model_name": choice.model.name,
        "reasoning": choice.reasoning.key,
        "input_tokens": numbers.input_tokens,
        "cached_input_tokens": numbers.cached_input_tokens,
        "output_tokens": numbers.output_tokens,
        "reasoning_tokens": numbers.reasoning_tokens,
        "total_tokens": numbers.total_tokens,
        "context_window": choice.model.context_window,
        # Раздумья в следующий запрос не попадают, поэтому в окне их нет.
        "context_tokens": last.input_tokens + max(0, last.output_tokens - last.reasoning_tokens),
        "cost_usd": float(cost),
        "cost_estimated": estimated,
    }
