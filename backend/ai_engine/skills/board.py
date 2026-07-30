"""
Скилл «нарисовать на доске» — тяжёлый путь.

Здесь живёт вся дорогая часть: board-DSL промпт (~6.8 КБ), reasoning включён,
max_tokens=3000, плюс обогащение иллюстраций растром. Скилл
вызывается ТОЛЬКО когда роутер получил от модели tool_call `draw_board`.

DSL-промпт и санитайзеры остаются в `draw_views` — он исторический владелец
формата доски. Импорт односторонний (skills.board → draw_views), а legacy-вью
`/api/ai/draw` делегирует сюда локальным импортом внутри метода, поэтому цикла
на уровне модулей нет.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from openai import APIConnectionError

from ..draw_views import (
    DRAW_SYSTEM_PROMPT,
    _extract_json,
    _history_for_model,
    _looks_like_style_restyle,
    _sanitize_board_data,
    style_from_message,
)
from ..image_enrichment import enrich_board_steps
from ..solve_views import BOARD_LLM_BASE_URL, OPENROUTER_MODEL, openrouter_client
from ..usage import provider_from_base_url, record_model_usage
from .base import Skill, SkillResult

logger = logging.getLogger(__name__)


class BoardSkill(Skill):
    name = "draw_board"
    # Описание читает модель — оно и есть граница между «просто ответить» и
    # «рисовать». Формулировка намеренно требует ЯВНОЙ просьбы: без этого
    # модель охотно рисует доску на «объясни коротко» (наблюдалось вживую —
    # простой вопрос уходил в 137-секундную генерацию доски).
    description = (
        "Построить визуальный конспект на интерактивной доске: таблицы, формулы, "
        "графики, диаграммы, схемы, научные иллюстрации. Вызывай ТОЛЬКО когда ученик "
        "явно просит нарисовать, построить, начертить, показать визуально или "
        "изобразить что-либо, либо просит разобрать задачу на доске. Для обычного "
        "вопроса, объяснения словами или беседы этот инструмент НЕ нужен."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "topic": {
                "type": "string",
                "description": "Что именно нужно построить на доске, одной фразой.",
            }
        },
        "required": ["topic"],
    }

    def run(self, *, user_message: str, history: list, **kwargs: Any) -> SkillResult:
        # Стиль, названный в самом сообщении, важнее выпадашки: «do sketch» —
        # это явная просьба, а `style` с фронтенда всё ещё хранит прежний выбор
        # (он меняется только кликом по селектору). Без этого текстовые команды
        # смены стиля не делали ничего.
        style = kwargs.get("style")
        requested_style = style_from_message(user_message)
        if requested_style and requested_style != style:
            logger.info("[skill:draw_board] стиль из запроса: %s (было %s)", requested_style, style)
            style = requested_style
        palette = kwargs.get("palette")
        reference_image_url: str | None = kwargs.get("reference_image_url") or None
        reference_labels = kwargs.get("reference_labels")
        if not (isinstance(reference_labels, list) and reference_labels):
            reference_labels = None

        # Что именно рисовать. Роутер уже РАЗРЕШИЛ ссылку на предыдущий ответ:
        # на «нарисуй мне» после разговора о первом законе Ньютона он передаёт
        # topic="Первый закон Ньютона (закон инерции) — схема с телами…".
        # Раньше это значение игнорировалось, и в модель уходило голое
        # «нарисуй мне» — без темы она сочиняла случайный сюжет (на проде
        # выдала куб с подписями «Верхняя грань»/«Правая грань»).
        topic = str(kwargs.get("topic") or "").strip()
        # Короткие команды («нарисуй», «покажи схему») сами по себе смысла не
        # несут — тему берём из topic. Если же запрос содержательный, ведём
        # им, а topic добавляем как уточнение от роутера.
        if topic and len(user_message) < len(topic):
            request = topic
        elif topic and topic.lower() not in user_message.lower():
            request = f"{user_message}\n\nЧто именно нужно нарисовать: {topic}"
        else:
            request = user_message

        # ── Чистая смена стиля: перерисовываем ТОЛЬКО картинку ──────────────
        # «Сделай в стиле скетч» — это про картинку, а не про урок. Раньше
        # такой запрос всё равно шёл в board-модель, та возвращала полную доску
        # заново, и на холст ложилась ВТОРАЯ копия всего конспекта поверх
        # первой: те же «Суть закона», «Визуальная модель», «Связи». Плюс
        # лишние 60-70 секунд на генерацию текста, который никто не просил.
        #
        # Здесь модель не нужна вовсе: сюжет уже известен (image_prompt
        # предыдущей иллюстрации), подписи готовы, композицию сохранит i2i по
        # reference_image_url. Собираем доску из одной команды и выходим.
        restyle_prompt = str(kwargs.get("reference_prompt") or "").strip()
        if requested_style and reference_image_url and restyle_prompt:
            logger.info(
                "[skill:draw_board] чистый рестайл в %s — без вызова модели, текст не трогаем",
                requested_style,
            )
            return SkillResult(
                reply="",
                board={
                    "subject": "",
                    "topic": "",
                    # Флаг для фронтенда: не раскладывать новую доску, а
                    # перерисовать ТУ ЖЕ иллюстрацию на месте.
                    "restyle": True,
                    "board_steps": [
                        {
                            "commands": [
                                {
                                    "type": "image_with_labels",
                                    "image_prompt": restyle_prompt,
                                    "labels": reference_labels or [],
                                    "gen_style": style,
                                }
                            ]
                        }
                    ],
                },
                model="",
                skill=self.name,
            )

        lesson_instruction = str(kwargs.get("lesson_instruction") or "").strip()
        if lesson_instruction:
            request = (
                f"{lesson_instruction}\n\n"
                f"Запрос ученика на текущем этапе:\n{request}"
            )

        messages = [{"role": "system", "content": DRAW_SYSTEM_PROMPT}]
        contextual_history = _history_for_model(history, user_message)
        if contextual_history:
            logger.info("[skill:draw_board] context: %d recent history messages", len(contextual_history))
        else:
            logger.info("[skill:draw_board] context: clean new request, history omitted")
        messages.extend(contextual_history)
        messages.append({"role": "user", "content": request})
        if topic and topic.lower() not in user_message.lower():
            logger.info("[skill:draw_board] тема от роутера: %.90s", topic)

        logger.info("[skill:draw_board] generating via %s", OPENROUTER_MODEL)
        t_llm = time.monotonic()
        # Сетевые обрывы до OpenRouter случаются и падают мгновенно — их
        # повторяем. Долгие ответы НЕ ретраим (это удвоило бы ожидание).
        response = None
        last_conn_err = None
        for attempt in range(3):
            try:
                response = openrouter_client.chat.completions.create(
                    model=OPENROUTER_MODEL,
                    messages=messages,
                    # Лимит с запасом: ответ может содержать до
                    # MAX_ILLUSTRATIONS_PER_ANSWER картинок, и JSON выходит
                    # длинным. На 3000 он обрезался (finish_reason=length) —
                    # доска приходила пустой.
                    max_tokens=6000,
                    temperature=0.4,
                    timeout=180,
                    # reasoning нужен (модель строит структурированный JSON), но
                    # БЕЗ ограничения GLM съедал им почти весь бюджет: замерено
                    # 2735 из 3000 токенов, на сам JSON не оставалось ничего.
                    # effort=low держит рассуждение в районе 200-400 токенов.
                    extra_body={"reasoning": {"effort": "low"}},
                )
                break
            except APIConnectionError as ce:
                last_conn_err = ce
                logger.warning("[skill:draw_board] connection error (attempt %d/3), retrying…", attempt + 1)
                time.sleep(1.5)
        if response is None:
            raise last_conn_err if last_conn_err else RuntimeError("No response from model")

        record_model_usage(
            response,
            model=OPENROUTER_MODEL,
            provider=provider_from_base_url(BOARD_LLM_BASE_URL),
            feature="board_layout",
            input_payload=messages,
        )
        logger.info("[skill:draw_board][timing] генерация DSL доски: %.1fс", time.monotonic() - t_llm)
        choice = response.choices[0]
        # Обрезанный ответ → битый JSON → пустая доска. Раньше это выглядело
        # как «модель ничего не нарисовала», хотя дело было в лимите токенов.
        if getattr(choice, "finish_reason", None) == "length":
            logger.warning(
                "[skill:draw_board] ответ обрезан по лимиту токенов — JSON может не распарситься. "
                "Поднимите max_tokens или упростите запрос."
            )
        raw = choice.message.content or ""
        parsed = _extract_json(raw)

        if not parsed or not isinstance(parsed, dict):
            # Модель не выдала JSON — отдаём текст как обычный ответ.
            #
            # Раньше это было МОЛЧА, и отладить было нечем: пользователь видел в
            # чате простыню сырого JSON, а в логе — ничего. Логируем причину и
            # края ответа. Если тут снова JSON — значит _extract_json не
            # справился с ним (так ловился одиночный бэкслеш в «$30^\circ$»,
            # см. _repair_json_escapes в draw_views).
            looks_like_json = raw.lstrip().startswith(("{", "```"))
            logger.warning(
                "[skill:draw_board] JSON не распознан → отдаём текстом. "
                "finish_reason=%s len=%d looks_like_json=%s head=%.120s… tail=…%.120s",
                getattr(choice, "finish_reason", None),
                len(raw),
                looks_like_json,
                raw[:120].replace("\n", " "),
                raw[-120:].replace("\n", " "),
            )
            return SkillResult(
                reply=raw.strip() or "Не удалось сформировать ответ.",
                board=None,
                model=OPENROUTER_MODEL,
                skill=self.name,
            )

        reply = parsed.get("reply") or ""

        intent_raw = parsed.get("intent")
        intent = intent_raw.strip().lower() if isinstance(intent_raw, str) else "new"
        forced_restyle = bool(reference_image_url) and _looks_like_style_restyle(user_message)
        is_restyle = bool(reference_image_url) and (intent == "restyle" or forced_restyle)
        if forced_restyle and intent != "restyle":
            logger.info("[skill:draw_board] intent forced to restyle by short style command")
        logger.info("[skill:draw_board] intent=%s (restyle=%s)", intent, is_restyle)

        # При restyle переиспользуем подписи предыдущей иллюстрации как есть —
        # композиция сохраняется i2i-механизмом, значит координаты валидны.
        if is_restyle and reference_labels:
            for step in parsed.get("board_steps") or []:
                if isinstance(step, dict):
                    for cmd in step.get("commands") or []:
                        if isinstance(cmd, dict) and cmd.get("type") == "image_with_labels":
                            cmd["labels"] = reference_labels

        board = _sanitize_board_data(parsed)

        # Прогрессивная выдача: с enrich_images=False возвращаем доску СРАЗУ,
        # с командами image_with_labels без картинок. Фронтенд рисует
        # плейсхолдеры и догружает каждую иллюстрацию отдельным запросом
        # (/api/ai/illustration). Общее время не меняется, но текст и структура
        # появляются через ~18с вместо ~45-120с.
        enrich_images = bool(kwargs.get("enrich_images", True))
        if not enrich_images and board:
            logger.info("[skill:draw_board] enrich_images=False → доска без картинок")
            return SkillResult(
                reply=(reply or "").strip(),
                board=board,
                model=OPENROUTER_MODEL,
                skill=self.name,
            )

        if board and isinstance(board.get("board_steps"), list):
            topic_hint = " ".join(
                part for part in (board.get("subject") or "", board.get("topic") or "") if part
            ) or (kwargs.get("topic") or "")
            board["board_steps"] = enrich_board_steps(
                board["board_steps"],
                topic_hint=topic_hint,
                style=style,
                palette=palette,
                reference_image_url=reference_image_url if is_restyle else None,
                skip_grounding=is_restyle,
                # Выбранная пользователем image-модель. Валидация уже прошла во
                # вьюхе — сюда приезжает готовый ImageGenOptions либо None.
                options=kwargs.get("image_options"),
            )

        return SkillResult(
            reply=(reply or "").strip(),
            board=board,
            model=OPENROUTER_MODEL,
            skill=self.name,
        )
