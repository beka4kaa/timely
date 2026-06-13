"""Deterministic nutrition target calculation for a user profile."""

from __future__ import annotations

from dataclasses import dataclass


ACTIVITY_MULTIPLIERS = {
    "sedentary": 1.2,
    "light": 1.375,
    "moderate": 1.55,
    "active": 1.725,
    "very_active": 1.9,
}

GOAL_CALORIE_FACTORS = {
    "lose": 0.85,
    "maintain": 1.0,
    "gain": 1.1,
}

PROTEIN_PER_KG = {
    "lose": 1.8,
    "maintain": 1.4,
    "gain": 1.8,
}


@dataclass(frozen=True)
class NutritionTargets:
    kcal_goal: int
    protein_goal: int
    fat_goal: int
    carbs_goal: int


def calculate_nutrition_targets(
    *,
    sex: str,
    age: int,
    height_cm: float,
    weight_kg: float,
    activity_level: str,
    goal: str,
) -> NutritionTargets:
    """
    Calculate daily calorie and macro targets.

    Energy uses the Mifflin-St Jeor resting metabolic rate equation,
    multiplied by activity and adjusted by the user's goal. Macros are then
    derived from body weight first, with carbs taking the remaining calories.
    """

    sex_offset = 5 if sex == "male" else -161
    bmr = (10 * weight_kg) + (6.25 * height_cm) - (5 * age) + sex_offset
    activity = ACTIVITY_MULTIPLIERS.get(activity_level, ACTIVITY_MULTIPLIERS["light"])
    goal_factor = GOAL_CALORIE_FACTORS.get(goal, GOAL_CALORIE_FACTORS["maintain"])

    kcal_goal = max(1200, round(bmr * activity * goal_factor))
    protein_goal = round(weight_kg * PROTEIN_PER_KG.get(goal, PROTEIN_PER_KG["maintain"]))

    fat_floor = weight_kg * 0.8
    fat_from_calories = (kcal_goal * 0.25) / 9
    fat_goal = round(max(fat_floor, fat_from_calories))
    fat_goal = min(fat_goal, round((kcal_goal * 0.35) / 9))

    remaining_kcal = kcal_goal - (protein_goal * 4) - (fat_goal * 9)
    carbs_goal = max(0, round(remaining_kcal / 4))

    return NutritionTargets(
        kcal_goal=kcal_goal,
        protein_goal=max(1, protein_goal),
        fat_goal=max(1, fat_goal),
        carbs_goal=carbs_goal,
    )
