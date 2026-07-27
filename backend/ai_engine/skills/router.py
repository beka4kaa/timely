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
from ..tutor_modes import TutorMode, get_mode
from ..tutor_tools import (
    MAX_TOOL_ROUNDS,
    TUTOR_TOOLS,
    ToolContext,
    resolve_topic,
    run_tutor_tool,
    tool_schemas,
)
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

# Сколько последних сообщений даём роутеру для контекста. Больше не нужно:
# роутер решает намерение, а не пишет диссертацию, и каждое сообщение здесь —
# это входные токены на КАЖДЫЙ запрос.
ROUTER_HISTORY_LIMIT = 6


def tools_for_mode(mode: TutorMode) -> list[dict[str, Any]]:
    """Инструменты, которые видит модель в этом режиме.

    ChatSkill в тулы НЕ отдаём ни в одном режиме: «просто ответить» — поведение
    по умолчанию, когда модель не позвала ни одного тула. Отдельный тул для него
    заставил бы модель делать лишний выбор и стоил бы второго запроса.

    Единственное место, где собирается список тулов. Иначе режим «Контест»
    остался бы честным только на словах: промпт просит не помогать, а тул
    `draw_board` при этом лежит на столе, и модели достаточно один раз его
    позвать. Пустой `allowed_skills` даёт пустой список — вызывающий код тогда
    не передаёт `tools` в запрос вовсе (OpenAI-совместимые провайдеры отвергают
    `tools: []`).
    """
    skills = [SKILLS[name].as_tool() for name in mode.allowed_skills if name in SKILLS]
    # Инструменты §5.7 идут тем же механизмом tool-calling, что и скиллы, но
    # обрабатываются иначе: их результат возвращается модели, и она продолжает
    # ответ (см. route_and_run). Порядок «сначала скиллы» сохранён, чтобы
    # ROUTABLE_TOOLS остался прежним списком для режима по умолчанию.
    return skills + tool_schemas(mode.allowed_tools)


# Прежнее имя-константа: набор тулов режима по умолчанию. Оставлено потому, что
# оно по-прежнему точно описывает запрос без явного режима.
ROUTABLE_TOOLS = tools_for_mode(get_mode(None))


def build_router_messages(
    *,
    user_message: str,
    history: list,
    mode: TutorMode,
    lesson_instruction: str = "",
) -> list[dict[str, Any]]:
    """Собрать `messages` для роутящего запроса.

    Единственный сборщик промпта для ВСЕХ путей чата. Вынесен из route_and_run
    именно за этим: пока сборка была инлайном, каждый новый путь (например
    стриминговый) заводил себе вторую копию, и правила режима разъехались бы
    между путями молча — снаружи это выглядит как «в стриме тьютор ведёт себя
    иначе», и причину не найти.

    Слои промпта по порядку: общие правила чата (язык, LaTeX, когда рисовать) →
    правила режима → инструкция текущего урока. Общий слой идёт первым, потому
    что он про ФОРМАТ ответа, а режим — про поведение; так режим уточняет формат,
    а не наоборот.
    """
    layers = [CHAT_SYSTEM_PROMPT, mode.prompt]
    instruction = str(lesson_instruction or "").strip()
    if instruction:
        layers.append(instruction)

    messages: list[dict[str, Any]] = [{"role": "system", "content": "\n\n".join(layers)}]
    for item in history[-ROUTER_HISTORY_LIMIT:]:
        role = item.get("role")
        content = item.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": user_message})
    return messages


