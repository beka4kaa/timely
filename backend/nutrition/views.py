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
import re

import requests
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import FoodItem
from .serializers import FoodItemSerializer

logger = logging.getLogger(__name__)

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

        qs = FoodItem.objects.all()
        if q:
            qs = qs.filter(name__icontains=q)
        items = list(qs[:limit])
        return Response(FoodItemSerializer(items, many=True).data)


# Open Food Facts текстовый поиск. Проксируем через бэкенд, а НЕ зовём из
# браузера: OFF требует кастомный User-Agent (его браузер выставить не может —
# заголовок запрещён fetch), плюс так обходим CORS и нормализуем ответ.
# Debounce остаётся на фронтенде (критичное требование).
#
# Надёжность: legacy search.pl (как в ТЗ) под нагрузкой часто отдаёт 503,
# поэтому при сбое падаем на современный и более стабильный /api/v2/search.
OFF_SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl"
OFF_SEARCH_V2_URL = "https://world.openfoodfacts.org/api/v2/search"
_OFF_FIELDS = "code,product_name,product_name_ru,brands,nutriments,image_small_url"


def _fetch_off_search(q: str) -> dict:
    """search.pl → при сбое v2/search. Бросает RequestException, если оба недоступны."""
    attempts = [
        (OFF_SEARCH_URL, {
            "search_terms": q, "search_simple": 1, "action": "process",
            "json": 1, "page_size": 20, "fields": _OFF_FIELDS,
        }),
        (OFF_SEARCH_V2_URL, {"search_terms": q, "page_size": 20, "fields": _OFF_FIELDS}),
    ]
    last_exc: Exception | None = None
    for url, params in attempts:
        try:
            resp = requests.get(url, params=params, headers=OFF_HEADERS, timeout=14)
            resp.raise_for_status()
            return resp.json()
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
        return Response({"found": True, "item": FoodItemSerializer(item).data})
