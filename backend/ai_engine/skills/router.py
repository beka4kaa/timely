"""
Роутер скиллов на native tool-calling.

Как это работает (один запрос вместо двух в типичном случае):

    вопрос ученика
          │
          ├─ модель отвечает текстом, тулов не звала  →  ЭТО и есть ответ чата.
          │                                              Больше запросов нет. ~1.5с
          │
          └─ модель вернула tool_call draw_board      →  запускаем BoardSkill
                                                          (тяжёлый DSL-промпт)

Ключевой выигрыш: раньше чат всегда бил в /api/ai/draw и каждое сообщение тащило
board-DSL промпт. Замерено на «Что такое производная? Объясни коротко»: старый
путь — 137 секунд плюс непрошеная доска на холсте; новый путь — один дешёвый
вызов, а доска строится только по явной просьбе.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from ..draw_views import style_from_message
from ..solve_views import BOARD_LLM_BASE_URL, OPENROUTER_MODEL, openrouter_client
from ..usage import provider_from_base_url, record_model_usage
from .base import SkillResult
from .board import BoardSkill
from .chat import CHAT_SYSTEM_PROMPT, ChatSkill
from .clarify import ClarifySkill

logger = logging.getLogger(__name__)

# Реестр скиллов. Чтобы добавить новый — реализуйте Skill и впишите сюда:
# роутер сам покажет его модели и сам смаршрутизирует вызов.
SKILLS = {
    skill.name: skill
    for skill in (
        BoardSkill(),
        ChatSkill(),
        ClarifySkill(),
    )
}

# ChatSkill в тулы НЕ отдаём: «просто ответить» — это поведение по умолчанию,
# когда модель не позвала ни одного тула. Отдельный тул для него заставил бы
# модель делать лишний выбор и стоил бы второго запроса.
ROUTABLE_TOOLS = [
    SKILLS["draw_board"].as_tool(),
    SKILLS["ask_clarification"].as_tool(),
]

# Сколько последних сообщений даём роутеру для контекста. Больше не нужно:
# роутер решает намерение, а не пишет диссертацию, и каждое сообщение здесь —
# это входные токены на КАЖДЫЙ запрос.
ROUTER_HISTORY_LIMIT = 6


def route_and_run(*, user_message: str, history: list | None = None, **ctx: Any) -> SkillResult:
    """Определить намерение и выполнить подходящий скилл."""
    history = history or []

    # Команда смены стиля («do sketch», «в 3d», «сделай изометрию») —
    # маршрутизируем ДЕТЕРМИНИРОВАННО, не спрашивая модель. Промптом её не
    # уговорить: на «do sketch» GLM отвечал текстом «вот более набросочный
    # вариант» и тул не звал, то есть картинка не перерисовывалась вовсе.
    # Условие — в истории уже что-то рисовали, иначе перерисовывать нечего.
    if history and style_from_message(user_message):
        logger.info("[router] skill=draw_board (команда смены стиля, без вызова модели)")
        return SKILLS["draw_board"].run(user_message=user_message, history=history, **ctx)

    lesson_instruction = str(ctx.get("lesson_instruction") or "").strip()
    system_prompt = CHAT_SYSTEM_PROMPT
    if lesson_instruction:
        system_prompt = f"{system_prompt}\n\n{lesson_instruction}"

    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    for item in history[-ROUTER_HISTORY_LIMIT:]:
        role = item.get("role")
        content = item.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": user_message})

    response = openrouter_client.chat.completions.create(
        model=OPENROUTER_MODEL,
        messages=messages,
        tools=ROUTABLE_TOOLS,
        max_tokens=1500,
        temperature=0.7,
        timeout=60,
        # Для маршрутизации и обычного ответа думать нечего — reasoning только
        # жжёт токены и время (замерено: 144 токена/3.9с против 30/2.0с).
        extra_body={"reasoning": {"enabled": False}},
    )
    record_model_usage(
        response,
        model=OPENROUTER_MODEL,
        provider=provider_from_base_url(BOARD_LLM_BASE_URL),
        feature="board_router",
        input_payload=messages,
    )

    message = response.choices[0].message
    content = (message.content or "").strip()
    tool_calls = getattr(message, "tool_calls", None)

    if not tool_calls:
        logger.info("[router] skill=chat (без тулов), one-shot ответ")
        return SkillResult(reply=content, board=None, model=OPENROUTER_MODEL, skill="chat")

    call = tool_calls[0]
    skill_name = call.function.name
    try:
        args = json.loads(call.function.arguments or "{}")
    except (TypeError, ValueError):
        args = {}

    skill = SKILLS.get(skill_name)
    if skill is None or skill_name == "chat":
        logger.warning("[router] неизвестный тул %r — отвечаем как чат", skill_name)
        return SKILLS["chat"].run(
            user_message=user_message, history=history, reply=content, model=OPENROUTER_MODEL
        )

    logger.info("[router] skill=%s args=%s", skill_name, args)
    result = skill.run(user_message=user_message, history=history, **{**ctx, **args})

    # Модель часто пишет «сейчас нарисую…» перед вызовом тула. Если сам скилл
    # реплики не дал — показываем эту, иначе чат выглядит молчащим.
    if not result.reply and content:
        result.reply = content
    return result
