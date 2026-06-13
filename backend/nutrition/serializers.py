from rest_framework import serializers

from .models import FoodItem, NutritionEntry, NutritionProfile


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


class NutritionProfileSerializer(serializers.ModelSerializer):
    """Per-user body metrics and calculated daily calorie/BJU targets."""

    class Meta:
        model = NutritionProfile
        fields = [
            "id", "sex", "age", "height_cm", "weight_kg", "activity_level", "goal",
            "kcal_goal", "protein_goal", "fat_goal", "carbs_goal",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "kcal_goal", "protein_goal", "fat_goal", "carbs_goal",
            "created_at", "updated_at",
        ]

    def validate_age(self, value):
        if not 10 <= value <= 100:
            raise serializers.ValidationError("Age must be between 10 and 100.")
        return value

    def validate_height_cm(self, value):
        if not 100 <= value <= 250:
            raise serializers.ValidationError("Height must be between 100 and 250 cm.")
        return value

    def validate_weight_kg(self, value):
        if not 30 <= value <= 300:
            raise serializers.ValidationError("Weight must be between 30 and 300 kg.")
        return value
