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
from typing import Any, Iterator

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


# ──────────────────────────────────────────────────────────────────────────────
# Стриминг
#
# Нестримящий route_and_run выше остаётся нетронутым: на него завязаны
# /api/ai/chat, планировщик урока и тесты. Стриминг — отдельная функция рядом,
# потому что у неё принципиально другой контракт (генератор событий вместо
# одного SkillResult) и другие параметры модели: здесь reasoning ВКЛЮЧЁН, его
# и показывает блок «Думаю…».
# ──────────────────────────────────────────────────────────────────────────────

# Рассуждения стоят токенов и времени (замер в route_and_run: 144 токена/3.9с
# против 30/2.0с), поэтому effort="low" — нам нужен видимый ход мысли, а не
# максимальная глубина.
STREAM_REASONING_EFFORT = "low"


def _assemble_tool_calls(buffer: dict[int, dict]) -> list[dict]:
    """Собрать tool-calls из стрим-дельт.

    В стриме tool-call приезжает по кускам: имя функции обычно в первой дельте,
    а `arguments` дописываются символ за символом в последующих. Ключ — index,
    а не id: id приходит только в первой дельте.
    """
    calls = []
    for index in sorted(buffer):
        item = buffer[index]
        name = (item.get("name") or "").strip()
        if not name:
            continue
        calls.append({"name": name, "arguments": item.get("arguments") or ""})
    return calls


def route_and_run_streaming(
    *, user_message: str, history: list | None = None, **ctx: Any
) -> Iterator[tuple[str, dict]]:
    """Определить намерение и выполнить скилл, отдавая события по мере готовности.

    Yields кортежи (event, data):
        ("reasoning", {"delta": str})  — кусок цепочки рассуждений
        ("content",   {"delta": str})  — кусок текста ответа
        ("stage",     {"stage": str})  — сменилась стадия (routing/drawing/…)
        ("done",      payload)         — финальный SkillResult.as_payload()
    """
    history = history or []

    # Детерминированная смена стиля — как и в нестримящем пути, модель не
    # спрашиваем вовсе. Рассуждать здесь не о чем, поэтому сразу стадия+результат.
    if history and style_from_message(user_message):
        logger.info("[router] skill=draw_board (команда смены стиля, без вызова модели)")
        yield "stage", {"stage": "drawing"}
        result = SKILLS["draw_board"].run(user_message=user_message, history=history, **ctx)
        yield "done", result.as_payload()
        return

    lesson_instruction = str(ctx.get("lesson_instruction") or "").strip()
    system_prompt = CHAT_SYSTEM_PROMPT
    if lesson_instruction:
        system_prompt = f"{system_prompt}\n\n{lesson_instruction}"

    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    for item in history[-ROUTER_HISTORY_LIMIT:]:
        role = item.get("role")
        content_item = item.get("content")
        if role in ("user", "assistant") and isinstance(content_item, str) and content_item.strip():
            messages.append({"role": role, "content": content_item})
    messages.append({"role": "user", "content": user_message})

    yield "stage", {"stage": "routing"}

    stream = openrouter_client.chat.completions.create(
        model=OPENROUTER_MODEL,
        messages=messages,
        tools=ROUTABLE_TOOLS,
        max_tokens=1500,
        temperature=0.7,
        timeout=120,
        stream=True,
        # Без include_usage финальный чанк приходит без usage, и весь учёт
        # токенов для стримящего пути молча обнулился бы.
        stream_options={"include_usage": True},
        extra_body={"reasoning": {"enabled": True, "effort": STREAM_REASONING_EFFORT}},
    )

    reasoning_parts: list[str] = []
    content_parts: list[str] = []
    tool_buffer: dict[int, dict] = {}
    usage_chunk: Any = None

    for chunk in stream:
        # Чанк с usage приходит последним и НЕ содержит choices.
        if getattr(chunk, "usage", None):
            usage_chunk = chunk
        choices = getattr(chunk, "choices", None)
        if not choices:
            continue
        delta = getattr(choices[0], "delta", None)
        if delta is None:
            continue

        reasoning_delta = getattr(delta, "reasoning", None)
        if reasoning_delta:
            reasoning_parts.append(reasoning_delta)
            yield "reasoning", {"delta": reasoning_delta}

        content_delta = getattr(delta, "content", None)
        if content_delta:
            content_parts.append(content_delta)
            yield "content", {"delta": content_delta}

        for tool_delta in getattr(delta, "tool_calls", None) or []:
            index = getattr(tool_delta, "index", 0) or 0
            slot = tool_buffer.setdefault(index, {"name": "", "arguments": ""})
            function = getattr(tool_delta, "function", None)
            if function is not None:
                if getattr(function, "name", None):
                    slot["name"] = function.name
                if getattr(function, "arguments", None):
                    slot["arguments"] += function.arguments

    if usage_chunk is not None:
        record_model_usage(
            usage_chunk,
            model=OPENROUTER_MODEL,
            provider=provider_from_base_url(BOARD_LLM_BASE_URL),
            feature="board_router_stream",
            input_payload=messages,
        )

    content = "".join(content_parts).strip()
    reasoning = "".join(reasoning_parts).strip()
    tool_calls = _assemble_tool_calls(tool_buffer)

    if not tool_calls:
        logger.info("[router] skill=chat (без тулов), стриминг")
        yield "done", SkillResult(
            reply=content, board=None, model=OPENROUTER_MODEL, skill="chat", reasoning=reasoning
        ).as_payload()
        return

    call = tool_calls[0]
    skill_name = call["name"]
    try:
        args = json.loads(call["arguments"] or "{}")
    except (TypeError, ValueError):
        args = {}

    skill = SKILLS.get(skill_name)
    if skill is None or skill_name == "chat":
        logger.warning("[router] неизвестный тул %r — отвечаем как чат", skill_name)
        result = SKILLS["chat"].run(
            user_message=user_message, history=history, reply=content, model=OPENROUTER_MODEL
        )
        result.reasoning = reasoning
        yield "done", result.as_payload()
        return

    logger.info("[router] skill=%s args=%s (стриминг)", skill_name, args)
    yield "stage", {"stage": "drawing" if skill_name == "draw_board" else skill_name}
    result = skill.run(user_message=user_message, history=history, **{**ctx, **args})

    if not result.reply and content:
        result.reply = content
    result.reasoning = reasoning
    yield "done", result.as_payload()
