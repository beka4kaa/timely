"""Focused tests for user-selectable image generation models.

The model used to be frozen at import time in `image_enrichment._MODEL`, so a
per-request choice was impossible. These tests pin the two things that can
regress now that the choice travels from the browser:

  1. the allowlist actually rejects — a model ID from the client must never
     reach the provider unchecked;
  2. each model gets a payload it accepts — Seedream is an image-ONLY model and
     404s on `modalities: ["image", "text"]`, and quality must not be sent to a
     model that does not declare it.

No network: `requests.post` is patched in every test that reaches transport.
"""

from __future__ import annotations

from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from ai_engine import image_enrichment
from ai_engine.image_models import (
    UnsupportedImageModel,
    default_model_id,
    list_models_payload,
    resolve_options,
)

MODELS_URL = "/api/ai/image-models/"
ILLUSTRATION_URL = "/api/ai/illustration/"

SEEDREAM = "bytedance-seed/seedream-4.5"
GPT_IMAGE_2 = "openai/gpt-5.4-image-2"

PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo="


def provider_response(image_url: str = "https://cdn.example/generated.png") -> dict:
    """OpenRouter answer in the shape Gemini/GPT image models actually return."""
    return {
        "choices": [
            {
                "message": {
                    "content": "Here is the illustration.",
                    "images": [{"image_url": {"url": image_url}}],
                }
            }
        ],
        "usage": {"prompt_tokens": 12, "completion_tokens": 0},
    }


class FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            import requests

            raise requests.HTTPError(f"{self.status_code} Server Error")

    def json(self) -> dict:
        return self._payload


class ImageModelsEndpointTests(TestCase):
    """GET /api/ai/image-models/ — то, по чему фронтенд строит селектор."""

    def setUp(self) -> None:
        self.client = APIClient()

    def test_returns_both_models(self):
        response = self.client.get(MODELS_URL)
        self.assertEqual(response.status_code, 200)
        ids = [model["id"] for model in response.json()["models"]]
        self.assertEqual(sorted(ids), sorted([SEEDREAM, GPT_IMAGE_2]))

    def test_default_model_is_seedream(self):
        payload = self.client.get(MODELS_URL).json()
        self.assertEqual(payload["default_model"], SEEDREAM)
        default_entries = [m for m in payload["models"] if m["default"]]
        self.assertEqual([m["id"] for m in default_entries], [SEEDREAM])

    def test_metadata_contract_is_complete(self):
        """Фронтенд рисует label/description/badges строго по этим полям."""
        by_id = {m["id"]: m for m in self.client.get(MODELS_URL).json()["models"]}
        self.assertEqual(by_id[SEEDREAM]["label"], "Seedream 4.5")
        self.assertEqual(by_id[SEEDREAM]["provider"], "ByteDance")
        self.assertFalse(by_id[SEEDREAM]["supports_quality"])
        self.assertEqual(by_id[GPT_IMAGE_2]["label"], "GPT Image 2")
        self.assertEqual(by_id[GPT_IMAGE_2]["provider"], "OpenAI")
        self.assertTrue(by_id[GPT_IMAGE_2]["supports_quality"])
        for entry in by_id.values():
            self.assertTrue(entry["supports_image_input"])

    @override_settings(IMAGE_GEN_ALLOWED_MODELS=GPT_IMAGE_2)
    def test_env_narrows_the_allowlist(self):
        """IMAGE_GEN_ALLOWED_MODELS должен реально сужать список, иначе env-
        переключатель — фикция, и модель нельзя убрать без деплоя кода."""
        payload = list_models_payload()
        self.assertEqual([m["id"] for m in payload["models"]], [GPT_IMAGE_2])
        # Дефолт из settings выпал из allowlist → берётся разрешённая модель.
        self.assertEqual(payload["default_model"], GPT_IMAGE_2)
        with self.assertRaises(UnsupportedImageModel):
            resolve_options(SEEDREAM)


