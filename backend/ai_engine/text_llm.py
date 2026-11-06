"""
Текстовая LLM для учебных программ, анализа прогресса и планирования.

Было: google-generativeai (gemini-2.0-flash) напрямую по ключу GEMINI_API_KEY.
Стало: z-ai/glm-5.3 через OpenRouter (раньше deepseek/deepseek-v4-flash) — тот же провайдер, что и у
остального стека, и заметно дешевле ($0.14/M вход против прайса Gemini, а на
повторяющихся системных промптах cache hit стоит $0.0028/M).

Интерфейс намеренно повторяет `genai.GenerativeModel`: `.generate_content(prompt)`
возвращает объект с `.text`. Благодаря этому ~500 строк промптов и вся разборка
ответов в `services.py` остались без изменений — поменялся только транспорт.
"""

from __future__ import annotations

import concurrent.futures
import contextvars
import functools
import json
import logging
import os
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from openai import BadRequestError, OpenAI

from .usage import UsageNumbers, extract_usage, provider_from_base_url, record_model_usage

logger = logging.getLogger(__name__)

TEXT_LLM_BASE_URL = os.getenv("TEXT_LLM_BASE_URL", "https://openrouter.ai/api/v1")
TEXT_LLM_API_KEY = os.getenv("TEXT_LLM_API_KEY", os.getenv("OPENROUTER_API_KEY", ""))
AI_TEXT_ZDR = os.getenv("AI_TEXT_ZDR", "true").lower() in {"1", "true", "yes"}
TEXT_LLM_MODEL = os.getenv("TEXT_LLM_MODEL", "z-ai/glm-5.3")
TEXT_LLM_TIMEOUT = int(os.getenv("TEXT_LLM_TIMEOUT", "180"))
# Учебная программа на 12 недель — это большой JSON. Лимит с запасом: при
# обрезке ответа json.loads падает и вся генерация уходит впустую.
TEXT_LLM_MAX_TOKENS = int(os.getenv("TEXT_LLM_MAX_TOKENS", "16000"))

# `timeout=`, который уходит в OpenAI SDK, а оттуда в httpx, — это таймаут
# ПРОСТОЯ между чанками, а не дедлайн вызова. Провайдер, который шлёт keep-alive,
# пока модель думает, сбрасывает этот таймер на каждом чанке, и вызов спокойно
# живёт кратно дольше настроенного. Измерено на `planning_intake` (настроено 20 с,
# фактически ~120 с) — там же появился и этот приём, теперь он переехал в общий
# транспорт, потому что болезнь одинакова для всех вызывающих.
#
# Воркеров восемь, а не четыре: через эту функцию ходят и планировщик курса, и
# рецензент, и нормализация цели. Брошенный вызов продолжает жить в своём треде,
# пока провайдер не закроет соединение, — и занимает слот всё это время.
_JSON_MODEL_EXECUTOR = concurrent.futures.ThreadPoolExecutor(
    max_workers=8, thread_name_prefix="text-llm-json"
)
# Запас поверх собственного таймаута клиента: сначала должен сработать штатный
# путь с внятной ошибкой провайдера, и только если он промолчал — жёсткий backstop.
_WALL_CLOCK_GRACE_SECONDS = 5


# Модели с обязательным рассуждением. На `enabled: false` OpenRouter отвечает 400
# («Reasoning is mandatory for this endpoint»), а без уровня берёт самый дорогой, `max`.
# Поэтому для них уровень указывается всегда. `medium` у них нет: только эти три.
_MANDATORY_REASONING_PREFIXES = ("z-ai/glm-5", "~z-ai/glm")
_MANDATORY_REASONING_EFFORTS = ("low", "high", "max")


def has_mandatory_reasoning(model: str) -> bool:
    return (model or "").startswith(_MANDATORY_REASONING_PREFIXES)


