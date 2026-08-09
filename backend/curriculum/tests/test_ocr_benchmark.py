"""OCR-провайдер и harness сравнения vision-моделей.

Главное, что здесь проверяется: платный прогон выключен по умолчанию и его
нельзя включить одной переменной.
"""

from unittest import mock

from django.test import SimpleTestCase, override_settings

from ai_engine.usage import AIUsageLimitExceeded, usage_scope
from curriculum.model_registry import ROLE_OCR, resolve_model
from curriculum.ocr import (
    NullOcrProvider,
    OcrResult,
    VisionOcrProvider,
    get_ocr_provider,
    strip_code_fences,
)
from curriculum.ocr_benchmark import (
    OcrBenchmarkBudgetExceeded,
    OcrBenchmarkDisabled,
    OcrBenchmarkRun,
    PageOcrResult,
    estimate_cost,
    guard_real_run,
    ocr_evaluation_candidates,
    run_ocr_benchmark,
)
from curriculum.tests.pdf_fixtures import build_text_pdf, textbook_pdf

FULL_ENV = {
    "RUN_REAL_OCR_EVAL": "1",
    "OCR_EVAL_MAX_TOTAL_USD": "0.50",
    "OPENROUTER_API_KEY": "test-key",
    "OCR_EVAL_MODELS": "vendor/a,vendor/b",
    "OCR_EVAL_PDF_PATH": __file__,  # существующий файл
}


class OcrProviderSelectionTests(SimpleTestCase):
    def test_unset_role_yields_null_provider(self):
        """Забытый OCR_MODEL не должен приводить к платным вызовам."""
        with mock.patch.dict("os.environ", {}, clear=True):
            self.assertIsInstance(get_ocr_provider(), NullOcrProvider)

    def test_ocr_never_falls_back_to_chat_model(self):
        """Чат-модель не распознаёт страницу, поэтому fallback запрещён."""
        with mock.patch.dict(
            "os.environ", {"TEXT_LLM_MODEL": "vendor/chat"}, clear=True
        ):
            self.assertFalse(resolve_model(ROLE_OCR).configured)
            self.assertIsInstance(get_ocr_provider(), NullOcrProvider)

    def test_configured_role_yields_vision_provider(self):
        with mock.patch.dict(
            "os.environ", {"OCR_MODEL": "vendor/vision"}, clear=True
        ):
            provider = get_ocr_provider()
        self.assertIsInstance(provider, VisionOcrProvider)
        self.assertEqual(provider.model, "vendor/vision")

    def test_null_provider_reports_reason(self):
        result = NullOcrProvider().transcribe_page(b"png")
        self.assertFalse(result.succeeded)
        self.assertEqual(result.error, "ocr_not_configured")
        self.assertTrue(result.is_empty)

    def test_vision_provider_requires_model(self):
        with self.assertRaises(ValueError):
            VisionOcrProvider(model="")

    @mock.patch("ai_engine.glm_client.glm_chat_image", return_value="текст")
    def test_curriculum_ocr_feature_reaches_usage_ledger(self, call):
        result = VisionOcrProvider(model="vendor/vision").transcribe_page(b"png")

        self.assertTrue(result.succeeded)
        self.assertEqual(call.call_args.kwargs["feature"], "curriculum_ocr")

    @override_settings(AI_USAGE_ENFORCE_LIMITS=True)
    @mock.patch("ai_engine.glm_client.glm_chat_image")
    @mock.patch("ai_engine.usage.reserve_usage_capacity")
    def test_quota_denial_is_not_converted_to_ocr_fallback(self, reserve, call):
        reserve.side_effect = AIUsageLimitExceeded(
            window="five_hour",
            reset_at="2026-08-09T12:00:00Z",
        )

        with usage_scope(user_email="student@example.com"):
            with self.assertRaises(AIUsageLimitExceeded):
                VisionOcrProvider(model="vendor/vision").transcribe_page(b"png")

        call.assert_not_called()


