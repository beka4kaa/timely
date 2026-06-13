from rest_framework import serializers

from .models import FoodItem, NutritionEntry


class FoodItemSerializer(serializers.ModelSerializer):
    """Плоский продукт для фронтенда: БЖУ на 100 г + мета."""

    class Meta:
        model = FoodItem
        fields = [
            "id", "name", "emoji", "category",
            "kcal", "protein", "fat", "carbs",
            "barcode", "source",
        ]


class NutritionEntrySerializer(serializers.ModelSerializer):
    """Consumed food entry for a user day; values are already portion-scaled."""

    class Meta:
        model = NutritionEntry
        fields = [
            "id", "entry_date", "name",
            "kcal", "protein", "fat", "carbs",
            "added_at",
        ]
        read_only_fields = ["id", "added_at"]
        extra_kwargs = {"entry_date": {"required": False}}

    def validate(self, attrs):
        for field in ["kcal", "protein", "fat", "carbs"]:
            value = attrs.get(field)
            if value is not None and value < 0:
                raise serializers.ValidationError({field: "Must be non-negative."})
        return attrs
