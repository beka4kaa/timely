from __future__ import annotations

import base64
from unittest.mock import patch

import cv2
import numpy as np
from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory

from nutrition import photo_views
from nutrition.photo_views import AnalyzePhotoView, _normalize_photo_items


def _bagel_png() -> bytes:
    img = np.full((240, 240, 3), 255, dtype=np.uint8)
    cv2.circle(img, (120, 120), 76, (56, 122, 194), -1)
    cv2.circle(img, (120, 120), 30, (255, 255, 255), -1)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return bytes(buf)


def _data_url(raw: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(raw).decode("ascii")


class PhotoAnalyzeStabilityTests(SimpleTestCase):
    def setUp(self) -> None:
        photo_views._PHOTO_ANALYSIS_CACHE.clear()

    def test_hybrid_prefers_cv_and_catalog_over_unstable_model_values(self) -> None:
        raw = _bagel_png()
        parsed = {
            "items": [{
                "name": "Бублик с кунжутом",
                "emoji": "🥯",
                "identified_class": "bagel",
                "default_grams": 100,
                "visible_grams": 600,
                "completeness_ratio": 1,
                "kcal": 999,
                "protein": 99,
                "fat": 99,
                "carbs": 99,
            }]
        }

        items = _normalize_photo_items(parsed, raw)

        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["portion_source"], "opencv_contour")
        self.assertEqual(items[0]["nutrition_source"], "catalog_baseline")
        self.assertLess(items[0]["grams"], 150)
        self.assertEqual(items[0]["kcal"], 270.0)

    def test_same_photo_payload_is_cached_before_second_model_call(self) -> None:
        raw = _bagel_png()
        data_url = _data_url(raw)
        payload = {
            "items": [{
                "name": "Бублик с кунжутом",
                "emoji": "🥯",
                "identified_class": "bagel",
                "default_grams": 100,
                "kcal": 260,
                "protein": 10,
                "fat": 2,
                "carbs": 50,
            }]
        }
        factory = APIRequestFactory()
        view = AnalyzePhotoView.as_view()

        with patch.object(photo_views, "PHOTO_PROVIDER", "groq"), \
             patch.object(photo_views, "GROQ_API_KEY", "test-key"), \
             patch.object(photo_views, "PHOTO_CACHE_SECONDS", 900), \
             patch.object(photo_views, "_call_groq", return_value=(payload, "test-vision")) as call:
            request1 = factory.post("/api/nutrition/analyze-photo/", {"image": data_url}, format="json")
            response1 = view(request1)
            request2 = factory.post("/api/nutrition/analyze-photo/", {"image": data_url}, format="json")
            response2 = view(request2)

        self.assertEqual(response1.status_code, 200)
        self.assertEqual(response2.status_code, 200)
        self.assertEqual(call.call_count, 1)
        self.assertEqual(response1.data["items"], response2.data["items"])
        self.assertTrue(response2.data["cached"])
