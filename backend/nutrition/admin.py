from django.contrib import admin

from .models import FoodItem, NutritionEntry


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
