"""
nutrition/photo_views.py
────────────────────────────────────────────────────────────────────
POST /api/nutrition/analyze-photo/
  Body: { "image": "data:image/jpeg;base64,<...>" }
  Оценка еды по фото через vision-модель. По умолчанию auto выбирает
  Groq vision → OpenRouter vision router → Gemini. Можно зафиксировать через
  NUTRITION_PHOTO_PROVIDER=groq|openrouter|gemini.

  Модель распознаёт класс/название. Вес порции стабилизируется локальным
  OpenCV estimator, а БЖУ известных классов — локальным baseline-каталогом.
  LLM-граммы используются только legacy/fallback режимом.

  Ответ: { "items": [ {name, identified_class, grams, default_catalog_weight,
    completeness_ratio, kcal, protein, fat, carbs}, ... ] }
  где БЖУ — НА 100 Г, а grams — deterministic оценка видимой порции на фото.
"""

import base64
import copy
import hashlib
import json
import logging
import os
import re
import time

import google.generativeai as genai
import requests
from django.conf import settings
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .portion_estimator import estimate_food_portion

logger = logging.getLogger(__name__)

PHOTO_PROVIDER = os.getenv("NUTRITION_PHOTO_PROVIDER", "auto").strip().lower()
GROQ_API_URL = os.getenv(
    "NUTRITION_GROQ_API_URL",
    "https://api.groq.com/openai/v1/chat/completions",
)
GROQ_API_KEY = os.getenv(
    "NUTRITION_GROQ_API_KEY",
    os.getenv("GROQ_API_KEY", ""),
)
GROQ_MODEL = os.getenv("NUTRITION_GROQ_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct")
GROQ_FALLBACK_MODELS = os.getenv(
    "NUTRITION_GROQ_FALLBACK_MODELS",
    "meta-llama/llama-4-scout-17b-16e-instruct",
)
OPENROUTER_API_URL = os.getenv(
    "NUTRITION_OPENROUTER_API_URL",
    getattr(settings, "IMAGE_GEN_API_URL", "https://openrouter.ai/api/v1/chat/completions"),
)
OPENROUTER_API_KEY = os.getenv(
    "NUTRITION_OPENROUTER_API_KEY",
    os.getenv("OPENROUTER_API_KEY", ""),
)
OPENROUTER_MODEL = os.getenv("NUTRITION_OPENROUTER_MODEL", "openrouter/free")
OPENROUTER_FALLBACK_MODELS = os.getenv(
    "NUTRITION_OPENROUTER_FALLBACK_MODELS",
    "google/gemma-4-26b-a4b-it:free,nvidia/nemotron-nano-12b-v2-vl:free,nex-agi/nex-n2-pro:free",
)
TEXT_ONLY_OPENROUTER_MODELS = {
    "openai/gpt-oss-120b:free",
    "openai/gpt-oss-120b",
    "z-ai/glm-5.1",
}
PORTION_STRATEGY = os.getenv("NUTRITION_PORTION_STRATEGY", "hybrid").strip().lower()
# Cache is opt-in. It saves latency/cost, but must not be used to hide model
# uncertainty while debugging food recognition quality.
PHOTO_CACHE_SECONDS = int(os.getenv("NUTRITION_PHOTO_CACHE_SECONDS", "0"))
PHOTO_CACHE_MAX = int(os.getenv("NUTRITION_PHOTO_CACHE_MAX", "64"))
PROMPT_VERSION = "nutrition-photo-v2-stable-portion"
_PHOTO_ANALYSIS_CACHE: dict[str, tuple[float, dict]] = {}

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

# Модель для vision. По умолчанию gemini-2.5-flash: у бесплатного tier есть
# квота на неё (проверено), тогда как у gemini-2.0-flash free-лимит = 0.
# Переопределяется через GEMINI_VISION_MODEL.
VISION_MODEL = os.getenv("GEMINI_VISION_MODEL", "gemini-2.5-flash")
VISION_TIMEOUT = float(os.getenv("NUTRITION_VISION_TIMEOUT", os.getenv("GEMINI_VISION_TIMEOUT", "28")))

