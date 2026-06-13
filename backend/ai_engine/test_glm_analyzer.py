from __future__ import annotations

import copy
import os
import base64
from unittest.mock import patch

import cv2
import numpy as np
from django.test import TestCase
from rest_framework.test import APIClient

from ai_engine.canvas_analyzer import (
    AnalyzerValidationError,
    analyze_canvas_with_glm,
    parse_json_with_repair,
    validate_analyzer_response,
)


def test_canvas_png_base64() -> str:
    img = np.full((32, 32, 3), 255, dtype=np.uint8)
    cv2.line(img, (6, 24), (25, 24), (0, 0, 0), 2)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return base64.b64encode(buf).decode("ascii")


def valid_inclined_plane_response() -> dict:
    return {
        "schema_version": "0.2",
        "language": "ru",
        "recognized_topics": [
            {
                "id": "topic_1",
                "title": "Брусок на наклонной плоскости",
                "discipline": "physics",
                "confidence": 0.92,
                "short_description": "На доске изображён брусок на наклонной плоскости с силами.",
            }
        ],
        "lessons": [
            {
                "id": "lesson_1",
                "topic_id": "topic_1",
                "title": "Анализ сил на наклонной плоскости",
                "academic_explanation": [
                    {
                        "phase": "Анализ условия",
                        "order": 1,
                        "text": "Рассматриваем брусок на наклонной плоскости под углом θ.",
                        "diagram_refs": ["diagram_1"],
                    },
                    {
                        "phase": "Базовые законы",
                        "order": 2,
                        "text": "Используем второй закон Ньютона и разложение силы тяжести.",
                        "diagram_refs": ["diagram_1"],
                    },
                    {
                        "phase": "Вывод",
                        "order": 3,
                        "text": "Проецируем силы вдоль и перпендикулярно плоскости.",
                        "diagram_refs": ["diagram_1"],
                    },
                    {
                        "phase": "Итог",
                        "order": 4,
                        "text": "Итоговые уравнения связывают ускорение, трение и угол наклона.",
                        "diagram_refs": ["diagram_1"],
                    },
                ],
            }
        ],
        "diagrams": [
            {
                "id": "diagram_1",
                "topic_id": "topic_1",
                "title": "Схема сил",
                "purpose": "Показывает силы, действующие на брусок.",
                "diagram_type": "free_body_diagram",
                "render_style": "scientific_flat_textbook",
                "vector_layout": {
                    "type": "vector_layout",
                    "schema_version": "0.1",
                    "canvas": {"aspect_ratio": "16:9", "background": "white", "layout_slot": "main_diagram"},
                    "components": [
                        {"id": "incline1", "type": "surface", "shape": "incline", "angle_deg": 30, "label": "θ"},
                        {"id": "block1", "type": "body", "shape": "block", "label": "m", "on": "incline1", "size": "medium"},
                        {"id": "weight", "type": "vector", "kind": "force", "subtype": "weight", "target": "block1.center", "direction": "down", "label": "mg"},
                        {
                            "id": "normal",
                            "type": "vector",
                            "kind": "force",
                            "subtype": "normal",
                            "target": "block1.center",
                            "direction": {"perpendicular_to": "incline1", "side": "outward"},
                            "label": "N",
                        },
                        {
                            "id": "friction",
                            "type": "vector",
                            "kind": "force",
                            "subtype": "friction",
                            "target": "block1.center",
                            "direction": {"parallel_to": "incline1", "sense": "up_slope"},
                            "label": "f",
                        },
                        {"id": "theta", "type": "angle_arc", "between": ["incline1", "horizontal"], "label": "θ"},
                    ],
                },
            }
        ],
        "canvas_storyboard": {
            "id": "storyboard_1",
            "layout_mode": "step_by_step_board",
            "reading_order": "top_to_bottom",
            "slides": [
                {
                    "id": "slide_1",
                    "order": 1,
                    "title": "Схема и анализ условия",
                    "layout": "left_text_right_diagram",
                    "blocks": [
                        {
                            "id": "text_1",
                            "type": "text_block",
                            "role": "phase_summary",
                            "lesson_id": "lesson_1",
                            "phase": "Анализ условия",
                            "order": 1,
                            "placement": "left_column",
                            "text": "На рисунке показан брусок на наклонной плоскости.",
                            "max_lines": 4,
                        },
                        {
                            "id": "diagram_block_1",
                            "type": "diagram_ref",
                            "diagram_id": "diagram_1",
                            "order": 2,
                            "placement": "right_column",
                        },
                    ],
                },
                {
                    "id": "slide_2",
                    "order": 2,
                    "title": "Законы и вывод",
                    "layout": "vertical_steps",
                    "blocks": [
                        {
                            "id": "text_2",
                            "type": "formula_block",
                            "role": "law",
                            "lesson_id": "lesson_1",
                            "phase": "Базовые законы",
                            "order": 1,
                            "placement": "top",
                            "text": "Используем ΣF = ma.",
                            "max_lines": 2,
                        }
                    ],
                },
            ],
        },
        "render_requests": [
            {
                "id": "render_1",
                "type": "canvas_render",
                "storyboard_id": "storyboard_1",
                "diagram_ids": ["diagram_1"],
                "style": "scientific_flat_textbook",
                "text_rendering": "deterministic_overlay",
                "fallback": "svg",
            }
        ],
    }