def reasoning_options(model: str, *, enabled: bool = True, effort: str | None = None) -> dict[str, Any]:
    """Блок `reasoning` в той форме, которую эта модель примет.

    Просьба не думать или неизвестный уровень у модели с обязательным рассуждением
    означают самый дешёвый уровень: это ближайшее к просьбе, что она умеет.
    """
    if has_mandatory_reasoning(model):
        return {"effort": effort if enabled and effort in _MANDATORY_REASONING_EFFORTS else "low"}
    options: dict[str, Any] = {"enabled": bool(enabled)}
    if enabled and effort:
        options["effort"] = effort
    return options


def default_reasoning_body(model: str) -> dict[str, Any]:
    """`extra_body` для вызова, который уровень сам не выбирает. У обычных моделей ничего не меняет."""
    return {"reasoning": reasoning_options(model)} if has_mandatory_reasoning(model) else {}


def private_provider_body(base_url: str | None = None) -> dict[str, Any]:
    """Запрос с данными ученика идёт только туда, где их не хранят и на них не учатся.

    Запасного пути нет намеренно: лучше «Тьютор сейчас не отвечает», чем данные ребёнка на
    чужом хостинге. Выключается только настройкой `AI_TEXT_ZDR`. `base_url` нужен тем, кто
    ходит не через общий адрес текстовых моделей, например эмбеддингам.
    """
    if not AI_TEXT_ZDR or provider_from_base_url(base_url or TEXT_LLM_BASE_URL) != "openrouter":
        return {}
    return {"provider": {"zdr": True}}


class TextLLMNotConfigured(RuntimeError):
    """Ключ провайдера не задан — вызывать модель нечем."""


@dataclass(frozen=True)
class ToolCallEvent:
    """Модель зовёт инструмент. Идёт в потоке рядом с текстом: ученик видит, что сейчас происходит."""

    name: str


def _collect_tool_deltas(pending: dict[int, dict], deltas: Any) -> None:
    """Вызов инструмента приезжает кусками: имя в первой дельте, аргументы дописываются до конца."""
    for delta in deltas or []:
        index = getattr(delta, "index", None)
        slot = pending.setdefault(index if index is not None else len(pending), {"id": "", "name": "", "arguments": ""})
        slot["id"] = getattr(delta, "id", None) or slot["id"]
        function = getattr(delta, "function", None)
        if function is None:
            continue
        slot["name"] = getattr(function, "name", None) or slot["name"]
        slot["arguments"] += getattr(function, "arguments", None) or ""


def _collect_reasoning(details: list[dict], deltas: Any) -> None:
    """Рассуждение тоже идёт кусками. Модели отдаём его обратно: так советует OpenRouter для кругов с инструментами."""
    for delta in deltas or []:
        row = delta if isinstance(delta, dict) else getattr(delta, "model_dump", lambda: None)()
        if not isinstance(row, dict):
            continue
        same = next(
            (item for item in details if item.get("index") == row.get("index") and item.get("type") == row.get("type")),
            None,
        )
        if same is None:
            details.append(dict(row))
            continue
        for key, value in row.items():
            if key in ("text", "summary", "data") and isinstance(value, str):
                same[key] = (same.get(key) or "") + value
            elif value is not None:
                same[key] = value


def _without_reasoning(messages: list[dict]) -> list[dict]:
    return [{key: value for key, value in message.items() if key != "reasoning_details"} for message in messages]


class _TextResponse:
    """Минимальный аналог ответа google-generativeai: важен только `.text`."""

    __slots__ = ("text",)

    def __init__(self, text: str) -> None:
        self.text = text


