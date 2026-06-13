from django.db import models


class FoodItem(models.Model):
    """
    Один продукт в библиотеке питания. Все БЖУ — В РАСЧЁТЕ НА 100 Г
    (стандарт нутрициологии); фронтенд умножает на порцию пользователя.

    Источники (`source`):
      • seed — курированный встроенный список (data-миграция);
      • off  — подтянуто из Open Food Facts по штрихкоду (кэш, чтобы не
               ходить в их API повторно за тем же кодом);
      • user — добавлено пользователем (на будущее).
    """

    SOURCE_CHOICES = [
        ("seed", "Seed"),
        ("off", "Open Food Facts"),
        ("user", "User"),
    ]

    name = models.CharField(max_length=200, db_index=True)
    emoji = models.CharField(max_length=8, default="🍽")
    category = models.CharField(max_length=60, blank=True, default="")

    # Значения на 100 г
    kcal = models.FloatField(default=0)
    protein = models.FloatField(default=0)
    fat = models.FloatField(default=0)
    carbs = models.FloatField(default=0)

    # Штрихкод (для кэша Open Food Facts); пусто у обычных продуктов библиотеки.
    barcode = models.CharField(max_length=32, blank=True, default="", db_index=True)
    source = models.CharField(max_length=8, choices=SOURCE_CHOICES, default="seed")

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]
        indexes = [
            models.Index(fields=["name"]),
            models.Index(fields=["barcode"]),
        ]

    def __str__(self):
        return f"{self.name} ({self.kcal} ккал/100г)"


class NutritionEntry(models.Model):
    """
    User food diary entry. Values are already scaled to the consumed portion,
    not per 100 g, so daily totals can be summed directly.
    """

    user_email = models.EmailField(db_index=True)
    entry_date = models.DateField(db_index=True)
    name = models.CharField(max_length=200)
    kcal = models.FloatField(default=0)
    protein = models.FloatField(default=0)
    fat = models.FloatField(default=0)
    carbs = models.FloatField(default=0)
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-added_at"]
        indexes = [
            models.Index(fields=["user_email", "entry_date", "-added_at"]),
        ]

    def __str__(self):
        return f"{self.user_email} — {self.name} ({self.entry_date})"