def route_and_run(*, user_message: str, history: list | None = None, **ctx: Any) -> SkillResult:
    """Определить намерение и выполнить подходящий скилл."""
    history = history or []
    mode = get_mode(ctx.get("mode"))

    # Команда смены стиля («do sketch», «в 3d», «сделай изометрию») —
    # маршрутизируем ДЕТЕРМИНИРОВАННО, не спрашивая модель. Промптом её не
    # уговорить: на «do sketch» GLM отвечал текстом «вот более набросочный
    # вариант» и тул не звал, то есть картинка не перерисовывалась вовсе.
    # Условие — в истории уже что-то рисовали, иначе перерисовывать нечего.
    # Режим тоже должен разрешать доску: иначе этот шорткат стал бы способом
    # нарисовать схему там, где `tools_for_mode` её намеренно не отдаёт.
    if history and style_from_message(user_message) and "draw_board" in mode.allowed_skills:
        logger.info("[router] skill=draw_board (команда смены стиля, без вызова модели)")
        return SKILLS["draw_board"].run(user_message=user_message, history=history, **ctx)

    messages = build_router_messages(
        user_message=user_message,
        history=history,
        mode=mode,
        lesson_instruction=str(ctx.get("lesson_instruction") or ""),
    )
    tools = tools_for_mode(mode)

    request_kwargs: dict[str, Any] = {
        "model": OPENROUTER_MODEL,
        "messages": messages,
        "max_tokens": 1500,
        "temperature": 0.7,
        "timeout": 60,
        # Для маршрутизации и обычного ответа думать нечего — reasoning только
        # жжёт токены и время (замерено: 144 токена/3.9с против 30/2.0с).
        "extra_body": {"reasoning": {"enabled": False}},
    }
    # `tools: []` провайдеры отвергают, а в режиме «Контест» список пуст по
    # замыслу — поэтому ключа в запросе просто нет.
    if tools:
        request_kwargs["tools"] = tools

    # Контекст инструментов §5.7 задаёт backend, а не модель: пользователь и
    # тема берутся из запроса. Тему ищем только если режим вообще пользуется
    # инструментами — иначе это лишний запрос в БД на каждое сообщение.
    user_email = str(ctx.get("user_email") or "")
    tool_context = ToolContext(
        user_email=user_email,
        topic=(
            resolve_topic(user_email, str(ctx.get("topic_name") or ""))
            if mode.allowed_tools
            else None
        ),
        mode=mode.slug,
    )

    content = ""
    # Инструменты возвращают ДАННЫЕ, поэтому после их вызова модель должна
    # получить результат и продолжить ответ — отсюда цикл. Он ограничен
    # MAX_TOOL_ROUNDS: модель умеет зацикливаться на «проверю ещё раз», а каждый
    # круг это отдельный оплаченный запрос.
    for round_index in range(MAX_TOOL_ROUNDS):
        request_kwargs["messages"] = messages
        response = openrouter_client.chat.completions.create(**request_kwargs)
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
            return SkillResult(
                reply=content, board=None, model=OPENROUTER_MODEL, skill="chat"
            )

        call = tool_calls[0]
        skill_name = call.function.name
        try:
            args = json.loads(call.function.arguments or "{}")
        except (TypeError, ValueError):
            args = {}

        # ── Инструмент §5.7: исполняем и отдаём результат модели ─────────────
        if skill_name in TUTOR_TOOLS:
            if skill_name not in mode.allowed_tools:
                logger.warning(
                    "[router] инструмент %r недоступен в режиме %r — отвечаем как чат",
                    skill_name,
                    mode.slug,
                )
                return SKILLS["chat"].run(
                    user_message=user_message,
                    history=history,
                    reply=content,
                    model=OPENROUTER_MODEL,
                )

            result = run_tutor_tool(skill_name, args, tool_context)
            logger.info(
                "[router] tool=%s ok=%s (круг %s)",
                skill_name,
                result.get("ok"),
                round_index + 1,
            )
            call_id = getattr(call, "id", None) or f"{skill_name}-{round_index}"
            messages = [
                *messages,
                {
                    "role": "assistant",
                    "content": message.content or "",
                    "tool_calls": [
                        {
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": skill_name,
                                "arguments": call.function.arguments or "{}",
                            },
                        }
                    ],
                },
                {
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": json.dumps(result, ensure_ascii=False),
                },
            ]
            continue

        # ── Скилл: отвечает сам, второго запроса к модели не нужно ───────────
        skill = SKILLS.get(skill_name)
        if skill is None or skill_name == "chat":
            logger.warning("[router] неизвестный тул %r — отвечаем как чат", skill_name)
            return SKILLS["chat"].run(
                user_message=user_message,
                history=history,
                reply=content,
                model=OPENROUTER_MODEL,
            )

        # Модель не должна была увидеть этот тул в данном режиме, но GLM-4.6V
        # нестабилен на tool-calling и умеет позвать функцию, которой в запросе
        # не было. Раз режим — это правило, а не просьба, проверяем и на выходе.
        if skill_name not in mode.allowed_skills:
            logger.warning(
                "[router] тул %r недоступен в режиме %r — отвечаем как чат",
                skill_name,
                mode.slug,
            )
            return SKILLS["chat"].run(
                user_message=user_message,
                history=history,
                reply=content,
                model=OPENROUTER_MODEL,
            )

        return _run_skill(
            skill_name=skill_name,
            args=args,
            content=content,
            user_message=user_message,
            history=history,
            ctx=ctx,
        )

    # Круги вышли, а модель всё ещё зовёт инструменты. Отдаём последний текст:
    # ученику нужен ответ, а не сообщение об исчерпанном лимите.
    logger.warning("[router] лимит вызовов инструментов исчерпан в режиме %r", mode.slug)
    return SkillResult(
        reply=content or "Не удалось сформировать ответ. Попробуйте переформулировать.",
        board=None,
        model=OPENROUTER_MODEL,
        skill="chat",
    )


def _run_skill(
    *,
    skill_name: str,
    args: dict[str, Any],
    content: str,
    user_message: str,
    history: list,
    ctx: dict[str, Any],
) -> SkillResult:
    """Запустить скилл и подставить реплику модели, если сам скилл её не дал."""
    skill = SKILLS[skill_name]
    logger.info("[router] skill=%s args=%s", skill_name, args)
    result = skill.run(user_message=user_message, history=history, **{**ctx, **args})

    # Модель часто пишет «сейчас нарисую…» перед вызовом тула. Если сам скилл
    # реплики не дал — показываем эту, иначе чат выглядит молчащим.
    if not result.reply and content:
        result.reply = content
    return result
