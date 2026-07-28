"""
Базовый контракт скилла доски.

Скилл — это одна изолированная функция ассистента (ответить в чате, построить
доску, …) со своим системным промптом, своими параметрами модели и своей ценой.
Роутер (`skills.router`) выбирает скилл через native tool-calling и вызывает
`run()`. Разделение существует ради стоимости и латентности: простой вопрос не
должен тащить за собой 6.8 КБ board-DSL промпта и reasoning-токены.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class SkillResult:
    """Единый ответ любого скилла — фронтенд не должен знать, кто отработал."""

    reply: str
    board: dict | None = None
    model: str = ""
    skill: str = ""
    # Цепочка рассуждений модели. Мы за неё платим в любом случае, поэтому
    # отдаём её наружу, а не выбрасываем: фронтенд показывает её в блоке
    # «Думаю…». Пустая строка — модель рассуждений не вернула.
    reasoning: str = ""
    meta: dict[str, Any] = field(default_factory=dict)

    def as_payload(self) -> dict[str, Any]:
        return {
            "reply": self.reply,
            "board": self.board,
            "model": self.model,
            "skill": self.skill,
            "reasoning": self.reasoning,
            **self.meta,
        }


class Skill(ABC):
    """Один навык ассистента.

    `name`/`description`/`parameters` описывают скилл для модели в формате
    OpenAI function calling: по ним GLM-4.6V решает, звать ли этот скилл.
    Описание пишется ДЛЯ МОДЕЛИ — от его точности напрямую зависит, не полезет
    ли ассистент рисовать доску на «привет».
    """

    name: str = ""
    description: str = ""
    parameters: dict[str, Any] = {}

    def as_tool(self) -> dict[str, Any]:
        """Схема тула для запроса к модели."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }

    @abstractmethod
    def run(self, *, user_message: str, history: list, **kwargs: Any) -> SkillResult:
        """Выполнить скилл. `kwargs` — контекст запроса (стиль, референс и т.д.)."""
        raise NotImplementedError