class ResolveOptionsTests(TestCase):
    """Валидация выбора, приехавшего с клиента."""

    def test_gpt_image_2_is_allowed(self):
        options = resolve_options(GPT_IMAGE_2, "medium")
        self.assertEqual(options.model, GPT_IMAGE_2)
        self.assertEqual(options.quality, "medium")

    def test_unknown_model_is_rejected(self):
        for candidate in ("evil/model", "openai/gpt-image-2", "  "):
            with self.subTest(candidate=candidate):
                if candidate.strip():
                    with self.assertRaises(UnsupportedImageModel):
                        resolve_options(candidate)

    def test_empty_model_falls_back_to_default(self):
        for empty in (None, "", "   "):
            with self.subTest(empty=empty):
                self.assertEqual(resolve_options(empty).model, default_model_id())

    def test_empty_quality_falls_back_to_default(self):
        for empty in (None, "", "nonsense"):
            with self.subTest(empty=empty):
                self.assertEqual(resolve_options(GPT_IMAGE_2, empty).quality, "medium")

    def test_quality_is_dropped_for_model_without_support(self):
        """Seedream качества не имеет: просить high на ней — не ошибка,
        параметр просто не должен существовать."""
        self.assertIsNone(resolve_options(SEEDREAM, "high").quality)

    def test_quality_is_never_silently_upgraded(self):
        """Дефолт не должен уезжать в high — это молча дорожает каждая картинка."""
        self.assertEqual(resolve_options(GPT_IMAGE_2).quality, "medium")


class ImagePayloadTests(TestCase):
    """Что уходит провайдеру для каждой модели."""

    def _capture_payload(self, *, options, **kwargs) -> dict:
        with patch.object(image_enrichment, "_API_KEY", "test-key"), patch(
            "ai_engine.image_enrichment.requests.post",
            return_value=FakeResponse(provider_response()),
        ) as mock_post, patch("ai_engine.image_enrichment.record_model_usage"):
            image_enrichment._call_image_api("a block on an incline", options=options, **kwargs)
        return mock_post.call_args.kwargs["json"]

    def test_seedream_payload(self):
        payload = self._capture_payload(options=resolve_options(SEEDREAM))
        self.assertEqual(payload["model"], SEEDREAM)
        # Чисто image-модель: с "text" в modalities провайдер отвечает 404
        # "No endpoints found that support the requested output modalities".
        self.assertEqual(payload["modalities"], ["image"])
        self.assertNotIn("quality", payload["image_config"])

    def test_gpt_image_2_payload(self):
        payload = self._capture_payload(options=resolve_options(GPT_IMAGE_2, "high"))
        self.assertEqual(payload["model"], GPT_IMAGE_2)
        self.assertEqual(payload["modalities"], ["image", "text"])
        self.assertEqual(payload["image_config"]["quality"], "high")

    def test_aspect_ratio_travels_with_options(self):
        payload = self._capture_payload(options=resolve_options(SEEDREAM, None, "1:1"))
        self.assertEqual(payload["aspect_ratio"], "1:1")
        self.assertEqual(payload["image_config"]["aspect_ratio"], "1:1")

    def test_reference_image_is_preserved_for_both_models(self):
        """Рестайл (image-to-image) должен работать на обеих моделях: референс
        обязан ехать ПЕРВЫМ элементом мультимодального content."""
        for model in (SEEDREAM, GPT_IMAGE_2):
            with self.subTest(model=model):
                payload = self._capture_payload(
                    options=resolve_options(model),
                    reference_image_url=PNG_DATA_URL,
                )
                content = payload["messages"][0]["content"]
                self.assertIsInstance(content, list)
                self.assertEqual(content[0]["type"], "image_url")
                self.assertEqual(content[0]["image_url"]["url"], PNG_DATA_URL)

    def test_legacy_call_without_options_still_works(self):
        """Старый путь (никто не выбирал модель) обязан продолжать работать и
        брать дефолт инсталляции, а не падать на отсутствующем аргументе."""
        payload = self._capture_payload(options=None)
        self.assertEqual(payload["model"], default_model_id())

    def test_usage_metadata_records_model_and_quality(self):
        """Без этих полей A/B-сравнение стоимости невозможно."""
        with patch.object(image_enrichment, "_API_KEY", "test-key"), patch(
            "ai_engine.image_enrichment.requests.post",
            return_value=FakeResponse(provider_response()),
        ), patch("ai_engine.image_enrichment.record_model_usage") as mock_usage:
            image_enrichment._call_image_api(
                "a block on an incline",
                options=resolve_options(GPT_IMAGE_2, "low"),
            )
        kwargs = mock_usage.call_args.kwargs
        self.assertEqual(kwargs["model"], GPT_IMAGE_2)
        self.assertEqual(kwargs["metadata"]["image_model"], GPT_IMAGE_2)
        self.assertEqual(kwargs["metadata"]["image_quality"], "low")


