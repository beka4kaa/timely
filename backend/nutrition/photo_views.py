"""
nutrition/photo_views.py
────────────────────────────────────────────────────────────────────
POST /api/nutrition/analyze-photo/
  Body: { "image": "data:image/jpeg;base64,<...>" }
  Оценка еды по фото через Gemini vision (gemini-2.0-flash) — та же
  библиотека google-generativeai и ключ GEMINI_API_KEY, что у остального
  AI в проекте (см. ai_engine/services.py).

  Ответ: { "items": [ {name, emoji, grams, kcal, protein, fat, carbs}, ... ] }
  где БЖУ — НА 100 Г, а grams — оценка порции на фото (фронтенд подставит
  её в PortionPicker, пользователь поправит).
"""

import base64
import json
import logging
import os
import re

import google.generativeai as genai
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

logger = logging.getLogger(__name__)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# Модель для vision. По умолчанию gemini-2.5-flash: у бесплатного tier есть
# квота на неё (проверено), тогда как у gemini-2.0-flash free-лимит = 0.
# Переопределяется через GEMINI_VISION_MODEL.
VISION_MODEL = os.getenv("GEMINI_VISION_MODEL", "gemini-2.5-flash")

_PROMPT = (
    "Ты — нутрициолог. Определи еду на фото и оцени её пищевую ценность.\n"
    "Верни СТРОГО JSON без markdown по схеме:\n"
    '{"items":[{"name":"<краткое название на русском>","emoji":"<1 эмодзи еды>",'
    '"grams":<оценка порции на фото, целое число г>,'
    '"kcal":<на 100 г>,"protein":<на 100 г>,"fat":<на 100 г>,"carbs":<на 100 г>}]}\n'
    "Правила:\n"
    "- kcal/protein/fat/carbs — строго НА 100 ГРАММ продукта.\n"
    "- grams — твоя оценка размера ВИДИМОЙ на фото порции.\n"
    "- Если на фото несколько разных блюд — перечисли каждое (максимум 5).\n"
    "- Если еду распознать нельзя — верни {\"items\":[]}.\n"
    "- Названия краткие, на русском. Только JSON, ничего больше."
)

_DATA_URL_RE = re.compile(r"^data:(?P<mime>image/[\w.+-]+);base64,(?P<b64>.+)$", re.DOTALL)


def _parse_json(text: str):
    cleaned = (text or "").replace("```json", "").replace("```", "").strip()
    try:
        return json.loads(cleaned)
    except Exception:
        s, e = cleaned.find("{"), cleaned.rfind("}")
        if s != -1 and e != -1 and e > s:
            try:
                return json.loads(cleaned[s : e + 1])
            except Exception:
                return None
    return None


def _num(v, default=0.0):
    try:
        n = float(v)
        return round(n, 1) if n > 0 else default
    except (TypeError, ValueError):
        return default


class AnalyzePhotoView(APIView):
    """Оценка БЖУ еды по фотографии (Gemini vision)."""

    def post(self, request):
        if not GEMINI_API_KEY:
            return Response(
                {"error": "Фото-анализ не настроен: задайте GEMINI_API_KEY в окружении бэкенда."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        image = (request.data.get("image") or "").strip()
        m = _DATA_URL_RE.match(image)
        if not m:
            return Response(
                {"error": "Ожидается data URL картинки (image/...;base64,...)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            raw = base64.b64decode(m.group("b64"))
        except Exception:
            return Response({"error": "Не удалось декодировать изображение."},
                            status=status.HTTP_400_BAD_REQUEST)

        try:
            model = genai.GenerativeModel(VISION_MODEL)
            result = model.generate_content([
                _PROMPT,
                {"mime_type": m.group("mime"), "data": raw},
            ])
            parsed = _parse_json(result.text)
        except Exception as exc:  # noqa: BLE001
            logger.error("[PhotoAnalyze] Gemini failed: %s", exc, exc_info=True)
            return Response(
                {"error": "ИИ не смог обработать фото. Попробуйте ещё раз."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        if not isinstance(parsed, dict) or not isinstance(parsed.get("items"), list):
            return Response({"items": []})

        items = []
        for it in parsed["items"][:5]:
            if not isinstance(it, dict):
                continue
            name = str(it.get("name") or "").strip()[:120]
            kcal = _num(it.get("kcal"))
            if not name or kcal <= 0:
                continue
            items.append({
                "name": name,
                "emoji": str(it.get("emoji") or "🍽")[:8],
                "grams": int(_num(it.get("grams"), 100)) or 100,
                "kcal": kcal,
                "protein": _num(it.get("protein")),
                "fat": _num(it.get("fat")),
                "carbs": _num(it.get("carbs")),
            })

        return Response({"items": items})
