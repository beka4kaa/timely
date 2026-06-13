from django.contrib import admin

from .models import FoodItem, NutritionEntry, NutritionProfile


@admin.register(FoodItem)
class FoodItemAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "kcal", "protein", "fat", "carbs", "source")
    list_filter = ("source", "category")
    search_fields = ("name", "barcode")


@admin.register(NutritionEntry)
class NutritionEntryAdmin(admin.ModelAdmin):
    list_display = ("user_email", "entry_date", "name", "kcal", "protein", "fat", "carbs", "added_at")
    list_filter = ("entry_date",)
    search_fields = ("user_email", "name")
    date_hierarchy = "entry_date"


@admin.register(NutritionProfile)
class NutritionProfileAdmin(admin.ModelAdmin):
    list_display = (
        "user_email", "goal", "activity_level", "weight_kg", "height_cm",
        "kcal_goal", "protein_goal", "fat_goal", "carbs_goal", "updated_at",
    )
    list_filter = ("goal", "activity_level", "sex")
    search_fields = ("user_email",)
