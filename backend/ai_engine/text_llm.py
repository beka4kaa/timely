"""
Текстовая LLM для учебных программ, анализа прогресса и планирования.

Было: google-generativeai (gemini-2.0-flash) напрямую по ключу GEMINI_API_KEY.
Стало: deepseek/deepseek-v4-flash через OpenRouter — тот же провайдер, что и у
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
from collections.abc import Sequence
from typing import Any

from openai import OpenAI

from .usage import provider_from_base_url, record_model_usage

logger = logging.getLogger(__name__)

TEXT_LLM_BASE_URL = os.getenv("TEXT_LLM_BASE_URL", "https://openrouter.ai/api/v1")
TEXT_LLM_API_KEY = os.getenv("TEXT_LLM_API_KEY", os.getenv("OPENROUTER_API_KEY", ""))
TEXT_LLM_MODEL = os.getenv("TEXT_LLM_MODEL", "deepseek/deepseek-v4-flash")
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


class TextLLMNotConfigured(RuntimeError):
    """Ключ провайдера не задан — вызывать модель нечем."""


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
        )
        record_model_usage(
            response,
            model=self.model,
            provider=provider_from_base_url(TEXT_LLM_BASE_URL),
            input_payload=prompt,
        )
        return _TextResponse(response.choices[0].message.content or "")

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
        reasoning: dict[str, Any] = {"enabled": bool(reasoning_enabled)}
        if reasoning_enabled and reasoning_effort:
            reasoning["effort"] = reasoning_effort

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
        if providers:
            extra_body["provider"] = {
                "only": list(providers),
                "sort": "throughput",
            }

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