class GlmAnalyzerValidatorTests(TestCase):
    def assert_invalid(self, data: dict, needle: str) -> None:
        with self.assertRaises(AnalyzerValidationError) as ctx:
            validate_analyzer_response(data)
        self.assertIn(needle, "; ".join(ctx.exception.errors))

    def test_json_repair_then_validation(self) -> None:
        raw = "```json\n{\"schema_version\":\"0.2\",}\n```"
        result = parse_json_with_repair(raw)
        self.assertTrue(result.repaired)
        self.assertEqual(result.data["schema_version"], "0.2")

    def test_positive_single_topic_inclined_plane(self) -> None:
        validate_analyzer_response(valid_inclined_plane_response())

    def test_positive_multi_diagram_free_body(self) -> None:
        data = valid_inclined_plane_response()
        second = copy.deepcopy(data["diagrams"][0])
        second["id"] = "diagram_2"
        second["title"] = "Оси проекций"
        second["diagram_type"] = "mechanics_diagram"
        second["vector_layout"]["components"].append({"id": "axes1", "type": "axis", "x_label": "x", "y_label": "y"})
        data["diagrams"].append(second)
        data["lessons"][0]["academic_explanation"][2]["diagram_refs"] = ["diagram_2"]
        data["render_requests"][0]["diagram_ids"].append("diagram_2")
        validate_analyzer_response(data)

    def test_positive_multi_topic_multi_slide(self) -> None:
        data = valid_inclined_plane_response()
        data["recognized_topics"].append(
            {
                "id": "topic_2",
                "title": "График функции",
                "discipline": "mathematics",
                "confidence": 0.7,
                "short_description": "На доске также намечен график.",
            }
        )
        lesson = copy.deepcopy(data["lessons"][0])
        lesson["id"] = "lesson_2"
        lesson["topic_id"] = "topic_2"
        data["lessons"].append(lesson)
        data["canvas_storyboard"]["slides"][1]["blocks"].append(
            {
                "id": "text_3",
                "type": "text_block",
                "role": "phase_summary",
                "lesson_id": "lesson_2",
                "phase": "Анализ условия",
                "order": 2,
                "placement": "middle",
                "text": "Вторая тема выделяется отдельным уроком.",
                "max_lines": 3,
            }
        )
        validate_analyzer_response(data)

    def test_positive_water_cycle_process_diagram(self) -> None:
        data = valid_inclined_plane_response()
        data["recognized_topics"][0].update({
            "title": "Круговорот воды",
            "discipline": "biology",
            "short_description": "Показан процесс испарения, конденсации и осадков.",
        })
        data["diagrams"][0].update({
            "title": "Процесс круговорота воды",
            "diagram_type": "process_diagram",
            "purpose": "Показывает последовательность этапов процесса.",
        })
        validate_analyzer_response(data)

    def test_missing_final_phase_fails(self) -> None:
        data = valid_inclined_plane_response()
        data["lessons"][0]["academic_explanation"].pop()
        self.assert_invalid(data, "exactly 4 phases")

    def test_wrong_phase_order_fails(self) -> None:
        data = valid_inclined_plane_response()
        phases = data["lessons"][0]["academic_explanation"]
        phases[1], phases[2] = phases[2], phases[1]
        self.assert_invalid(data, "phase 2 must be Базовые законы")

    def test_unknown_diagram_reference_fails(self) -> None:
        data = valid_inclined_plane_response()
        data["lessons"][0]["academic_explanation"][0]["diagram_refs"] = ["missing"]
        self.assert_invalid(data, "unknown diagram")

    def test_floating_text_without_placement_fails(self) -> None:
        data = valid_inclined_plane_response()
        del data["canvas_storyboard"]["slides"][0]["blocks"][0]["placement"]
        self.assert_invalid(data, "block missing placement")

    def test_raw_svg_string_fails(self) -> None:
        data = valid_inclined_plane_response()
        data["diagrams"][0]["vector_layout"]["components"].append({"id": "bad", "type": "label", "text": "<svg></svg>"})
        self.assert_invalid(data, "Forbidden raw SVG string")

    def test_raw_path_data_fails(self) -> None:
        data = valid_inclined_plane_response()
        data["diagrams"][0]["vector_layout"]["components"][0]["path"] = "M 10 20 C 30 40 50 60 70 80"
        self.assert_invalid(data, "Forbidden raw SVG/path key")

    def test_point_arrays_fail(self) -> None:
        data = valid_inclined_plane_response()
        data["diagrams"][0]["vector_layout"]["components"][0]["points"] = [[0, 0], [100, 100]]
        self.assert_invalid(data, "Forbidden points array")

    def test_empty_recognized_topics_fails(self) -> None:
        data = valid_inclined_plane_response()
        data["recognized_topics"] = []
        self.assert_invalid(data, "recognized_topics must be a non-empty array")


