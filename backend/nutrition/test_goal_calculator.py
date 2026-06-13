from django.test import SimpleTestCase

from nutrition.goal_calculator import calculate_nutrition_targets


class NutritionGoalCalculatorTests(SimpleTestCase):
    def test_maintain_targets_are_deterministic(self) -> None:
        targets = calculate_nutrition_targets(
            sex="male",
            age=30,
            height_cm=180,
            weight_kg=80,
            activity_level="moderate",
            goal="maintain",
        )

        self.assertEqual(targets.kcal_goal, 2759)
        self.assertEqual(targets.protein_goal, 112)
        self.assertEqual(targets.fat_goal, 77)
        self.assertEqual(targets.carbs_goal, 404)

    def test_goal_changes_adjust_calories(self) -> None:
        common = {
            "sex": "female",
            "age": 28,
            "height_cm": 168,
            "weight_kg": 64,
            "activity_level": "light",
        }

        lose = calculate_nutrition_targets(**common, goal="lose")
        maintain = calculate_nutrition_targets(**common, goal="maintain")
        gain = calculate_nutrition_targets(**common, goal="gain")

        self.assertLess(lose.kcal_goal, maintain.kcal_goal)
        self.assertGreater(gain.kcal_goal, maintain.kcal_goal)
        self.assertGreaterEqual(lose.protein_goal, maintain.protein_goal)