_PROMPT = (
    "Ты — классификатор еды на фото. Определи, что это за еда.\n"
    "Верни СТРОГО JSON без markdown по схеме:\n"
    '{"items":[{"name":"<краткое название на русском>","emoji":"<1 эмодзи еды>",'
    '"identified_class":"<canonical english food class, e.g. bagel/apple/pizza_slice>",'
    '"default_grams":<типичный вес ЦЕЛОГО стандартного экземпляра или порции, г>,'
    '"kcal":<на 100 г>,"protein":<на 100 г>,"fat":<на 100 г>,"carbs":<на 100 г>}]}\n'
    "Правила:\n"
    "- kcal/protein/fat/carbs — строго НА 100 ГРАММ продукта.\n"
    "- default_grams — вес целого стандартного экземпляра/порции из каталога.\n"
    "- НЕ оценивай финальные калории порции и НЕ угадывай видимые граммы: сервер отдельно считает видимую часть по пикселям.\n"
    "- Если на фото несколько разных блюд — перечисли каждое (максимум 5).\n"
    "- Если еду распознать нельзя — верни {\"items\":[]}.\n"
    "- Названия краткие, на русском. Только JSON, ничего больше."
)

_NUTRITION_BASELINES_PER100 = {
    "bagel": {"kcal": 270.0, "protein": 10.0, "fat": 2.0, "carbs": 53.0},
    "donut": {"kcal": 410.0, "protein": 6.0, "fat": 22.0, "carbs": 50.0},
    "banana": {"kcal": 89.0, "protein": 1.1, "fat": 0.3, "carbs": 23.0},
    "apple": {"kcal": 52.0, "protein": 0.3, "fat": 0.2, "carbs": 14.0},
    "citrus": {"kcal": 47.0, "protein": 0.9, "fat": 0.1, "carbs": 12.0},
    "cookie": {"kcal": 480.0, "protein": 6.0, "fat": 22.0, "carbs": 65.0},
    "egg": {"kcal": 155.0, "protein": 13.0, "fat": 11.0, "carbs": 1.1},
    "bread_slice": {"kcal": 265.0, "protein": 9.0, "fat": 3.2, "carbs": 49.0},
    "croissant": {"kcal": 406.0, "protein": 8.2, "fat": 21.0, "carbs": 45.0},
    "pizza_slice": {"kcal": 266.0, "protein": 11.0, "fat": 10.0, "carbs": 33.0},
    "pizza": {"kcal": 266.0, "protein": 11.0, "fat": 10.0, "carbs": 33.0},
    "burger": {"kcal": 295.0, "protein": 17.0, "fat": 14.0, "carbs": 24.0},
    "sandwich": {"kcal": 250.0, "protein": 11.0, "fat": 8.0, "carbs": 33.0},
}

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


def _ratio(v, default=0.0) -> float:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return default
    if n <= 0:
        return default
    return round(max(0.05, min(1.0, n)), 2)


def _round_grams(value: float) -> int:
    if value <= 0:
        return 0
    if value < 20:
        return max(1, int(round(value)))
    return max(5, int(round(value / 5) * 5))


def _content_to_text(content) -> str:
    """Extract text from OpenRouter/OpenAI-style message.content."""

    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                text = part.get("text")
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(parts)
    return ""


def _photo_cache_key(provider: str, raw: bytes) -> str:
    if provider == "groq":
        model_key = "|".join(_groq_models())
    elif provider == "openrouter":
        model_key = "|".join(_openrouter_models())
    else:
        model_key = VISION_MODEL
    digest = hashlib.sha256(raw).hexdigest()
    return f"{PROMPT_VERSION}:{provider}:{model_key}:{PORTION_STRATEGY}:{digest}"


def _cache_get(key: str) -> dict | None:
    cached = _PHOTO_ANALYSIS_CACHE.get(key)
    if not cached:
        return None
    expires_at, value = cached
    if expires_at <= time.monotonic():
        _PHOTO_ANALYSIS_CACHE.pop(key, None)
        return None
    return copy.deepcopy(value)


def _cache_set(key: str, value: dict) -> None:
    if PHOTO_CACHE_MAX <= 0 or PHOTO_CACHE_SECONDS <= 0:
        return
    if len(_PHOTO_ANALYSIS_CACHE) >= PHOTO_CACHE_MAX:
        oldest_key = min(_PHOTO_ANALYSIS_CACHE, key=lambda k: _PHOTO_ANALYSIS_CACHE[k][0])
        _PHOTO_ANALYSIS_CACHE.pop(oldest_key, None)
    _PHOTO_ANALYSIS_CACHE[key] = (time.monotonic() + PHOTO_CACHE_SECONDS, copy.deepcopy(value))


