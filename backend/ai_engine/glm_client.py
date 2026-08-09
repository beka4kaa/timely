"""
Shared OpenAI-compatible vision transport.

Single place where the backend talks to a vision model. Two callers today:
`ocr_views.py` (whiteboard OCR) and `canvas_analyzer.py` (Smart Canvas Analyzer).

Historically this was GLM-OCR self-hosted on the Mac Studio, hence the module
name and the `glm_*` symbols — kept as-is so the two callers and their tests do
not churn. The default is now Qwen3-VL through OpenRouter; see the VISION_*
block in `config/settings.py` for why the self-hosted default was dropped and
how to point back at a local server.

The defaults below only matter if `settings` somehow lacks the VISION_* keys;
they are kept in sync with settings.py so the two never disagree.
"""

from __future__ import annotations

import os
from functools import lru_cache

from django.conf import settings
from openai import OpenAI

from .usage import provider_from_base_url, record_model_usage


VISION_API_BASE_URL: str = getattr(
    settings,
    "VISION_API_BASE_URL",
    os.getenv("VISION_API_BASE_URL", "https://openrouter.ai/api/v1"),
)
VISION_API_KEY: str = getattr(
    settings,
    "VISION_API_KEY",
    os.getenv("VISION_API_KEY") or os.getenv("OPENROUTER_API_KEY", ""),
)
VISION_MODEL_NAME: str = getattr(
    settings,
    "VISION_MODEL_NAME",
    os.getenv("VISION_MODEL_NAME", "qwen/qwen3-vl-32b-instruct"),
)
VISION_TIMEOUT: int = int(getattr(settings, "VISION_TIMEOUT", os.getenv("VISION_TIMEOUT", "60")))
GLM_ANALYZER_MODEL_NAME: str = getattr(
    settings,
    "GLM_ANALYZER_MODEL_NAME",
    os.getenv("GLM_ANALYZER_MODEL_NAME", VISION_MODEL_NAME),
)
GLM_ANALYZER_TIMEOUT: int = int(
    getattr(settings, "GLM_ANALYZER_TIMEOUT", os.getenv("GLM_ANALYZER_TIMEOUT", "60"))
)


@lru_cache(maxsize=1)
def get_glm_client() -> OpenAI:
    # max_retries=0 намеренно. По умолчанию SDK повторяет запрос дважды, и на
    # сетевой модели с VISION_TIMEOUT=60 один зависший вызов растягивается до
    # 3 x 60 = 180 секунд при gunicorn --timeout 200 (см. Dockerfile): worker
    # умирает по SIGABRT вместе со всеми остальными запросами на нём. Пусть
    # лучше пользователь увидит честный 504 через минуту и повторит сам.
    return OpenAI(api_key=VISION_API_KEY, base_url=VISION_API_BASE_URL, max_retries=0)


def glm_chat_image(
    *,
    image_base64: str,
    user_prompt: str,
    system_prompt: str | None = None,
    model: str | None = None,
    max_tokens: int = 4000,
    timeout: int | None = None,
    feature: str = "vision_analysis",
) -> str:
    """Send one image+text chat request to the existing GLM backend."""
    messages: list[dict] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append(
        {
            "role": "user",
            "content": [
                {"type": "text", "text": user_prompt},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{image_base64}"},
                },
            ],
        }
    )
    response = get_glm_client().chat.completions.create(
        model=model or GLM_ANALYZER_MODEL_NAME,
        messages=messages,
        max_tokens=max_tokens,
        timeout=timeout or GLM_ANALYZER_TIMEOUT,
        temperature=0.0,
    )
    record_model_usage(
        response,
        model=model or GLM_ANALYZER_MODEL_NAME,
        provider=provider_from_base_url(VISION_API_BASE_URL),
        feature=feature,
        input_payload=messages,
        image_count=1,
    )
    return (response.choices[0].message.content or "").strip()