class CodeFenceTests(SimpleTestCase):
    def test_strips_json_fence(self):
        self.assertEqual(strip_code_fences("```\nтекст\n```"), "текст")

    def test_strips_language_fence(self):
        self.assertEqual(strip_code_fences("```latex\nx=1\n```"), "x=1")

    def test_leaves_plain_text(self):
        self.assertEqual(strip_code_fences("обычный текст"), "обычный текст")


class GuardTests(SimpleTestCase):
    def test_disabled_by_default(self):
        with mock.patch.dict("os.environ", {}, clear=True):
            guard = guard_real_run()
        self.assertFalse(guard.enabled)
        self.assertIn("RUN_REAL_OCR_EVAL != 1", guard.reasons)

    def test_flag_alone_is_not_enough(self):
        with mock.patch.dict("os.environ", {"RUN_REAL_OCR_EVAL": "1"}, clear=True):
            guard = guard_real_run()
        self.assertFalse(guard.enabled)
        self.assertGreater(len(guard.reasons), 1)

    def test_all_conditions_enable_run(self):
        with mock.patch.dict("os.environ", FULL_ENV, clear=True):
            guard = guard_real_run()
        self.assertTrue(guard.enabled, guard.reasons)
        self.assertEqual(guard.candidates, ["vendor/a", "vendor/b"])

    def test_missing_pdf_blocks_run(self):
        env = dict(FULL_ENV, OCR_EVAL_PDF_PATH="/nope/missing.pdf")
        with mock.patch.dict("os.environ", env, clear=True):
            guard = guard_real_run()
        self.assertFalse(guard.enabled)
        self.assertTrue(any("не найден" in r for r in guard.reasons))

    def test_zero_budget_blocks_run(self):
        env = dict(FULL_ENV, OCR_EVAL_MAX_TOTAL_USD="0")
        with mock.patch.dict("os.environ", env, clear=True):
            self.assertFalse(guard_real_run().enabled)

    def test_no_implicit_candidate_list(self):
        """Неявный список кандидатов = неожиданные платные вызовы."""
        with mock.patch.dict("os.environ", {}, clear=True):
            self.assertEqual(ocr_evaluation_candidates(), [])

    def test_guard_returns_reasons_instead_of_raising(self):
        with mock.patch.dict("os.environ", {}, clear=True):
            guard = guard_real_run()  # не должно бросить
        self.assertIsInstance(guard.reasons, list)


class CostEstimateTests(SimpleTestCase):
    def test_scales_with_models_and_pages(self):
        _, one = estimate_cost(candidates=["a"], pages=1)
        _, two = estimate_cost(candidates=["a", "b"], pages=1)
        _, four = estimate_cost(candidates=["a", "b"], pages=2)
        self.assertAlmostEqual(two, one * 2, places=4)
        self.assertAlmostEqual(four, two * 2, places=4)

    def test_budget_ceiling_stops_run_before_any_call(self):
        provider = mock.Mock()
        with self.assertRaises(OcrBenchmarkBudgetExceeded):
            run_ocr_benchmark(
                pdf_bytes=textbook_pdf(),
                candidates=["a", "b"],
                max_pages=2,
                max_total_usd=0.0000001,
                provider_factory=lambda model: provider,
            )
        provider.transcribe_page.assert_not_called()


class _StubProvider:
    def __init__(self, model: str, text: str = "Задача 1. Текст."):
        self.model = model
        self.text = text
        self.seen: list[bytes] = []

    def transcribe_page(self, png_bytes: bytes) -> OcrResult:
        self.seen.append(png_bytes)
        return OcrResult(text=self.text, model=self.model, succeeded=True)


