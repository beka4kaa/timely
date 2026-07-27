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

import logging
import os
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
        feature: str = "structured_text",
    ) -> _TextResponse:
        """Request a compact JSON object through the existing OpenRouter client.

        Provider-side JSON mode improves compliance, but callers still have to
        validate every field.  This helper deliberately returns text rather
        than trusting model output as a Python object.
        """
        if not TEXT_LLM_API_KEY:
            raise TextLLMNotConfigured(
                "OPENROUTER_API_KEY (или TEXT_LLM_API_KEY) не задан — "
                "текстовые AI-функции работать не будут."
            )

        import json

        client = OpenAI(
            api_key=TEXT_LLM_API_KEY,
            base_url=TEXT_LLM_BASE_URL,
            max_retries=0,
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            },
        ]
        logger.info("[text_llm] JSON-запрос к %s (%s)", self.model, feature)
        response = client.chat.completions.create(
            model=self.model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=self.temperature,
            timeout=timeout,
            response_format={"type": "json_object"},
            extra_body={"reasoning": {"enabled": bool(reasoning_enabled)}},
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
        return _TextResponse(text)


def get_text_model(temperature: float = 0.7) -> TextModel:
    return TextModel(temperature=temperature)


def is_configured() -> bool:
    return bool(TEXT_LLM_API_KEY)