def _nutrition_for_class(identified_class: str) -> tuple[dict[str, float] | None, str, float]:
    key = (identified_class or "").strip().lower()
    nutrition = _NUTRITION_BASELINES_PER100.get(key)
    if nutrition:
        return nutrition, "catalog_baseline", 0.86
    return None, "vision_model", 0.52


def _openrouter_models() -> list[str]:
    models: list[str] = []
    for value in [OPENROUTER_MODEL, *OPENROUTER_FALLBACK_MODELS.split(",")]:
        model = value.strip()
        if model and model not in models:
            models.append(model)
    return models


def _groq_models() -> list[str]:
    models: list[str] = []
    for value in [GROQ_MODEL, *GROQ_FALLBACK_MODELS.split(",")]:
        model = value.strip()
        if model and model not in models:
            models.append(model)
    return models


def _is_model_unavailable(exc: requests.HTTPError, *markers: str) -> bool:
    response = getattr(exc, "response", None)
    status_code = getattr(response, "status_code", None)
    body = getattr(response, "text", "") or ""
    lowered = body.lower()
    return status_code in {400, 404, 429} and any(marker in lowered for marker in markers)


def _call_openai_compatible_vision(
    *,
    api_url: str,
    api_key: str,
    provider: str,
    model_name: str,
    image_data_url: str,
    raw_size: int,
    extra_headers: dict[str, str] | None = None,
    token_limit_field: str = "max_tokens",
    response_format: dict[str, str] | None = None,
) -> dict | None:
    if not api_key:
        raise ValueError(f"{provider} API key не задан.")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        **(extra_headers or {}),
    }
    payload = {
        "model": model_name,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _PROMPT},
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                ],
            }
        ],
        "temperature": 0,
        token_limit_field: 900,
    }
    if response_format:
        payload["response_format"] = response_format

    logger.info(
        "[PhotoAnalyze] start provider=%s model=%s bytes=%d timeout=%.1fs",
        provider,
        model_name,
        raw_size,
        VISION_TIMEOUT,
    )
    resp = requests.post(api_url, headers=headers, json=payload, timeout=VISION_TIMEOUT)
    if resp.status_code >= 400:
        logger.warning(
            "[PhotoAnalyze] %s model=%s failed (%s): %.500s",
            provider,
            model_name,
            resp.status_code,
            resp.text,
        )
    resp.raise_for_status()
    data = resp.json()
    message = ((data.get("choices") or [{}])[0].get("message") or {})
    return _parse_json(_content_to_text(message.get("content")))


def _call_groq(image_data_url: str, raw_size: int) -> tuple[dict | None, str]:
    if not GROQ_API_KEY:
        raise ValueError("GROQ_API_KEY не задан.")

    last_exc: Exception | None = None
    for model_name in _groq_models():
        try:
            parsed = _call_openai_compatible_vision(
                api_url=GROQ_API_URL,
                api_key=GROQ_API_KEY,
                provider="groq",
                model_name=model_name,
                image_data_url=image_data_url,
                raw_size=raw_size,
                token_limit_field="max_completion_tokens",
                response_format={"type": "json_object"},
            )
            return parsed, model_name
        except requests.HTTPError as exc:
            last_exc = exc
            if _is_model_unavailable(exc, "model_decommissioned", "does not exist", "rate limit"):
                continue
            raise

    if last_exc:
        raise last_exc
    raise RuntimeError("No Groq models configured")


