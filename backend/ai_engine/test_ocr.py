"""Focused tests for the whiteboard OCR endpoint (POST /api/ai/ocr).

The endpoint moved from a self-hosted GLM-OCR model to Qwen3-VL through
OpenRouter. Qwen3-VL is a general-purpose VLM, so the thing most likely to
regress is not the transport but the prompt: without an explicit ban it answers
"the image shows a formula..." instead of transcribing. That contract is
asserted here.

No network: the transport is patched in every test.
"""

from __future__ import annotations

import base64
import os
from unittest.mock import patch

import cv2
import numpy as np
from django.conf import settings
from django.test import TestCase
from rest_framework.test import APIClient

from ai_engine import glm_client, ocr_views
from ai_engine.glm_client import get_glm_client
from ai_engine.ocr_views import OCR_SYSTEM_PROMPT, preprocess_and_encode

OCR_URL = "/api/ai/ocr/"


def png_base64(*, alpha: bool = False) -> str:
    """Small synthetic whiteboard: a stroke on a light background.

    The stroke is mid-grey and anti-aliased on purpose — that is what a real
    pencil/marker capture looks like, and it is exactly the signal Otsu throws
    away, so the binarize on/off tests have something to distinguish.
    """
    if alpha:
        img = np.zeros((32, 48, 4), dtype=np.uint8)
        img[:, :, 3] = 0  # fully transparent background
        cv2.line(img, (6, 24), (40, 24), (0, 0, 0, 255), 2, lineType=cv2.LINE_AA)
    else:
        img = np.full((32, 48, 3), 255, dtype=np.uint8)
        cv2.line(img, (6, 24), (40, 24), (90, 90, 90), 2, lineType=cv2.LINE_AA)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return base64.b64encode(buf).decode("ascii")


class VisionDefaultsTests(TestCase):
    """The migration is only real if the shipped defaults point at Qwen/OpenRouter.

    These assert the FALLBACK — what CI and a fresh deploy get. A developer .env
    may legitimately override any of them (e.g. to run OCR against a local
    server), so each check skips when its variable is set. Asserting the
    resolved value unconditionally made the suite fail on a machine whose .env
    pinned VISION_MODEL_NAME, which says nothing about the shipped default.
    """

    def test_default_base_url_is_openrouter(self) -> None:
        if os.getenv("VISION_API_BASE_URL"):
            self.skipTest("VISION_API_BASE_URL overridden in this environment")
        self.assertEqual(settings.VISION_API_BASE_URL, "https://openrouter.ai/api/v1")

    def test_default_model_is_qwen_vl(self) -> None:
        if os.getenv("VISION_MODEL_NAME"):
            self.skipTest("VISION_MODEL_NAME overridden in this environment")
        self.assertEqual(settings.VISION_MODEL_NAME, "qwen/qwen3-vl-32b-instruct")

    def test_default_timeout_and_binarize(self) -> None:
        if not os.getenv("VISION_TIMEOUT"):
            self.assertEqual(settings.VISION_TIMEOUT, 60)
        if not os.getenv("VISION_OCR_BINARIZE"):
            self.assertFalse(settings.VISION_OCR_BINARIZE)

    def test_vision_key_falls_back_to_openrouter_key(self) -> None:
        # Without the fallback the request would go out with the old "sk-local"
        # placeholder and OpenRouter would answer 401.
        self.assertNotEqual(settings.VISION_API_KEY, "sk-local")
        openrouter_key = os.getenv("OPENROUTER_API_KEY", "")
        if openrouter_key and not os.getenv("VISION_API_KEY"):
            self.assertEqual(settings.VISION_API_KEY, openrouter_key)

    def test_glm_client_mirrors_settings(self) -> None:
        # Two files declare these defaults; a drift between them is silent.
        self.assertEqual(glm_client.VISION_API_BASE_URL, settings.VISION_API_BASE_URL)
        self.assertEqual(glm_client.VISION_MODEL_NAME, settings.VISION_MODEL_NAME)
        self.assertEqual(glm_client.VISION_TIMEOUT, settings.VISION_TIMEOUT)

    @patch("ai_engine.glm_client.VISION_API_KEY", "test-key")
    def test_client_disables_sdk_retries(self) -> None:
        # 3 x VISION_TIMEOUT would exceed gunicorn --timeout 200 and kill the worker.
        get_glm_client.cache_clear()
        try:
            self.assertEqual(get_glm_client().max_retries, 0)
        finally:
            get_glm_client.cache_clear()


class PreprocessTests(TestCase):
    def test_returns_decodable_png(self) -> None:
        out = preprocess_and_encode(png_base64())
        decoded = cv2.imdecode(np.frombuffer(base64.b64decode(out), np.uint8), cv2.IMREAD_UNCHANGED)
        self.assertIsNotNone(decoded)
        # 20px padding on every side.
        self.assertEqual(decoded.shape[0], 32 + 40)
        self.assertEqual(decoded.shape[1], 48 + 40)

    def test_alpha_is_flattened_onto_white(self) -> None:
        out = preprocess_and_encode(png_base64(alpha=True), binarize=False)
        decoded = cv2.imdecode(np.frombuffer(base64.b64decode(out), np.uint8), cv2.IMREAD_GRAYSCALE)
        # Transparent background must become white, not black.
        self.assertGreater(decoded[2, 2], 200)
        # The stroke survives.
        self.assertLess(decoded.min(), 100)

    def test_binarize_off_keeps_grey_levels(self) -> None:
        # Anti-aliased stroke edges give intermediate greys; Otsu would erase them.
        out = preprocess_and_encode(png_base64(), binarize=False)
        decoded = cv2.imdecode(np.frombuffer(base64.b64decode(out), np.uint8), cv2.IMREAD_GRAYSCALE)
        self.assertGreater(len(np.unique(decoded)), 2)

    def test_binarize_on_produces_two_levels(self) -> None:
        out = preprocess_and_encode(png_base64(), binarize=True)
        decoded = cv2.imdecode(np.frombuffer(base64.b64decode(out), np.uint8), cv2.IMREAD_GRAYSCALE)
        self.assertEqual(sorted(np.unique(decoded).tolist()), [0, 255])

    def test_undecodable_bytes_raise(self) -> None:
        with self.assertRaises(ValueError):
            preprocess_and_encode(base64.b64encode(b"not an image").decode("ascii"))


