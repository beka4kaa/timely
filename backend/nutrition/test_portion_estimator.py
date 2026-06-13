from __future__ import annotations

import cv2
import numpy as np
from django.test import SimpleTestCase

from nutrition.portion_estimator import estimate_food_portion, resolve_baseline


def _png_bytes(img: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf)


def _bagel_image(half: bool = False) -> bytes:
    img = np.full((240, 240, 3), 255, dtype=np.uint8)
    center = (120, 120)
    color = (56, 122, 194)  # BGR: warm brown/orange
    cv2.circle(img, center, 76, color, -1)
    cv2.circle(img, center, 30, (255, 255, 255), -1)
    if half:
        # Simulate a left half of a round/ring item. The bbox is tall but narrow,
        # so round-shape baseline uses the max side as the whole diameter.
        img[:, 120:] = 255
    return _png_bytes(img)


class PortionEstimatorTests(SimpleTestCase):
    def test_resolve_bagel_baseline(self) -> None:
        baseline = resolve_baseline("Бублик с кунжутом", "bagel", 100)
        self.assertEqual(baseline.identified_class, "bagel")
        self.assertEqual(baseline.default_grams, 90)

    def test_half_bagel_reduces_completeness_and_weight(self) -> None:
        full = estimate_food_portion(_bagel_image(False), name="Бублик с кунжутом", identified_class="bagel", model_default_grams=100)
        half = estimate_food_portion(_bagel_image(True), name="Бублик с кунжутом", identified_class="bagel", model_default_grams=100)

        self.assertGreaterEqual(full.completeness_ratio, 0.8)
        self.assertLess(half.completeness_ratio, full.completeness_ratio)
        self.assertLessEqual(half.completeness_ratio, 0.7)
        self.assertLess(half.final_weight, full.final_weight)
        self.assertLessEqual(half.final_weight, 60)
