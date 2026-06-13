"""
Shared GLM/OpenAI-compatible vision transport.

The repo already used GLM through `ocr_views.py`. This module centralizes that
same integration so Smart Canvas Analyzer can reuse it without creating a
second GLM client with slightly different settings.
"""

from __future__ import annotations

import os
from functools import lru_cache

from django.conf import settings
from openai import OpenAI


VISION_API_BASE_URL: str = getattr(
    settings,
    "VISION_API_BASE_URL",
    os.getenv("VISION_API_BASE_URL", "http://100.74.104.27:8081/v1"),
)
VISION_API_KEY: str = getattr(settings, "VISION_API_KEY", os.getenv("VISION_API_KEY", "sk-local"))
VISION_MODEL_NAME: str = getattr(
    settings,
    "VISION_MODEL_NAME",
    os.getenv("VISION_MODEL_NAME", "mlx-community/GLM-OCR-bf16"),
)
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
    return OpenAI(api_key=VISION_API_KEY, base_url=VISION_API_BASE_URL)


def glm_chat_image(
    *,
    image_base64: str,
    user_prompt: str,
    system_prompt: str | None = None,
    model: str | None = None,
    max_tokens: int = 4000,
    timeout: int | None = None,
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
    return (response.choices[0].message.content or "").strip()
