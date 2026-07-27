import os
import logging
from openai import OpenAI
from django.conf import settings
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from .usage import (
    provider_from_base_url,
    record_model_usage,
)

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# Reasoning LLM for /solve and the whiteboard board generation.
#
# Switched from the OpenRouter cloud Llama (meta-llama/llama-3.3-70b-instruct)
# to the local Qwen VLM already running on :8080 (settings.QWEN_*). One model
# now serves both text and vision, so we don't run/pay for a second model —
# saves resources. The endpoint is whatever QWEN_API_BASE_URL points at (Mac
# Studio over Tailscale by default; set it to http://localhost:8080/v1 to use a
# locally-running Qwen). Override just this LLM with BOARD_LLM_* env vars; to
# revert to OpenRouter set BOARD_LLM_BASE_URL=https://openrouter.ai/api/v1 +
# BOARD_LLM_API_KEY=<key> + BOARD_LLM_MODEL=meta-llama/llama-3.3-70b-instruct.
# ──────────────────────────────────────────────────────────────────────────────
BOARD_LLM_BASE_URL = os.getenv("BOARD_LLM_BASE_URL", settings.QWEN_API_BASE_URL)
BOARD_LLM_API_KEY = os.getenv("BOARD_LLM_API_KEY", settings.QWEN_API_KEY)
BOARD_LLM_MODEL = os.getenv("BOARD_LLM_MODEL", settings.QWEN_MODEL_NAME)

# OpenAI-compatible client. max_retries=0 → fail fast instead of silently
# retrying (a single slow generation otherwise balloons past 2-3 minutes).
board_llm_client = OpenAI(
    api_key=BOARD_LLM_API_KEY,
    base_url=BOARD_LLM_BASE_URL,
    max_retries=0,
)

# Backwards-compatible aliases (draw_views imports these names).
openrouter_client = board_llm_client
OPENROUTER_MODEL = BOARD_LLM_MODEL

SYSTEM_PROMPT = """Ты — опытный AI-тьютор и репетитор. Твоя задача — помогать ученикам анализировать задачи и генерировать подробные решения.

Правила:
1. Решай задачу пошагово, объясняя каждый шаг.
2. Используй математическую нотацию когда нужно.
3. Если задача неоднозначна — уточни, но всё равно предложи наиболее вероятное решение.
4. Отвечай на том языке, на котором написана задача (русский или английский).
5. Будь кратким, но понятным. Не лей воду.
6. Если получаешь изображение текста (OCR результат) — восстанови задачу и реши её.
"""


class SolveTaskView(APIView):
    """
    POST /api/ai/solve/
    Body: { "message": "текст задачи", "history": [...] }
    Returns: { "reply": "решение от AI" }
    """

    def post(self, request):
        data = request.data
        user_message = data.get("message", "").strip()
        history = data.get("history", [])  # Optional chat history

        if not user_message:
            return Response(
                {"error": "Пустое сообщение. Напишите задачу."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Build messages for the API
        messages = [{"role": "system", "content": SYSTEM_PROMPT}]

        # Append previous history (if any)
        for msg in history[-10:]:  # Limit to last 10 messages to stay within context
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": content})

        # Append current user message
        messages.append({"role": "user", "content": user_message})

        try:
            logger.info(f"Sending request to board LLM ({OPENROUTER_MODEL})")
            response = openrouter_client.chat.completions.create(
                model=OPENROUTER_MODEL,
                messages=messages,
                max_tokens=1500,
                temperature=0.7,
                timeout=120,
                # GLM-4.6V — thinking-модель: по умолчанию тратит сотни токенов
                # на внутренний `reasoning` до `content`. Для чат-ответа это
                # чистые потери — замерено на «2+2»: 144 токена / 3.9с с
                # reasoning против 30 токенов / 2.0с без него (14x дешевле).
                # Визуальный путь (draw_views) reasoning сохраняет — там модель
                # строит структурированный board JSON и думать ей нужно.
                extra_body={"reasoning": {"enabled": False}},
            )
            record_model_usage(
                response,
                model=OPENROUTER_MODEL,
                provider=provider_from_base_url(BOARD_LLM_BASE_URL),
                feature="solve",
                input_payload=messages,
            )

            reply = response.choices[0].message.content
            if not reply:
                reply = "Не удалось получить ответ от модели. Попробуйте ещё раз."

            return Response({"reply": reply.strip(), "model": OPENROUTER_MODEL})

        except Exception as e:
            error_msg = str(e)
            logger.error(f"OpenRouter API error: {error_msg}", exc_info=True)

            if "429" in error_msg:
                return Response(
                    {"error": "Модель временно перегружена (rate limit). Подождите 30 сек и попробуйте снова."},
                    status=status.HTTP_429_TOO_MANY_REQUESTS,
                )

            if "timeout" in error_msg.lower() or "timed out" in error_msg.lower():
                return Response(
                    {"error": "Модель не ответила за 60 секунд. Попробуйте ещё раз."},
                    status=status.HTTP_504_GATEWAY_TIMEOUT,
                )

            return Response(
                {"error": f"Ошибка AI: {error_msg}"},
                status=status.HTTP_502_BAD_GATEWAY,
            )
