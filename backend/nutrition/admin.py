from django.contrib import admin

from .models import FoodItem


@admin.register(FoodItem)
class FoodItemAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "kcal", "protein", "fat", "carbs", "source")
    list_filter = ("source", "category")
    search_fields = ("name", "barcode")
