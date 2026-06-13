"""
Seed the expanded BZHU food database from backend/nutrition/data.

The CSV is kept in the repository so the migration stays deterministic across
local development and production deploys.
"""

import csv
from pathlib import Path

from django.db import migrations


DATA_FILE = Path(__file__).resolve().parents[1] / "data" / "bzhu_food_database.csv"

EMOJI_BY_CATEGORY = {
    "Овощи и зелень": "🥦",
    "Фрукты и ягоды": "🍎",
    "Мясо и птица": "🍗",
    "Рыба и морепродукты": "🐟",
    "Молочные продукты и яйца": "🥛",
    "Крупы, бобовые и орехи": "🥣",
    "Готовые блюда": "🍽",
}


def _num(value: str) -> float:
    return round(float((value or "0").replace(",", ".")), 1)


def _read_rows() -> list[dict]:
    rows = []
    with DATA_FILE.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter=";"):
            category = (row.get("Категория") or "").strip()
            name = (row.get("Продукт / Блюдо") or "").strip()
            if not name:
                continue
            rows.append({
                "name": name,
                "emoji": EMOJI_BY_CATEGORY.get(category, "🍽"),
                "category": category,
                "kcal": _num(row.get("Калории (ккал)", "0")),
                "protein": _num(row.get("Белки (г)", "0")),
                "fat": _num(row.get("Жиры (г)", "0")),
                "carbs": _num(row.get("Углеводы (г)", "0")),
                "source": "seed",
            })
    return rows


def seed(apps, schema_editor):
    FoodItem = apps.get_model("nutrition", "FoodItem")
    rows = _read_rows()
    existing = {
        item.name: item
        for item in FoodItem.objects.filter(name__in=[row["name"] for row in rows])
    }

    to_create = []
    to_update = []
    for row in rows:
        item = existing.get(row["name"])
        if item is None:
            to_create.append(FoodItem(**row))
            continue
        for field, value in row.items():
            if field != "name":
                setattr(item, field, value)
        to_update.append(item)

    if to_create:
        FoodItem.objects.bulk_create(to_create, batch_size=200)
    if to_update:
        FoodItem.objects.bulk_update(
            to_update,
            ["emoji", "category", "kcal", "protein", "fat", "carbs", "source"],
            batch_size=200,
        )


class Migration(migrations.Migration):
    dependencies = [("nutrition", "0002_seed_foods")]
    operations = [migrations.RunPython(seed, migrations.RunPython.noop)]