def _call_openrouter(image_data_url: str, raw_size: int) -> tuple[dict | None, str]:
    if not OPENROUTER_API_KEY:
        raise ValueError("OPENROUTER_API_KEY не задан.")

    headers = {
        "HTTP-Referer": getattr(settings, "SITE_URL", "https://timelyplan.me"),
        "X-Title": "TimelyPlan Nutrition",
    }
    last_exc: Exception | None = None
    for model_name in _openrouter_models():
        if model_name in TEXT_ONLY_OPENROUTER_MODELS:
            logger.warning(
                "[PhotoAnalyze] skipping OpenRouter model=%s because it is text-only and cannot analyze images",
                model_name,
            )
            continue

        try:
            parsed = _call_openai_compatible_vision(
                api_url=OPENROUTER_API_URL,
                api_key=OPENROUTER_API_KEY,
                provider="openrouter",
                model_name=model_name,
                image_data_url=image_data_url,
                raw_size=raw_size,
                extra_headers=headers,
            )
            return parsed, model_name
        except requests.HTTPError as exc:
            last_exc = exc
            if _is_model_unavailable(exc, "not a valid model", "not found", "unavailable", "rate limit"):
                continue
            raise

    if last_exc:
        raise last_exc
    raise RuntimeError("No OpenRouter models configured")


def _call_gemini(raw: bytes, mime_type: str) -> dict | None:
    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY не задан.")

    logger.info(
        "[PhotoAnalyze] start provider=gemini model=%s bytes=%d timeout=%.1fs",
        VISION_MODEL,
        len(raw),
        VISION_TIMEOUT,
    )
    model = genai.GenerativeModel(VISION_MODEL)
    result = model.generate_content(
        [
            _PROMPT,
            {"mime_type": mime_type, "data": raw},
        ],
        generation_config={"temperature": 0, "response_mime_type": "application/json"},
        request_options={"timeout": VISION_TIMEOUT},
    )
    return _parse_json(result.text)


def _normalize_photo_items(parsed: dict, raw: bytes) -> list[dict]:
    if not isinstance(parsed, dict) or not isinstance(parsed.get("items"), list):
        return []

    items = []
    for it in parsed["items"][:5]:
        if not isinstance(it, dict):
            continue
        name = str(it.get("name") or "").strip()[:120]
        model_kcal = _num(it.get("kcal"))
        if not name:
            continue

        portion_started_at = time.monotonic()
        identified_class = str(it.get("identified_class") or it.get("class") or "").strip()[:80]
        model_default_grams = _num(it.get("default_grams"), _num(it.get("grams"), 100)) or 100
        model_visible_grams = _num(it.get("visible_grams"), _num(it.get("grams"), 0))
        model_ratio = _ratio(it.get("completeness_ratio"))

        portion = estimate_food_portion(
            raw,
            name=name,
            identified_class=identified_class,
            model_default_grams=model_default_grams,
        )
        nutrition, nutrition_source, nutrition_confidence = _nutrition_for_class(portion.identified_class)
        if nutrition:
            kcal = nutrition["kcal"]
            protein = nutrition["protein"]
            fat = nutrition["fat"]
            carbs = nutrition["carbs"]
        else:
            kcal = model_kcal
            protein = _num(it.get("protein"))
            fat = _num(it.get("fat"))
            carbs = _num(it.get("carbs"))
            if kcal <= 0:
                continue

        if PORTION_STRATEGY == "model" and model_visible_grams:
            default_weight = int(round(model_default_grams))
            final_weight = _round_grams(model_visible_grams)
            completeness_ratio = model_ratio or _ratio(final_weight / max(1, default_weight), 1.0)
            confidence = 0.72
            source = "model_visible_grams"
        elif PORTION_STRATEGY == "model" and model_ratio:
            default_weight = int(round(model_default_grams))
            completeness_ratio = model_ratio
            final_weight = _round_grams(default_weight * completeness_ratio)
            confidence = 0.68
            source = "model_completeness_ratio"
        elif PORTION_STRATEGY == "hybrid" and portion.source != "opencv_contour" and model_visible_grams:
            default_weight = int(round(model_default_grams))
            final_weight = _round_grams(model_visible_grams)
            completeness_ratio = model_ratio or _ratio(final_weight / max(1, default_weight), 1.0)
            confidence = 0.55
            source = f"model_visible_grams_fallback:{portion.source}"
        else:
            default_weight = portion.default_catalog_weight
            final_weight = portion.final_weight
            completeness_ratio = portion.completeness_ratio
            confidence = portion.confidence
            source = portion.source

        warnings = []
        if source != "opencv_contour" or confidence < 0.65:
            warnings.append("portion_low_confidence")
        if nutrition_source == "vision_model":
            warnings.append("nutrition_model_estimate")

        logger.info(
            "[PhotoAnalyze] portion strategy=%s name=%r class=%r model_default=%sg model_visible=%sg cv_default=%sg cv_ratio=%.2f final=%sg kcal100=%s portion_source=%s nutrition_source=%s time=%.3fs",
            PORTION_STRATEGY,
            name,
            identified_class or portion.identified_class,
            model_default_grams,
            model_visible_grams,
            portion.default_catalog_weight,
            portion.completeness_ratio,
            final_weight,
            kcal,
            source,
            nutrition_source,
            time.monotonic() - portion_started_at,
        )
        items.append({
            "name": name,
            "identified_class": identified_class or portion.identified_class,
            "emoji": str(it.get("emoji") or "🍽")[:8],
            "grams": final_weight,
            "default_catalog_weight": default_weight,
            "completeness_ratio": completeness_ratio,
            "pixel_area": portion.pixel_area,
            "baseline_area": portion.baseline_area,
            "portion_confidence": confidence,
            "portion_source": source,
            "nutrition_source": nutrition_source,
            "nutrition_confidence": nutrition_confidence,
            "analysis_warnings": warnings,
            "kcal": kcal,
            "protein": protein,
            "fat": fat,
            "carbs": carbs,
        })

    return items