class BenchmarkRunTests(SimpleTestCase):
    def setUp(self):
        self.pdf = build_text_pdf(["Страница один " * 10, "Страница два " * 10])
        self.providers: dict[str, _StubProvider] = {}

    def _factory(self, model: str):
        self.providers[model] = _StubProvider(model)
        return self.providers[model]

    def test_every_model_gets_identical_images(self):
        run = run_ocr_benchmark(
            pdf_bytes=self.pdf,
            candidates=["a", "b", "c"],
            max_pages=2,
            provider_factory=self._factory,
        )
        self.assertTrue(run.inputs_identical())
        first = self.providers["a"].seen
        self.assertEqual(first, self.providers["b"].seen)
        self.assertEqual(first, self.providers["c"].seen)

    def test_exactly_one_call_per_page(self):
        run = run_ocr_benchmark(
            pdf_bytes=self.pdf,
            candidates=["a", "b"],
            max_pages=2,
            provider_factory=self._factory,
        )
        self.assertTrue(run.one_call_per_page())
        for candidate in run.results:
            self.assertEqual(candidate.calls, 2)

    def test_provider_construction_failure_recorded_not_raised(self):
        def broken(model):
            raise RuntimeError("модель недоступна")

        run = run_ocr_benchmark(
            pdf_bytes=self.pdf,
            candidates=["a"],
            max_pages=1,
            provider_factory=broken,
        )
        self.assertEqual(run.results[0].error, "модель недоступна")
        self.assertFalse(run.results[0].succeeded)

    def test_empty_candidates_rejected(self):
        with self.assertRaises(OcrBenchmarkDisabled):
            run_ocr_benchmark(pdf_bytes=self.pdf, candidates=[], max_pages=1)

    def test_report_refuses_to_name_a_winner(self):
        run = run_ocr_benchmark(
            pdf_bytes=self.pdf,
            candidates=["a", "b"],
            max_pages=1,
            provider_factory=self._factory,
        )
        report = run.render_report()
        self.assertIn("Победитель не выбран автоматически", report)
        self.assertIn("a", report)
        self.assertIn("b", report)


class MetricTests(SimpleTestCase):
    def _metrics(self, text: str):
        return PageOcrResult(
            page_number=1, image_sha256="x", text=text, succeeded=True
        ).metrics()

    def test_detects_narration_instead_of_transcription(self):
        narrated = self._metrics("На странице изображена формула движения.")
        clean = self._metrics("Определение. Скорость есть производная.")
        self.assertTrue(narrated["looks_like_narration"])
        self.assertFalse(clean["looks_like_narration"])

    def test_detects_refusal(self):
        self.assertTrue(self._metrics("I'm sorry, I cannot help.")["looks_like_narration"])

    def test_detects_markdown_fence(self):
        self.assertTrue(self._metrics("```\nтекст\n```")["has_markdown_fence"])

    def test_counts_latex_markers(self):
        self.assertEqual(self._metrics(r"$x$ и \frac{a}{b}")["latex_marker_count"], 3)

    def test_counts_structure_markers(self):
        metrics = self._metrics("Определение. Теорема 1. Задача 2. Решение.")
        self.assertEqual(metrics["structure_marker_count"], 4)

    def test_cyrillic_ratio(self):
        self.assertEqual(self._metrics("абв")["cyrillic_ratio"], 1.0)
        self.assertEqual(self._metrics("abc")["cyrillic_ratio"], 0.0)

    def test_empty_text_does_not_divide_by_zero(self):
        self.assertEqual(self._metrics("")["cyrillic_ratio"], 0.0)


class RunIntegrityTests(SimpleTestCase):
    def test_mismatched_images_detected(self):
        run = OcrBenchmarkRun(image_hashes=["h1", "h2"])
        from curriculum.ocr_benchmark import OcrCandidateResult

        bad = OcrCandidateResult(model="a", calls=2)
        bad.pages = [
            PageOcrResult(page_number=1, image_sha256="h1", succeeded=True),
            PageOcrResult(page_number=2, image_sha256="DIFFERENT", succeeded=True),
        ]
        run.results.append(bad)
        self.assertFalse(run.inputs_identical())

    def test_retry_detected_as_extra_call(self):
        from curriculum.ocr_benchmark import OcrCandidateResult

        run = OcrBenchmarkRun(image_hashes=["h1"])
        retried = OcrCandidateResult(model="a", calls=2)
        retried.pages = [PageOcrResult(page_number=1, image_sha256="h1")]
        run.results.append(retried)
        self.assertFalse(run.one_call_per_page())
