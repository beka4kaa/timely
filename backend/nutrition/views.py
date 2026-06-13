"""
nutrition/views.py
────────────────────────────────────────────────────────────────────
Два публичных эндпоинта (read-only, без per-user данных):

  GET /api/nutrition/foods/?q=<запрос>&limit=<n>
      Поиск по библиотеке продуктов (FoodItem). Без q — алфавитный
      список (для «показать всё»). БЖУ на 100 г.

  GET /api/nutrition/barcode/<code>/
      Поиск продукта по штрихкоду. Сначала локальный кэш (FoodItem с
      этим barcode), иначе — прокси в Open Food Facts (бесплатно, без
      ключа), нормализация в наш формат на 100 г и кэширование.
"""

import logging
import os
import re
import time
import csv
from pathlib import Path

import requests
from datetime import date
from django.utils.dateparse import parse_date
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import viewsets

from .models import FoodItem, NutritionEntry
from .serializers import FoodItemSerializer, NutritionEntrySerializer

logger = logging.getLogger(__name__)

FOOD_CACHE_SECONDS = int(os.getenv("NUTRITION_FOOD_CACHE_SECONDS", "600"))
_FOOD_CACHE: dict[str, object] = {"loaded_at": 0.0, "items": []}
FOOD_DATA_FILE = Path(__file__).resolve().parent / "data" / "bzhu_food_database.csv"
EMOJI_BY_CATEGORY = {
    "Овощи и зелень": "🥦",
    "Фрукты и ягоды": "🍎",
    "Мясо и птица": "🍗",
    "Рыба и морепродукты": "🐟",
    "Молочные продукты и яйца": "🥛",
    "Крупы, бобовые и орехи": "🥣",
    "Готовые блюда": "🍽",
}