class TextModel:
    """Drop-in замена genai.GenerativeModel для текстовых задач."""

    def __init__(self, model: str | None = None, *, temperature: float = 0.7) -> None:
        self.model = model or TEXT_LLM_MODEL
        self.temperature = temperature

    def generate_content(self, prompt: str) -> _TextResponse:
        if not TEXT_LLM_API_KEY:
            raise TextLLMNotConfigured(
                "OPENROUTER_API_KEY (или TEXT_LLM_API_KEY) не задан — "
                "текстовые AI-функции работать не будут."
            )

        client = OpenAI(api_key=TEXT_LLM_API_KEY, base_url=TEXT_LLM_BASE_URL, max_retries=0)
        logger.info("[text_llm] запрос к %s", self.model)
        response = client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=TEXT_LLM_MAX_TOKENS,
            temperature=self.temperature,
            timeout=TEXT_LLM_TIMEOUT,
            **(
                {"extra_body": extra_body}
                if (extra_body := {**default_reasoning_body(self.model), **private_provider_body()})
                else {}
            ),
        )
        record_model_usage(
            response,
            model=self.model,
            provider=provider_from_base_url(TEXT_LLM_BASE_URL),
            input_payload=prompt,
        )
        return _TextResponse(response.choices[0].message.content or "")

    def stream_content(
        self,
        messages: list[dict],
        *,
        max_tokens: int = 1200,
        timeout: int = 90,
        feature: str = "text_stream",
        reasoning_effort: str | None = None,
        on_usage: Callable[[UsageNumbers], None] | None = None,
        tools: list[dict] | Callable[[], list[dict]] | None = None,
        run_tool: Callable[[str, dict], dict] | None = None,
        max_tool_rounds: int = 5,
    ):
        """Отдаёт ответ по мере генерации. Генератор кусочков текста.

        Нужен там, где ученик ждёт вживую: боковая панель молчит 20–60 секунд,
        если печатать ответ целиком в конце.

        Отдельного клиента для стрима не заводим — тот же ключ, тот же адрес и
        та же модель, что у остальных текстовых вызовов. `BOARD_LLM_*` это
        доска, и её настройки сюда не относятся.

        Рассуждение по умолчанию на минимуме. Его токены списываются из `max_tokens`, поэтому
        лимит на вызове должен оставлять место и ответу. Текст рассуждения приходит в
        `delta.reasoning`, и наружу он не идёт (CLAUDE.md §5.8).

        С `tools` и `run_tool` модель может звать инструменты. Тогда в потоке рядом с текстом
        идут `ToolCallEvent`, а результат возвращается модели. Кругов не больше `max_tool_rounds`:
        на последнем она обязана ответить словами, потому что каждый круг это оплаченный запрос.
        `on_usage` срабатывает на каждом круге. `run_tool` не должен бросать исключений. Функция
        в `tools` читается заново перед каждым кругом: набор инструментов может вырасти.
        """
        if not TEXT_LLM_API_KEY:
            raise TextLLMNotConfigured(
                "OPENROUTER_API_KEY (или TEXT_LLM_API_KEY) не задан — "
                "текстовые AI-функции работать не будут."
            )

        client = OpenAI(
            api_key=TEXT_LLM_API_KEY, base_url=TEXT_LLM_BASE_URL, max_retries=0
        )
        logger.info("[text_llm] поток от %s (%s)", self.model, feature)
        reasoning = reasoning_options(self.model, enabled=bool(reasoning_effort), effort=reasoning_effort)

        def open_stream(history: list[dict], offered: list[dict], *, force_text: bool = False):
            tool_options: dict[str, Any] = {}
            if offered:
                tool_options["tools"] = offered
                if force_text:
                    tool_options["tool_choice"] = "none"
            return client.chat.completions.create(
                model=self.model,
                messages=history,
                max_tokens=max_tokens,
                temperature=self.temperature,
                timeout=timeout,
                stream=True,
                # Без include_usage последний чанк приходит без usage, и учёт
                # токенов для стримящего пути молча обнуляется — это уже было
                # пройдено в `skills/router.py`.
                stream_options={"include_usage": True},
                # `usage.include` просит у OpenRouter ещё и цену этого запроса.
                extra_body={"reasoning": reasoning, "usage": {"include": True}, **private_provider_body()},
                **tool_options,
            )

        conversation = list(messages)
        read_tools = tools if callable(tools) else lambda: tools or []
        uses_tools = bool(run_tool and read_tools())
        last_round = max_tool_rounds if uses_tools else 0
        offered: list[dict] = []
        said_anything = False

        for round_index in range(last_round + 1):
            force_text = round_index == last_round
            if uses_tools:
                offered = list(read_tools())
            try:
                stream = open_stream(conversation, offered, force_text=force_text)
            except BadRequestError as exc:
                if not offered:
                    raise
                # Чат не должен падать из-за инструментов: на первом круге отвечаем без них,
                # а дальше повторяем без того, что провайдер мог не принять.
                logger.warning("[text_llm] %s не принял запрос с инструментами (круг %s): %s", self.model, round_index, exc)
                if round_index == 0:
                    uses_tools = False
                    offered = []
                    stream = open_stream(conversation, offered)
                else:
                    conversation = _without_reasoning(conversation)
                    stream = open_stream(conversation, offered)

            usage_chunk = None
            pending: dict[int, dict] = {}
            reasoning_details: list[dict] = []
            round_text = ""
            for chunk in stream:
                if getattr(chunk, "usage", None):
                    # Чанк с usage приходит последним и НЕ содержит choices.
                    usage_chunk = chunk
                choices = getattr(chunk, "choices", None)
                if not choices:
                    continue
                delta = getattr(choices[0], "delta", None)
                if not delta:
                    continue
                content = getattr(delta, "content", None)
                if content:
                    # Сказала что-то перед инструментом, а теперь отвечает: это разные абзацы.
                    if said_anything and not round_text:
                        yield "\n\n"
                    round_text += content
                    said_anything = True
                    yield content
                if offered:
                    _collect_tool_deltas(pending, getattr(delta, "tool_calls", None))
                    _collect_reasoning(reasoning_details, getattr(delta, "reasoning_details", None))

            if usage_chunk is not None:
                record_model_usage(
                    usage_chunk,
                    model=self.model,
                    provider=provider_from_base_url(TEXT_LLM_BASE_URL),
                    feature=feature,
                    input_payload=conversation,
                )
                if on_usage is not None:
                    on_usage(extract_usage(usage_chunk, input_payload=conversation))

            calls = [
                {**pending[index], "id": pending[index]["id"] or f"call_{round_index}_{index}"}
                for index in sorted(pending)
                if pending[index]["name"]
            ]
            if not calls or not offered or round_index == last_round:
                return

            assistant_message: dict[str, Any] = {
                "role": "assistant",
                "content": round_text,
                "tool_calls": [
                    {
                        "id": call["id"],
                        "type": "function",
                        "function": {"name": call["name"], "arguments": call["arguments"] or "{}"},
                    }
                    for call in calls
                ],
            }
            if reasoning_details:
                assistant_message["reasoning_details"] = reasoning_details
            conversation.append(assistant_message)

            for call in calls:
                yield ToolCallEvent(call["name"])
                try:
                    arguments = json.loads(call["arguments"] or "{}")
                except (TypeError, ValueError):
                    arguments = {}
                result = run_tool(call["name"], arguments if isinstance(arguments, dict) else {})
                conversation.append(
                    {
                        "role": "tool",
                        "tool_call_id": call["id"],
                        "content": json.dumps(result, ensure_ascii=False, default=str),
                    }
                )

    def generate_json_content(
        self,
        *,
        system_prompt: str,
        payload: dict[str, Any],
        timeout: int,
        max_tokens: int,
        reasoning_enabled: bool = True,
        reasoning_effort: str | None = None,
        feature: str = "structured_text",
        json_schema: dict[str, Any] | None = None,
        schema_name: str = "response",
        providers: Sequence[str] | None = None,
        private: bool = False,
    ) -> _TextResponse:
        """Request a compact JSON object through the existing OpenRouter client.

        Provider-side JSON mode improves compliance, but callers still have to
        validate every field.  This helper deliberately returns text rather
        than trusting model output as a Python object.

        ``reasoning_effort`` ("low"/"medium"/"high") caps the OpenRouter
        reasoning token budget without disabling reasoning outright. Without
        it, a narrow or ambiguous prompt can make the model "think" for most
        of ``max_tokens``, leaving nothing for the JSON body — see
        ``skills/board.py`` where this was measured directly (2735 of 3000
        tokens burned on reasoning alone).

        ``json_schema`` upgrades JSON mode to strict structured outputs, which
        removes the whole class of "model returned a synonym instead of the
        enum value". Not every provider behind a model implements it, so it is
        meaningful only together with ``providers``.

        ``providers`` pins the OpenRouter routing pool by provider slug. It
        exists because the obvious alternative — ``provider.require_parameters``
        — was measured to be actively harmful for ``minimax/minimax-m3``: it
        routed to the slowest strict-capable provider every single time
        (175–244 s per call) and never picked the fastest one, even when asked
        for it explicitly through ``order``. An explicit allow-list gives the
        same guarantee (nobody in the pool can silently ignore the schema) and
        leaves ``sort`` free to do its job: the same request completed in 57 s.
        Prices across such an allow-list are expected to be equal, so throughput
        is the only axis left worth sorting on.

        The call runs in a worker thread with a hard wall-clock deadline; see
        ``_JSON_MODEL_EXECUTOR``. On expiry this raises ``TimeoutError`` while
        the abandoned request keeps running until the provider drops it — and
        still records its own usage, so nothing is spent unaccounted.
        """
        if not TEXT_LLM_API_KEY:
            raise TextLLMNotConfigured(
                "OPENROUTER_API_KEY (или TEXT_LLM_API_KEY) не задан — "
                "текстовые AI-функции работать не будут."
            )

        messages = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            },
        ]
        reasoning = reasoning_options(self.model, enabled=reasoning_enabled, effort=reasoning_effort)

        if json_schema is not None:
            response_format: dict[str, Any] = {
                "type": "json_schema",
                "json_schema": {
                    "name": schema_name,
                    "strict": True,
                    "schema": json_schema,
                },
            }
        else:
            response_format = {"type": "json_object"}

        extra_body: dict[str, Any] = {"reasoning": reasoning}
        routing: dict[str, Any] = {}
        if providers:
            routing.update(only=list(providers), sort="throughput")
        if private:
            # По просьбе, а не всегда: разбор книг идёт моделями, у которых таких хостингов может не быть.
            routing.update(private_provider_body().get("provider", {}))
        if routing:
            extra_body["provider"] = routing

        logger.info("[text_llm] JSON-запрос к %s (%s)", self.model, feature)
        # Контекст копируется явно: `ThreadPoolExecutor` создаёт тред с ПУСТЫМ
        # набором ContextVar, а `record_model_usage` берёт из него e-mail и
        # feature (`usage.current_usage_context`). Без этой строки весь расход
        # планировщика писался бы как анонимный и не списывался бы с квоты.
        context = contextvars.copy_context()
        future = _JSON_MODEL_EXECUTOR.submit(
            context.run,
            functools.partial(
                self._create_json_completion,
                messages=messages,
                max_tokens=max_tokens,
                timeout=timeout,
                response_format=response_format,
                extra_body=extra_body,
                feature=feature,
            ),
        )
        return _TextResponse(future.result(timeout=timeout + _WALL_CLOCK_GRACE_SECONDS))

    def _create_json_completion(
        self,
        *,
        messages: list[dict[str, str]],
        max_tokens: int,
        timeout: int,
        response_format: dict[str, Any],
        extra_body: dict[str, Any],
        feature: str,
    ) -> str:
        """Сетевой вызов и учёт расхода — то, что живёт в отдельном треде.

        Учёт намеренно внутри: если внешний backstop уже сдался, токены всё
        равно потрачены, и `AIUsageEvent` должен появиться.
        """
        client = OpenAI(
            api_key=TEXT_LLM_API_KEY,
            base_url=TEXT_LLM_BASE_URL,
            max_retries=0,
        )
        response = client.chat.completions.create(
            model=self.model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=self.temperature,
            timeout=timeout,
            response_format=response_format,
            extra_body=extra_body,
        )
        text = response.choices[0].message.content or ""
        record_model_usage(
            response,
            model=self.model,
            provider=provider_from_base_url(TEXT_LLM_BASE_URL),
            feature=feature,
            input_payload=messages,
            output_payload=text,
        )
        return text


def get_text_model(temperature: float = 0.7) -> TextModel:
    return TextModel(temperature=temperature)


def is_configured() -> bool:
    return bool(TEXT_LLM_API_KEY)
