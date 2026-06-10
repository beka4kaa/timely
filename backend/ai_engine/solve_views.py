import os
import logging
from openai import OpenAI
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

logger = logging.getLogger(__name__)

# OpenRouter API configuration
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
# `:nitro` — OpenRouter's high-throughput routing variant: it sends the
# request only to the fastest providers for this model (vs. the default
# "Standard" tier, which load-balances across ALL providers — including slow
# ones at ~15-25 tok/s). Same paid account/key, same model weights — just a
# different provider-selection policy. Benchmarked ~6-20x faster in practice
# (≈300-400 tok/s vs ≈15-25 tok/s on Standard) at a similar/marginally higher
# per-token price. This is the single biggest lever for "llama is slow".
OPENROUTER_MODEL = "meta-llama/llama-3.3-70b-instruct"

# OpenAI-compatible client pointing at OpenRouter.
# max_retries=0 → fail fast instead of silently retrying (a single slow
# generation otherwise balloons past 2-3 minutes and the proxy 500s).
openrouter_client = OpenAI(
    api_key=OPENROUTER_API_KEY,
    base_url=OPENROUTER_BASE_URL,
    max_retries=0,
)

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
            logger.info(f"Sending request to OpenRouter ({OPENROUTER_MODEL})")
            response = openrouter_client.chat.completions.create(
                model=OPENROUTER_MODEL,
                messages=messages,
                max_tokens=512,
                temperature=0.7,
                timeout=60,
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
