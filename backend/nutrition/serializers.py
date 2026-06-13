from rest_framework import serializers

from .models import FoodItem


class FoodItemSerializer(serializers.ModelSerializer):
    """Плоский продукт для фронтенда: БЖУ на 100 г + мета."""

    class Meta:
        model = FoodItem
        fields = [
            "id", "name", "emoji", "category",
            "kcal", "protein", "fat", "carbs",
            "barcode", "source",
        ]