class ImageResponseNormalizationTests(TestCase):
    """Обе модели должны сводиться к ОДНОМУ виду: URL или Data URL."""

    def _generate(self, payload: dict) -> str:
        with patch.object(image_enrichment, "_API_KEY", "test-key"), patch(
            "ai_engine.image_enrichment.requests.post",
            return_value=FakeResponse(payload),
        ), patch("ai_engine.image_enrichment.record_model_usage"):
            return image_enrichment.generate_image("a block", model=GPT_IMAGE_2)

    def test_images_field_is_normalized(self):
        url = self._generate(provider_response("https://cdn.example/x.png"))
        self.assertEqual(url, "https://cdn.example/x.png")

    def test_inline_base64_is_normalized_to_data_url(self):
        raw_b64 = "iVBORw0KGgo" + "A" * 600
        payload = {"choices": [{"message": {"content": raw_b64}}]}
        url = self._generate(payload)
        self.assertTrue(url.startswith("data:image/"))
        self.assertIn("base64,", url)


class IllustrationEndpointModelTests(TestCase):
    """POST /api/ai/illustration/ — граница, где клиенту нельзя доверять."""

    def setUp(self) -> None:
        self.client = APIClient()

    def _body(self, **extra) -> dict:
        return {
            "command": {
                "type": "image_with_labels",
                "image_prompt": "a block on an incline",
            },
            **extra,
        }

    def test_unknown_model_returns_400(self):
        response = self.client.post(
            ILLUSTRATION_URL,
            self._body(image_model="evil/model"),
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"error": "Unsupported image model"})

    def test_selected_model_reaches_the_provider(self):
        with patch.object(image_enrichment, "_API_KEY", "test-key"), patch(
            "ai_engine.image_enrichment.requests.post",
            return_value=FakeResponse(provider_response()),
        ) as mock_post, patch("ai_engine.image_enrichment.record_model_usage"), patch(
            "ai_engine.illustration_views.try_build_vector_illustration",
            return_value=None,
        ):
            response = self.client.post(
                ILLUSTRATION_URL,
                self._body(image_model=GPT_IMAGE_2, image_quality="low"),
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(mock_post.call_args.kwargs["json"]["model"], GPT_IMAGE_2)
        command = response.json()["command"]
        # A/B-метаданные едут обратно на фронтенд вместе с картинкой.
        self.assertEqual(command["image_model"], GPT_IMAGE_2)
        self.assertEqual(command["image_quality"], "low")

    def test_missing_model_uses_default(self):
        with patch.object(image_enrichment, "_API_KEY", "test-key"), patch(
            "ai_engine.image_enrichment.requests.post",
            return_value=FakeResponse(provider_response()),
        ) as mock_post, patch("ai_engine.image_enrichment.record_model_usage"), patch(
            "ai_engine.illustration_views.try_build_vector_illustration",
            return_value=None,
        ):
            response = self.client.post(ILLUSTRATION_URL, self._body(), format="json")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(mock_post.call_args.kwargs["json"]["model"], default_model_id())

    def test_provider_failure_degrades_safely(self):
        """Модель недоступна → понятная ошибка в команде, а не 500 и не пустая
        доска. Автоматической подмены модели быть не должно."""
        with patch.object(image_enrichment, "_API_KEY", "test-key"), patch(
            "ai_engine.image_enrichment.requests.post",
            return_value=FakeResponse({}, status_code=404),
        ), patch("ai_engine.illustration_views.try_build_vector_illustration", return_value=None):
            response = self.client.post(
                ILLUSTRATION_URL,
                self._body(image_model=GPT_IMAGE_2),
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        command = response.json()["command"]
        self.assertNotIn("base_image_url", command)
        self.assertEqual(command["image_error"]["code"], "GENERATION_FAILED")