class CanvasAnalyzerEndpointTests(TestCase):
    def setUp(self) -> None:
        self.client = APIClient()

    @patch("ai_engine.canvas_analyzer_views.analyze_canvas_with_glm")
    def test_endpoint_returns_frontend_ready_shape(self, mock_analyze) -> None:
        mock_analyze.return_value = (valid_inclined_plane_response(), False, "{}")
        res = self.client.post(
            "/api/ai/analyze-canvas/",
            {"image": f"data:image/png;base64,{test_canvas_png_base64()}"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("recognized_topics", body)
        self.assertIn("lessons", body)
        self.assertIn("canvas_storyboard", body)
        self.assertIn("rendered_diagrams", body)
        self.assertEqual(body["rendered_diagrams"][0]["source_of_truth"], "svg")
        self.assertEqual(body["rendered_diagrams"][0]["render_status"], "svg_only")
        self.assertFalse(body["meta"]["flux_called"])

    @patch("ai_engine.canvas_analyzer_views.analyze_canvas_with_glm")
    def test_endpoint_validation_error_shape(self, mock_analyze) -> None:
        mock_analyze.side_effect = AnalyzerValidationError(["bad phase"])
        res = self.client.post(
            "/api/ai/analyze-canvas/",
            {"image": f"data:image/png;base64,{test_canvas_png_base64()}"},
            format="json",
        )
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()["error"]["code"], "GLM_VALIDATION_FAILED")

    @patch("ai_engine.canvas_analyzer_views.VectorRenderer.render")
    @patch("ai_engine.canvas_analyzer_views.analyze_canvas_with_glm")
    def test_one_diagram_render_failure_keeps_response(self, mock_analyze, mock_render) -> None:
        mock_analyze.return_value = (valid_inclined_plane_response(), False, "{}")
        mock_render.side_effect = RuntimeError("renderer exploded")
        res = self.client.post(
            "/api/ai/analyze-canvas/",
            {"image": f"data:image/png;base64,{test_canvas_png_base64()}"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["rendered_diagrams"][0]["render_status"], "render_failed")
        self.assertIn("lessons", body)


class OptionalRealGlmAnalyzerTest(TestCase):
    def test_real_glm_call_is_opt_in(self) -> None:
        if os.getenv("RUN_REAL_GLM_ANALYZER_TEST") != "1":
            self.skipTest("Real GLM analyzer call skipped; set RUN_REAL_GLM_ANALYZER_TEST=1 to enable.")
        data, repaired, _raw = analyze_canvas_with_glm(test_canvas_png_base64())
        validate_analyzer_response(data)
        self.assertIsInstance(repaired, bool)