class OCREndpointTests(TestCase):
    def setUp(self) -> None:
        self.client = APIClient()
        # CI has no provider key, and the view now short-circuits on an empty one.
        key_patch = patch("ai_engine.ocr_views.VISION_API_KEY", "test-key")
        key_patch.start()
        self.addCleanup(key_patch.stop)

    @patch("ai_engine.ocr_views.glm_chat_image")
    def test_transcription_is_returned(self, mock_chat) -> None:
        mock_chat.return_value = "F = ma"
        resp = self.client.post(OCR_URL, {"image": png_base64()}, format="json")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["text"], "F = ma")
        self.assertEqual(resp.data["raw_results"][0]["engine"], ocr_views.VISION_MODEL_NAME)

    @patch("ai_engine.ocr_views.glm_chat_image")
    def test_data_uri_prefix_is_stripped(self, mock_chat) -> None:
        mock_chat.return_value = "x"
        resp = self.client.post(
            OCR_URL, {"image": f"data:image/png;base64,{png_base64()}"}, format="json"
        )
        self.assertEqual(resp.status_code, 200)
        # Preprocessing succeeded, so the prefix never reached b64decode.
        self.assertTrue(mock_chat.called)

    @patch("ai_engine.ocr_views.glm_chat_image")
    def test_prompt_forbids_describing_the_image(self, mock_chat) -> None:
        mock_chat.return_value = ""
        self.client.post(OCR_URL, {"image": png_base64()}, format="json")

        kwargs = mock_chat.call_args.kwargs
        system = kwargs["system_prompt"].lower()
        self.assertIn("never describe", system)
        self.assertIn("verbatim", system)
        self.assertIn("latex", system)
        self.assertIn("only the text", system)
        # A general VLM otherwise opens with "Sure, here is...".
        self.assertIn("preamble", system)
        self.assertEqual(kwargs["system_prompt"], OCR_SYSTEM_PROMPT)

    @patch("ai_engine.ocr_views.glm_chat_image")
    def test_timeout_comes_from_settings_not_hardcoded(self, mock_chat) -> None:
        mock_chat.return_value = ""
        self.client.post(OCR_URL, {"image": png_base64()}, format="json")

        kwargs = mock_chat.call_args.kwargs
        self.assertEqual(kwargs["timeout"], settings.VISION_TIMEOUT)
        self.assertNotEqual(kwargs["timeout"], 30)
        self.assertEqual(kwargs["model"], settings.VISION_MODEL_NAME)
        self.assertGreaterEqual(kwargs["max_tokens"], 2000)

    def test_missing_image_is_400(self) -> None:
        resp = self.client.post(OCR_URL, {}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_undecodable_image_is_400(self) -> None:
        payload = base64.b64encode(b"definitely not a png").decode("ascii")
        resp = self.client.post(OCR_URL, {"image": payload}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("preprocessing", resp.data["error"].lower())

    @patch("ai_engine.ocr_views.VISION_API_KEY", "")
    def test_missing_key_is_reported_before_the_call(self) -> None:
        resp = self.client.post(OCR_URL, {"image": png_base64()}, format="json")
        self.assertEqual(resp.status_code, 502)
        self.assertIn("OPENROUTER_API_KEY", resp.data["error"])

    @patch("ai_engine.ocr_views.glm_chat_image")
    def test_connection_error_is_502_without_mac_studio_text(self, mock_chat) -> None:
        mock_chat.side_effect = RuntimeError("Connection refused")
        resp = self.client.post(OCR_URL, {"image": png_base64()}, format="json")
        self.assertEqual(resp.status_code, 502)
        # The old message told the user to check a Mac Studio they do not own.
        self.assertNotIn("Mac Studio", resp.data["error"])
        self.assertIn("VISION_API_BASE_URL", resp.data["error"])

    @patch("ai_engine.ocr_views.glm_chat_image")
    def test_timeout_error_is_504_and_reports_real_limit(self, mock_chat) -> None:
        mock_chat.side_effect = RuntimeError("Request timed out")
        resp = self.client.post(OCR_URL, {"image": png_base64()}, format="json")
        self.assertEqual(resp.status_code, 504)
        self.assertIn(str(settings.VISION_TIMEOUT), resp.data["error"])
        self.assertNotIn("30 секунд", resp.data["error"])

    @patch("ai_engine.ocr_views.glm_chat_image")
    def test_other_provider_error_is_502(self, mock_chat) -> None:
        mock_chat.side_effect = RuntimeError("402 insufficient credits")
        resp = self.client.post(OCR_URL, {"image": png_base64()}, format="json")
        self.assertEqual(resp.status_code, 502)