class NutritionEntryViewSet(viewsets.ModelViewSet):
    """Persistent per-user nutrition diary entries."""

    serializer_class = NutritionEntrySerializer

    def get_queryset(self):
        user_email = getattr(self.request, "user_email", None)
        if not user_email:
            return NutritionEntry.objects.none()

        entry_date = parse_date(self.request.query_params.get("date") or "") or date.today()
        return NutritionEntry.objects.filter(user_email=user_email, entry_date=entry_date)

    def list(self, request, *args, **kwargs):
        user_email = getattr(request, "user_email", None)
        if not user_email:
            return Response({"error": "Не удалось определить пользователя."}, status=status.HTTP_401_UNAUTHORIZED)
        return super().list(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        user_email = getattr(request, "user_email", None)
        if not user_email:
            return Response({"error": "Не удалось определить пользователя."}, status=status.HTTP_401_UNAUTHORIZED)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        entry_date = serializer.validated_data.get("entry_date") or date.today()
        serializer.save(user_email=getattr(self.request, "user_email", None), entry_date=entry_date)

# Open Food Facts — открытая бесплатная база продуктов (без API-ключа).
# v2 product endpoint; просим только нужные поля, чтобы ответ был лёгким.
OFF_URL = "https://world.openfoodfacts.org/api/v2/product/{code}.json"
OFF_FIELDS = "product_name,product_name_ru,brands,nutriments,image_front_small_url"
OFF_TIMEOUT = 8
# Вежливый User-Agent — требование OFF к клиентам их API.
OFF_HEADERS = {"User-Agent": "TimelyPlan/1.0 (nutrition tracker; contact: support@timelyplan.me)"}


class FoodSearchView(APIView):
    """GET /api/nutrition/foods/?q=&limit= — поиск по библиотеке (БЖУ на 100 г)."""

    def get(self, request):
        q = (request.query_params.get("q") or "").strip()
        try:
            limit = min(max(int(request.query_params.get("limit", 30)), 1), 100)
        except (TypeError, ValueError):
            limit = 30

        items = _food_library_items()
        if q:
            q_norm = q.casefold()
            items = [
                item for item in items
                if q_norm in item["name"].casefold() or q_norm in item["category"].casefold()
            ]
            items.sort(key=lambda item: (_food_rank(item, q_norm), item["name"].casefold()))
        return Response(items[:limit])


def _food_library_items() -> list[dict]:
    now = time.monotonic()
    loaded_at = float(_FOOD_CACHE.get("loaded_at") or 0)
    items = _FOOD_CACHE.get("items")
    if isinstance(items, list) and items and now - loaded_at < FOOD_CACHE_SECONDS:
        return items

    try:
        serialized = _read_static_food_database()
    except Exception as exc:  # noqa: BLE001
        logger.warning("[FoodSearch] static CSV failed, falling back to DB: %s", exc)
        rows = FoodItem.objects.all().order_by("name")
        serialized = list(FoodItemSerializer(rows, many=True).data)
    _FOOD_CACHE["items"] = serialized
    _FOOD_CACHE["loaded_at"] = now
    logger.info("[FoodSearch] warmed local food cache: %d items", len(serialized))
    return serialized


def _read_static_food_database() -> list[dict]:
    items = []
    with FOOD_DATA_FILE.open(encoding="utf-8-sig", newline="") as f:
        for index, row in enumerate(csv.DictReader(f, delimiter=";"), start=1):
            category = (row.get("Категория") or "").strip()
            name = (row.get("Продукт / Блюдо") or "").strip()
            if not name:
                continue
            items.append({
                "id": f"bzhu-{index}",
                "name": name,
                "emoji": EMOJI_BY_CATEGORY.get(category, "🍽"),
                "category": category,
                "kcal": _csv_num(row.get("Калории (ккал)", "0")),
                "protein": _csv_num(row.get("Белки (г)", "0")),
                "fat": _csv_num(row.get("Жиры (г)", "0")),
                "carbs": _csv_num(row.get("Углеводы (г)", "0")),
                "barcode": "",
                "source": "seed",
            })
    return sorted(items, key=lambda item: item["name"].casefold())


def _csv_num(value: str) -> float:
    try:
        return round(float((value or "0").replace(",", ".")), 1)
    except (TypeError, ValueError):
        return 0.0


def _invalidate_food_cache() -> None:
    _FOOD_CACHE["loaded_at"] = 0.0


def _food_rank(item: dict, q_norm: str) -> int:
    name = str(item.get("name") or "").casefold()
    category = str(item.get("category") or "").casefold()
    if name == q_norm:
        return 0
    if name.startswith(q_norm):
        return 1
    if category == q_norm:
        return 2
    if category and q_norm in category:
        return 3
    return 4


# Open Food Facts текстовый поиск. Проксируем через бэкенд, а НЕ зовём из
# браузера: OFF требует кастомный User-Agent (его браузер выставить не может —
# заголовок запрещён fetch), плюс так обходим CORS и нормализуем ответ.
# Debounce остаётся на фронтенде (критичное требование).
#
# Надёжность/скорость: сначала современный /api/v2/search, legacy search.pl —
# только fallback. Результаты кэшируем по запросу, чтобы повторный ввод не
# блокировался внешним API.
OFF_SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl"
OFF_SEARCH_V2_URL = "https://world.openfoodfacts.org/api/v2/search"
_OFF_FIELDS = "code,product_name,product_name_ru,brands,nutriments,image_small_url"
OFF_SEARCH_TIMEOUT = 4
OFF_SEARCH_CACHE_SECONDS = 60 * 15
_OFF_SEARCH_CACHE: dict[str, tuple[float, dict]] = {}


def _cache_get(key: str):
    cached = _OFF_SEARCH_CACHE.get(key)
    if not cached:
        return None
    expires_at, value = cached
    if expires_at <= time.monotonic():
        _OFF_SEARCH_CACHE.pop(key, None)
        return None
    return value


def _cache_set(key: str, value: dict, timeout: int) -> None:
    _OFF_SEARCH_CACHE[key] = (time.monotonic() + timeout, value)


def _fetch_off_search(q: str) -> dict:
    """v2/search → при сбое legacy search.pl. Бросает RequestException, если оба недоступны."""
    cache_key = f"nutrition:off-search:{q.casefold()}"
    cached = _cache_get(cache_key)
    if isinstance(cached, dict):
        return cached

    attempts = [
        (OFF_SEARCH_V2_URL, {"search_terms": q, "page_size": 12, "fields": _OFF_FIELDS}),
        (OFF_SEARCH_URL, {
            "search_terms": q, "search_simple": 1, "action": "process",
            "json": 1, "page_size": 12, "fields": _OFF_FIELDS,
        }),
    ]
    last_exc: Exception | None = None
    for url, params in attempts:
        try:
            resp = requests.get(url, params=params, headers=OFF_HEADERS, timeout=OFF_SEARCH_TIMEOUT)
            resp.raise_for_status()
            data = resp.json()
            _cache_set(cache_key, data, OFF_SEARCH_CACHE_SECONDS)
            return data
        except requests.RequestException as exc:
            last_exc = exc
            logger.info("[OFF search] %s failed (%s), trying next", url, exc)
    raise last_exc if last_exc else RuntimeError("no OFF endpoint")


class OffSearchView(APIView):
    """GET /api/nutrition/search-off/?q= — текстовый поиск продуктов в Open Food Facts."""

    def get(self, request):
        q = (request.query_params.get("q") or "").strip()
        if len(q) < 2:
            return Response({"items": []})

        try:
            data = _fetch_off_search(q)
        except requests.RequestException as exc:
            logger.warning("[OFF search] all endpoints failed for %r: %s", q, exc)
            return Response(
                {"error": "Поиск Open Food Facts недоступен. Попробуйте позже."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        items = []
        for product in (data.get("products") or []):
            code = str(product.get("code") or "")
            norm = _off_to_per100(product, code)
            if norm is None:
                continue
            if not _off_product_matches_query(product, norm, q):
                continue
            items.append({
                "id": code or norm["name"],
                "name": norm["name"],
                "emoji": "🛒",
                "category": (product.get("brands") or "Open Food Facts")[:60],
                "kcal": norm["kcal"],
                "protein": norm["protein"],
                "fat": norm["fat"],
                "carbs": norm["carbs"],
                "barcode": code,
                "image": product.get("image_small_url") or "",
            })
            if len(items) >= 20:
                break

        return Response({"items": items})


def _off_product_matches_query(product: dict, norm: dict, q: str) -> bool:
    tokens = [token for token in re.split(r"\s+", q.casefold()) if len(token) >= 2]
    if not tokens:
        return True
    haystack = " ".join([
        str(norm.get("name") or ""),
        str(product.get("brands") or ""),
    ]).casefold()
    return all(token in haystack for token in tokens)


def _off_to_per100(product: dict, code: str) -> dict | None:
    """
    Нормализует продукт Open Food Facts → наш плоский формат на 100 г.
    Возвращает None, если у продукта нет калорийности (бесполезен).
    """
    nutr = product.get("nutriments") or {}

    def num(key: str) -> float:
        try:
            return round(float(nutr.get(key, 0)) or 0, 1)
        except (TypeError, ValueError):
            return 0.0

    kcal = num("energy-kcal_100g")
    # Иногда есть только энергия в кДж — переводим (1 ккал ≈ 4.184 кДж).
    if not kcal:
        kj = num("energy-kj_100g") or num("energy_100g")
        if kj:
            kcal = round(kj / 4.184, 1)
    if not kcal:
        return None

    name = (
        product.get("product_name_ru")
        or product.get("product_name")
        or product.get("brands")
        or "Продукт"
    ).strip()[:200]

    return {
        "name": name,
        "kcal": kcal,
        "protein": num("proteins_100g"),
        "fat": num("fat_100g"),
        "carbs": num("carbohydrates_100g"),
        "barcode": code,
    }


class BarcodeLookupView(APIView):
    """GET /api/nutrition/barcode/<code>/ — продукт по штрихкоду (кэш → OFF)."""

    def get(self, request, code: str):
        code = re.sub(r"\D", "", code or "")
        if not (6 <= len(code) <= 14):
            return Response(
                {"error": "Некорректный штрихкод."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 1) Локальный кэш — мгновенный ответ, без обращения к OFF.
        cached = FoodItem.objects.filter(barcode=code).first()
        if cached:
            return Response({"found": True, "item": FoodItemSerializer(cached).data})

        # 2) Open Food Facts.
        try:
            resp = requests.get(
                OFF_URL.format(code=code),
                params={"fields": OFF_FIELDS},
                headers=OFF_HEADERS,
                timeout=OFF_TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException as exc:
            logger.warning("[Barcode] OFF request failed for %s: %s", code, exc)
            return Response(
                {"error": "База продуктов недоступна. Попробуйте позже или введите вручную."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        if data.get("status") != 1 or not data.get("product"):
            return Response({"found": False}, status=status.HTTP_404_NOT_FOUND)

        normalized = _off_to_per100(data["product"], code)
        if normalized is None:
            return Response({"found": False}, status=status.HTTP_404_NOT_FOUND)

        # 3) Кэшируем как FoodItem(source='off'), чтобы повторный скан был мгновенным.
        item, _ = FoodItem.objects.update_or_create(
            barcode=code,
            defaults={
                "name": normalized["name"],
                "kcal": normalized["kcal"],
                "protein": normalized["protein"],
                "fat": normalized["fat"],
                "carbs": normalized["carbs"],
                "emoji": "🛒",
                "category": "Штрихкод",
                "source": "off",
            },
        )
        _invalidate_food_cache()
        return Response({"found": True, "item": FoodItemSerializer(item).data})