class AnalyzePhotoView(APIView):
    """Оценка БЖУ еды по фотографии."""

    def post(self, request):
        provider = PHOTO_PROVIDER
        if provider == "auto":
            if GROQ_API_KEY:
                provider = "groq"
            elif OPENROUTER_API_KEY:
                provider = "openrouter"
            else:
                provider = "gemini"
        if provider not in {"groq", "openrouter", "gemini"}:
            return Response(
                {"error": f"Неизвестный провайдер фото-анализа: {PHOTO_PROVIDER}."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        if provider == "groq" and not GROQ_API_KEY:
            return Response(
                {"error": "Фото-анализ Groq не настроен: задайте GROQ_API_KEY."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        if provider == "openrouter" and not OPENROUTER_API_KEY:
            return Response(
                {"error": "Фото-анализ OpenRouter не настроен: задайте OPENROUTER_API_KEY."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        if provider == "gemini" and not GEMINI_API_KEY:
            return Response(
                {"error": "Фото-анализ Gemini не настроен: задайте GEMINI_API_KEY."},
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

        cache_key = _photo_cache_key(provider, raw)
        cached = _cache_get(cache_key)
        if cached is not None:
            logger.info(
                "[PhotoAnalyze] cache hit provider=%s strategy=%s bytes=%d",
                provider,
                PORTION_STRATEGY,
                len(raw),
            )
            cached["cached"] = True
            return Response(cached)

        started_at = time.monotonic()
        try:
            if provider == "groq":
                parsed, provider_model = _call_groq(image, len(raw))
            elif provider == "openrouter":
                parsed, provider_model = _call_openrouter(image, len(raw))
            else:
                parsed = _call_gemini(raw, m.group("mime"))
                provider_model = VISION_MODEL
        except (requests.Timeout, requests.HTTPError, requests.RequestException) as exc:
            logger.error("[PhotoAnalyze] %s failed: %s", provider, exc, exc_info=True)
            message = str(exc).lower()
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            if isinstance(exc, requests.Timeout) or status_code in {408, 504} or "timeout" in message or "deadline" in message:
                return Response(
                    {"error": "Фото-анализ слишком долго обрабатывает кадр. Попробуйте ещё раз или выберите более простой/светлый кадр."},
                    status=status.HTTP_504_GATEWAY_TIMEOUT,
                )
            return Response(
                {"error": f"ИИ-провайдер не смог обработать фото ({provider}). Попробуйте ещё раз."},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("[PhotoAnalyze] %s failed: %s", provider, exc, exc_info=True)
            return Response(
                {"error": f"Фото-анализ не настроен или недоступен ({provider})."},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        logger.info(
            "[PhotoAnalyze] %s model=%s finished in %.2fs",
            provider,
            provider_model,
            time.monotonic() - started_at,
        )

        if not isinstance(parsed, dict) or not isinstance(parsed.get("items"), list):
            return Response({"items": []})

        result = {"items": _normalize_photo_items(parsed, raw)}
        _cache_set(cache_key, result)
        return Response(result)
