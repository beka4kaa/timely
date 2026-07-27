from __future__ import annotations

import base64
import copy
import json
import math
import os
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any
from unittest import skipUnless
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from ai_engine import vector_pipeline
from ai_engine.vector_renderer import (
    VectorRenderError,
    VectorRenderer,
    svg_to_png_bytes,
)


SEEDREAM_INCLINE_BASE_PROMPT = """
Minimal flat educational physics illustration on a clean white background.
A single gray triangular incline rising 30 degrees to the right. One simple
blue-gray rectangular block resting directly on the incline. The block must
touch one surface only. Clean textbook geometry, balanced composition, thin
dark outlines, subtle flat shading, generous whitespace.

Do not draw text, letters, numbers, equations, force arrows, arrowheads,
callout lines, angle arcs, labels, annotations, extra blocks, support rods,
external forces, decorations, shadows behind objects, or UI elements.
""".strip()

# Промпт опциональной стилизации: чистый детерминированный PNG уходит в
# image-модель как reference, та меняет ТОЛЬКО «почерк». Провайдер берётся из
# IMAGE_GEN_MODEL — тест модель-агностичен.
RASTER_STYLE_PROMPT = (
    "Educational whiteboard illustration, clean black pencil sketch, preserve "
    "exact geometry, preserve all arrows, preserve all labels, no extra objects, "
    "no distorted text."
)


def solid_png_data_url(gray_level: int) -> str:
    import cv2
    import numpy as np

    pixels = np.full((64, 64, 3), gray_level, dtype=np.uint8)
    ok, encoded = cv2.imencode(".png", pixels)
    if not ok:
        raise AssertionError("OpenCV could not encode the test fixture")
    return "data:image/png;base64," + base64.b64encode(encoded.tobytes()).decode(
        "ascii"
    )


def math_graph_layout() -> dict[str, Any]:
    return {
        "type": "vector_layout",
        "schema_version": "0.1",
        "canvas": {"width": 1024, "height": 768, "background": "white"},
        "components": [
            {
                "id": "axes1",
                "type": "axis",
                "origin": "center",
                "x_label": "x",
                "y_label": "y",
                "show_grid": True,
            },
            {
                "id": "curve1",
                "type": "curve",
                "shape": "parabola",
                "coordinate_system": "axes1",
                "domain": [-3, 3],
                "parameters": {"a": 1, "h": 0, "k": 0},
                "label": "y = x²",
            },
        ],
    }


def free_body_layout() -> dict[str, Any]:
    return {
        "type": "vector_layout",
        "schema_version": "0.1",
        "canvas": {"width": 1024, "height": 576, "background": "white"},
        "components": [
            {
                "id": "incline1",
                "type": "surface",
                "shape": "incline",
                "angle_deg": 30,
            },
            {
                "id": "block1",
                "type": "body",
                "shape": "block",
                "on": "incline1",
                "size": "medium",
            },
            {
                "id": "weight",
                "type": "vector",
                "kind": "force",
                "subtype": "weight",
                "target": "block1.center",
                "direction": "down",
                "label": "Сила тяжести mg",
                "length": "medium",
            },
            {
                "id": "normal",
                "type": "vector",
                "kind": "force",
                "subtype": "normal",
                "target": "block1.center",
                "direction": {
                    "perpendicular_to": "incline1",
                    "side": "outward",
                },
                "label": "Нормальная реакция N",
                "length": "medium",
            },
            {
                "id": "friction",
                "type": "vector",
                "kind": "force",
                "subtype": "friction",
                "target": "block1.center",
                "direction": {
                    "parallel_to": "incline1",
                    "sense": "up_slope",
                },
                "label": "Сила трения f",
                "length": "medium",
            },
            {
                "id": "theta",
                "type": "angle_arc",
                "between": ["incline1", "horizontal"],
                "label": "30°",
            },
        ],
    }


def spring_block_layout() -> dict[str, Any]:
    return {
        "type": "vector_layout",
        "schema_version": "0.1",
        "canvas": {"width": 1024, "height": 768, "background": "white"},
        "components": [
            {"id": "floor1", "type": "surface", "shape": "floor"},
            {"id": "wall1", "type": "surface", "shape": "wall"},
            {
                "id": "block1",
                "type": "body",
                "shape": "block",
                "label": "m",
                "on": "floor1",
                "size": "medium",
            },
            {
                "id": "spring1",
                "type": "connector",
                "kind": "spring",
                "from": "wall1.right",
                "to": "block1.left",
                "label": "k",
            },
            {
                "id": "displacement",
                "type": "vector",
                "kind": "force",
                "target": "block1.center",
                "direction": "right",
                "label": "x",
                "length": "short",
            },
        ],
    }


def scientific_scene_plan() -> dict[str, Any]:
    return {
        "type": "scientific_scene_plan",
        "schema_version": "0.1",
        "scene_kind": "free_body_diagram",
        "canvas": {"aspect_ratio": "16:9", "background": "white"},
        "objects": [
            {
                "id": "incline1",
                "type": "surface",
                "role": "inclined plane",
                "shape": "incline",
                "count": 1,
                "angle_deg": 30,
            },
            {
                "id": "block1",
                "type": "body",
                "role": "rectangular block",
                "shape": "block",
                "count": 1,
                "size": "medium",
            },
            {
                "id": "angle1",
                "type": "angle_arc",
                "role": "incline angle",
                "shape": "arc",
                "count": 1,
                "between": ["incline1", "horizontal"],
            },
        ],
        "relations": [
            {
                "id": "contact1",
                "type": "contact",
                "subject": "block1.contact",
                "object": "incline1.center",
            },
            {
                "id": "normal_relation",
                "type": "perpendicular_to",
                "subject": "normal",
                "object": "incline1",
                "side": "outward",
            },
            {
                "id": "friction_relation",
                "type": "parallel_to",
                "subject": "friction",
                "object": "incline1",
                "sense": "up_slope",
            },
        ],
        "vectors": [
            {
                "id": "gravity",
                "kind": "force",
                "subtype": "gravity",
                "target": "block1.center",
                "direction": {"type": "down"},
                "length": "medium",
            },
            {
                "id": "normal",
                "kind": "force",
                "subtype": "normal",
                "target": "block1.center",
                "direction": {
                    "type": "perpendicular_to",
                    "reference": "incline1",
                    "side": "outward",
                },
                "length": "medium",
            },
            {
                "id": "friction",
                "kind": "force",
                "subtype": "friction",
                "target": "block1.center",
                "direction": {
                    "type": "parallel_to",
                    "reference": "incline1",
                    "sense": "up_slope",
                },
                "length": "medium",
            },
        ],
        "labels": [
            {
                "id": "gravity_label",
                "text": "Сила тяжести mg",
                "attach_to": "gravity.mid",
                "placement": "right",
            },
            {
                "id": "normal_label",
                "text": "Нормальная реакция N",
                "attach_to": "normal.mid",
                "placement": "above",
            },
            {
                "id": "friction_label",
                "text": "Сила трения f",
                "attach_to": "friction.mid",
                "placement": "above",
            },
            {
                "id": "angle_label",
                "text": "30°",
                "attach_to": "angle1.mid",
                "placement": "right",
            },
        ],
        "constraints": [
            {
                "id": "body_count",
                "type": "exact_count",
                "target": "body",
                "value": 1,
            },
            {
                "id": "surface_count",
                "type": "exact_count",
                "target": "surface",
                "value": 1,
            },
            {
                "id": "force_count",
                "type": "exact_count",
                "target": "force",
                "value": 3,
            },
            {
                "id": "support_count",
                "type": "exact_count",
                "target": "support",
                "value": 0,
            },
            {
                "id": "single_heads",
                "type": "single_headed",
                "target": "force",
                "value": 1,
            },
            {
                "id": "text_free",
                "type": "text_free_raster",
                "target": "image",
                "value": 1,
            },
            {
                "id": "label_match",
                "type": "labels_match_components",
                "target": "labels",
                "value": 1,
            },
        ],
        "render_prompt": (
            "Professional flat scientific textbook illustration with clean "
            "outlines and restrained colors."
        ),
    }


def _svg_root(svg: str) -> ET.Element:
    return ET.fromstring(svg)


def _elements(root: ET.Element, tag: str) -> list[ET.Element]:
    return [element for element in root.iter() if element.tag.rsplit("}", 1)[-1] == tag]


def _segment_intersects_box(
    start: tuple[float, float],
    end: tuple[float, float],
    box: tuple[float, float, float, float],
) -> bool:
    x1, y1 = start
    x2, y2 = end
    left, top, right, bottom = box
    dx, dy = x2 - x1, y2 - y1
    lower, upper = 0.0, 1.0
    for p, q in (
        (-dx, x1 - left),
        (dx, right - x1),
        (-dy, y1 - top),
        (dy, bottom - y1),
    ):
        if abs(p) < 1e-9:
            if q < 0:
                return False
            continue
        ratio = q / p
        if p < 0:
            lower = max(lower, ratio)
        else:
            upper = min(upper, ratio)
        if lower > upper:
            return False
    return True


class VectorDslPrototypeTests(SimpleTestCase):
    fixtures = {
        "math_graph": math_graph_layout,
        "free_body": free_body_layout,
        "spring_block": spring_block_layout,
    }

    def test_fixture_svgs_are_safe_and_backend_generated(self) -> None:
        renderer = VectorRenderer()
        with tempfile.TemporaryDirectory(prefix="timely-vector-dsl-") as temp_dir:
            artifact_dir = Path(temp_dir)
            for name, factory in self.fixtures.items():
                svg = renderer.render(factory())
                self.assertTrue(svg.startswith("<svg"))
                self.assertIn('fill="white"', svg)
                self.assertRegex(svg, r"<(?:path|line) ")
                self.assertNotIn("<script", svg)
                self.assertNotIn("foreignObject", svg)
                self.assertNotIn("http://", svg.replace('xmlns="http://www.w3.org/2000/svg"', ""))
                artifact = artifact_dir / f"{name}.svg"
                artifact.write_text(svg, encoding="utf-8")
                self.assertTrue(artifact.exists())

            self.assertIn("y = x²", renderer.render(math_graph_layout()))
            self.assertIn("Сила тяжести mg", renderer.render(free_body_layout()))
            self.assertIn(">k<", renderer.render(spring_block_layout()))

    def test_svg_to_png_bytes_uses_existing_safe_subset_fallback(self) -> None:
        renderer = VectorRenderer()
        for factory in self.fixtures.values():
            png = svg_to_png_bytes(renderer.render(factory()))
            self.assertGreater(len(png), 100)
            self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")

    def test_free_body_has_exactly_three_single_headed_forces(self) -> None:
        root = _svg_root(VectorRenderer().render(free_body_layout()))
        forces = [
            element
            for element in _elements(root, "line")
            if element.attrib.get("data-role") == "force-vector"
        ]
        self.assertEqual(len(forces), 3)
        self.assertEqual(
            {element.attrib.get("data-vector-subtype") for element in forces},
            {"weight", "normal", "friction"},
        )
        for force in forces:
            self.assertIn("marker-end", force.attrib)
            self.assertNotIn("marker-start", force.attrib)
        self.assertEqual(
            {element.attrib["stroke"] for element in forces},
            {"#2563EB", "#2E7D32", "#C43D35"},
        )

    def test_free_body_angle_is_one_small_30_degree_arc(self) -> None:
        root = _svg_root(VectorRenderer().render(free_body_layout()))
        arcs = [
            element
            for element in _elements(root, "path")
            if element.attrib.get("data-role") == "angle-arc"
        ]
        self.assertEqual(len(arcs), 1)
        self.assertGreaterEqual(float(arcs[0].attrib["data-radius"]), 28)
        self.assertLessEqual(float(arcs[0].attrib["data-radius"]), 36)
        labels = [
            "".join(element.itertext())
            for element in _elements(root, "text")
            if element.attrib.get("data-role") == "angle-label"
        ]
        self.assertEqual(labels, ["30°"])

    def test_block_bottom_anchor_touches_the_incline(self) -> None:
        renderer = VectorRenderer()
        renderer.render(free_body_layout())
        surface = renderer.surfaces["incline1"]
        contact = renderer.anchors["block1.bottom"]
        relative = contact - surface.left
        signed_distance = abs(
            relative.x * surface.normal.x + relative.y * surface.normal.y
        )
        self.assertLess(signed_distance, 0.05)

    def test_vector_labels_do_not_intersect_any_force(self) -> None:
        root = _svg_root(VectorRenderer().render(free_body_layout()))
        force_segments = [
            (
                (float(line.attrib["x1"]), float(line.attrib["y1"])),
                (float(line.attrib["x2"]), float(line.attrib["y2"])),
            )
            for line in _elements(root, "line")
            if line.attrib.get("data-role") == "force-vector"
        ]
        labels = [
            element
            for element in _elements(root, "text")
            if element.attrib.get("data-role") == "vector-label"
        ]
        self.assertEqual(len(labels), 3)
        for label in labels:
            box = tuple(float(value) for value in label.attrib["data-bbox"].split(","))
            self.assertEqual(len(box), 4)
            for start, end in force_segments:
                self.assertFalse(
                    _segment_intersects_box(start, end, box),
                    f"{label.attrib.get('data-for')} intersects force {start}->{end}",
                )

    def test_default_svg_labels_have_no_leader_lines_or_external_force(self) -> None:
        svg = VectorRenderer().render(free_body_layout())
        self.assertNotIn('data-role="leader-line"', svg)
        self.assertNotIn("Внешняя сила", svg)
        self.assertNotRegex(svg, r">F(?:</text>|\\s)")

    def test_same_request_is_pixel_geometry_deterministic_five_times(self) -> None:
        outputs = [VectorRenderer().render(free_body_layout()) for _ in range(5)]
        self.assertTrue(all(output == outputs[0] for output in outputs[1:]))

    def test_seedream_base_prompt_forbids_scientific_overlay_content(self) -> None:
        lower = SEEDREAM_INCLINE_BASE_PROMPT.lower()
        for forbidden in (
            "text",
            "force arrows",
            "arrowheads",
            "angle arcs",
            "labels",
            "external forces",
            "ui elements",
        ):
            self.assertIn(forbidden, lower)
        self.assertIn("single gray triangular incline", lower)
        self.assertIn("one simple", lower)

    def test_unknown_component_type_fails(self) -> None:
        layout = math_graph_layout()
        layout["components"].append({"id": "bad", "type": "raw_svg_widget"})
        with self.assertRaises(VectorRenderError):
            VectorRenderer().render(layout)

    def test_unknown_curve_shape_fails(self) -> None:
        layout = math_graph_layout()
        layout["components"][1]["shape"] = "squiggle"
        with self.assertRaises(VectorRenderError):
            VectorRenderer().render(layout)

    def test_raw_svg_passthrough_fails(self) -> None:
        layout = math_graph_layout()
        layout["components"].append(
            {
                "id": "raw",
                "type": "label",
                "attach_to": "axes1.center",
                "text": "<svg><script/></svg>",
            }
        )
        with self.assertRaises(VectorRenderError):
            VectorRenderer().render(layout)

    def test_missing_anchor_fails(self) -> None:
        layout = math_graph_layout()
        layout["components"].append(
            {
                "id": "missing",
                "type": "math_label",
                "text": "F = ma",
                "attach_to": "missing.center",
                "placement": "above",
            }
        )
        with self.assertRaises(VectorRenderError):
            VectorRenderer().render(layout)

    def test_model_point_arrays_fail(self) -> None:
        layout = math_graph_layout()
        layout["components"].append(
            {
                "id": "bad_curve",
                "type": "curve",
                "shape": "line",
                "coordinate_system": "axes1",
                "domain": [0, 1],
                "points": [[0, 0], [1, 1]],
            }
        )
        with self.assertRaises(VectorRenderError):
            VectorRenderer().render(layout)

    def test_external_url_in_label_fails(self) -> None:
        layout = math_graph_layout()
        layout["components"].append(
            {
                "id": "external",
                "type": "label",
                "attach_to": "axes1.center",
                "text": "https://example.com",
            }
        )
        with self.assertRaises(VectorRenderError):
            VectorRenderer().render(layout)

    @skipUnless(
        os.getenv("RUN_REAL_VECTOR_STYLE_TEST") == "1",
        "Existing image provider call is opt-in; set RUN_REAL_VECTOR_STYLE_TEST=1.",
    )
    def test_optional_existing_image_client_preserves_structure(self) -> None:
        from ai_engine.image_enrichment import generate_raster_image

        svg = VectorRenderer().render(free_body_layout())
        png = svg_to_png_bytes(svg)
        reference = (
            "data:image/png;base64,"
            + base64.b64encode(png).decode("ascii")
        )
        result = generate_raster_image(
            RASTER_STYLE_PROMPT,
            style="flat",
            reference_image_url=reference,
            task_diagram=True,
            scientific_diagram=True,
        )
        self.assertTrue(
            result.startswith("data:image/") or result.startswith("https://")
        )


class VectorGeometryOnlyLabelTests(SimpleTestCase):
    """Geometry-only режим: растр без единой буквы + подписи структурой.

    Это контракт доски. Текст, впечатанный в пиксели, там не нужен и вреден:
    подписи живут отдельным DOM-слоем, их можно таскать мышью и уводить за
    пределы кадра, а выноска должна продолжать смотреть на научную цель.
    """

    def test_geometry_only_svg_contains_no_text_at_all(self) -> None:
        for name, factory in (
            ("math_graph", math_graph_layout),
            ("free_body", free_body_layout),
            ("spring_block", spring_block_layout),
        ):
            with self.subTest(layout=name):
                svg, _ = VectorRenderer(emit_text=False).render_with_labels(factory())
                self.assertNotIn("<text", svg)
                # Геометрия при этом никуда не делась.
                self.assertRegex(svg, r"<(?:path|line|rect|polygon) ")

    def test_default_renderer_still_draws_text(self) -> None:
        """emit_text=True — прежнее поведение, на него опираются другие тесты."""
        svg = VectorRenderer().render(free_body_layout())
        self.assertIn("<text", svg)
        self.assertIn("Сила тяжести mg", svg)

    def test_free_body_labels_carry_content_kind_and_anchor(self) -> None:
        _, labels = VectorRenderer(emit_text=False).render_with_labels(free_body_layout())

        self.assertEqual(len(labels), 4)
        by_content = {label["content"]: label for label in labels}
        self.assertEqual(
            set(by_content),
            {"Сила тяжести mg", "Нормальная реакция N", "Сила трения f", "30°"},
        )
        for content in ("Сила тяжести mg", "Нормальная реакция N", "Сила трения f"):
            self.assertEqual(by_content[content]["target_kind"], "vector")
        self.assertEqual(by_content["30°"]["target_kind"], "angle")

    def test_label_coordinates_are_percentages_of_the_canvas(self) -> None:
        _, labels = VectorRenderer(emit_text=False).render_with_labels(free_body_layout())
        for label in labels:
            with self.subTest(label=label["content"]):
                for value in (label["x"], label["y"], label["arrow_to"]["x"], label["arrow_to"]["y"]):
                    self.assertGreaterEqual(value, 0.0)
                    self.assertLessEqual(value, 100.0)

    def test_force_label_anchor_is_the_mid_shaft_of_its_own_arrow(self) -> None:
        """arrow_to обязан указывать на СЕРЕДИНУ ДРЕВКА силы.

        Не на центр тела (выноска туда читается как ещё одна сила) и не на
        наконечник (читается как продолжение стрелки).
        """
        renderer = VectorRenderer(emit_text=False)
        svg, labels = renderer.render_with_labels(free_body_layout())
        root = _svg_root(svg)
        width = float(root.attrib["width"])
        height = float(root.attrib["height"])

        forces = {
            element.attrib["data-vector-subtype"]: element
            for element in _elements(root, "line")
            if element.attrib.get("data-role") == "force-vector"
        }
        expected_subtype = {
            "Сила тяжести mg": "weight",
            "Нормальная реакция N": "normal",
            "Сила трения f": "friction",
        }

        for label in labels:
            subtype = expected_subtype.get(label["content"])
            if subtype is None:
                continue
            with self.subTest(force=subtype):
                force = forces[subtype]
                mid_x = (float(force.attrib["x1"]) + float(force.attrib["x2"])) / 2
                mid_y = (float(force.attrib["y1"]) + float(force.attrib["y2"])) / 2
                self.assertAlmostEqual(
                    label["arrow_to"]["x"], mid_x / width * 100, delta=0.2
                )
                self.assertAlmostEqual(
                    label["arrow_to"]["y"], mid_y / height * 100, delta=0.2
                )

    def test_angle_label_anchor_sits_on_the_arc(self) -> None:
        renderer = VectorRenderer(emit_text=False)
        svg, labels = renderer.render_with_labels(free_body_layout())
        root = _svg_root(svg)
        width = float(root.attrib["width"])
        height = float(root.attrib["height"])
        arc = next(
            element
            for element in _elements(root, "path")
            if element.attrib.get("data-role") == "angle-arc"
        )
        center_x = float(arc.attrib["data-center-x"])
        center_y = float(arc.attrib["data-center-y"])
        radius = float(arc.attrib["data-radius"])

        angle_label = next(label for label in labels if label["content"] == "30°")
        anchor_x = angle_label["arrow_to"]["x"] / 100 * width
        anchor_y = angle_label["arrow_to"]["y"] / 100 * height
        self.assertAlmostEqual(
            math.hypot(anchor_x - center_x, anchor_y - center_y), radius, delta=1.5
        )

    def test_labels_do_not_sit_exactly_on_their_own_anchor(self) -> None:
        """Текст поверх собственной цели — это подпись, закрывающая объект."""
        _, labels = VectorRenderer(emit_text=False).render_with_labels(free_body_layout())
        for label in labels:
            with self.subTest(label=label["content"]):
                distance = math.hypot(
                    label["x"] - label["arrow_to"]["x"],
                    label["y"] - label["arrow_to"]["y"],
                )
                self.assertGreater(distance, 1.0)

    def test_geometry_only_output_is_deterministic_five_times(self) -> None:
        results = [
            VectorRenderer(emit_text=False).render_with_labels(free_body_layout())
            for _ in range(5)
        ]
        first_svg, first_labels = results[0]
        for svg, labels in results[1:]:
            self.assertEqual(svg, first_svg)
            self.assertEqual(labels, first_labels)

    def test_geometry_only_png_survives_non_ascii_labels(self) -> None:
        """OpenCV-fallback умеет рисовать только ASCII (cv2.putText), из-за чего
        кириллица молча пропадала из PNG. В geometry-only режиме рисовать нечего,
        поэтому расхождения SVG↔PNG больше нет."""
        svg, labels = VectorRenderer(emit_text=False).render_with_labels(free_body_layout())
        self.assertTrue(any(not label["content"].isascii() for label in labels))
        png = svg_to_png_bytes(svg)
        self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")
        self.assertGreater(len(png), 100)


class VectorDslValidationIsolationTests(SimpleTestCase):
    def test_non_string_canvas_background_fails_cleanly(self) -> None:
        layout = free_body_layout()
        layout["canvas"]["background"] = {"paint": "white"}
        with self.assertRaises(VectorRenderError):
            VectorRenderer().render(layout)

    def test_validation_does_not_mutate_model_input(self) -> None:
        layout = free_body_layout()
        original = copy.deepcopy(layout)
        VectorRenderer().render(layout)
        self.assertEqual(layout, original)

    def test_weight_direction_stays_vertical_at_multiple_incline_angles(self) -> None:
        for angle in (20, 30, 45):
            layout = free_body_layout()
            layout["components"][0]["angle_deg"] = angle
            root = _svg_root(VectorRenderer().render(layout))
            weight = next(
                element
                for element in _elements(root, "line")
                if element.attrib.get("data-vector-subtype") == "weight"
            )
            self.assertAlmostEqual(
                float(weight.attrib["x1"]),
                float(weight.attrib["x2"]),
                places=1,
            )

    def test_normal_and_friction_remain_perpendicular(self) -> None:
        root = _svg_root(VectorRenderer().render(free_body_layout()))
        vectors = {
            element.attrib["data-vector-subtype"]: element
            for element in _elements(root, "line")
            if element.attrib.get("data-role") == "force-vector"
        }

        def angle(element: ET.Element) -> float:
            dx = float(element.attrib["x2"]) - float(element.attrib["x1"])
            dy = float(element.attrib["y2"]) - float(element.attrib["y1"])
            return math.degrees(math.atan2(-dy, dx))

        delta = abs(
            ((angle(vectors["normal"]) - angle(vectors["friction"]) + 180) % 360)
            - 180
        )
        self.assertAlmostEqual(delta, 90, delta=0.15)


class VectorPipelineTests(SimpleTestCase):
    """Оркестрация: гейтинг, фича-флаг и — главное — фолбэк.

    Инвариант всего модуля: он либо отдаёт корректную схему, либо возвращает
    None. Исключение наружу означало бы, что пользователь вместо картинки
    получил 500 там, где мог получить растр.
    """

    def _enable(self):
        return patch("ai_engine.vector_pipeline._enabled", return_value=True)

    def test_disabled_flag_declines_immediately(self) -> None:
        with patch("ai_engine.vector_pipeline._enabled", return_value=False):
            with patch("ai_engine.vector_pipeline._plan_scene") as planner:
                result = vector_pipeline.try_build_vector_illustration(
                    "block on an inclined plane with all forces"
                )
        self.assertIsNone(result)
        # Выключенный путь не должен стоить запроса к модели.
        planner.assert_not_called()

    def test_unsupported_subject_is_left_to_the_raster_path(self) -> None:
        """DSL не умеет круговорот воды — берёмся только за своё."""
        with self._enable():
            with patch("ai_engine.vector_pipeline._plan_scene") as planner:
                result = vector_pipeline.try_build_vector_illustration(
                    "The water cycle: evaporation, condensation and rain"
                )
        self.assertIsNone(result)
        planner.assert_not_called()

    def test_happy_path_returns_text_free_png_and_anchored_labels(self) -> None:
        with self._enable():
            with patch(
                "ai_engine.vector_pipeline._plan_scene",
                return_value=scientific_scene_plan(),
            ):
                result = vector_pipeline.try_build_vector_illustration(
                    "block on an inclined plane, show all forces"
                )

        self.assertIsNotNone(result)
        assert result is not None  # для type-checker
        self.assertTrue(result["base_image_url"].startswith("data:image/png;base64,"))
        self.assertIsNone(result["masks"])
        self.assertEqual(result["gen_style"], vector_pipeline.VECTOR_GEN_STYLE)

        labels = result["labels"]
        self.assertEqual(len(labels), 4)
        for label in labels:
            with self.subTest(label=label["content"]):
                self.assertIn("arrow_to", label)
                self.assertIn(label["target_kind"], {"vector", "angle", "object", "region"})

    def test_planner_failure_falls_back(self) -> None:
        with self._enable():
            with patch(
                "ai_engine.vector_pipeline._plan_scene", return_value=None
            ):
                self.assertIsNone(
                    vector_pipeline.try_build_vector_illustration(
                        "block on an inclined plane, show all forces"
                    )
                )

    def test_layout_that_fails_validation_falls_back(self) -> None:
        """Модель попыталась протащить пиксели — путь обязан отказаться, а не
        упасть: валидатор для того и стоит на границе LLM → бэкенд."""
        poisoned = scientific_scene_plan()
        poisoned["objects"][0]["points"] = [[1, 2], [3, 4]]
        with self._enable():
            with patch(
                "ai_engine.vector_pipeline._plan_scene", return_value=poisoned
            ):
                self.assertIsNone(
                    vector_pipeline.try_build_vector_illustration(
                        "block on an inclined plane, show all forces"
                    )
                )

    def test_renderer_explosion_falls_back_instead_of_raising(self) -> None:
        with self._enable():
            with patch(
                "ai_engine.vector_pipeline._plan_scene",
                return_value=scientific_scene_plan(),
            ):
                with patch(
                    "ai_engine.vector_pipeline.svg_to_png_data_url",
                    side_effect=RuntimeError("converter exploded"),
                ):
                    self.assertIsNone(
                        vector_pipeline.try_build_vector_illustration(
                            "block on an inclined plane, show all forces"
                        )
                    )


class ScientificPlannerCriticPipelineTests(SimpleTestCase):
    def test_qwen_transport_uses_strict_openrouter_json_schema(self) -> None:
        expected = scientific_scene_plan()
        response = Mock()
        response.choices = [
            Mock(message=Mock(content=json.dumps(expected, ensure_ascii=False)))
        ]
        client = Mock()
        client.chat.completions.create.return_value = response

        with patch(
            "ai_engine.vector_pipeline._openrouter_api_key",
            return_value="test-key",
        ), patch(
            "ai_engine.vector_pipeline._openrouter_client",
            return_value=client,
        ):
            result = vector_pipeline._call_qwen_json(
                model="qwen/qwen3.7-plus",
                system_prompt="Return JSON.",
                user_content="Plan this diagram.",
                schema_name="scientific_scene_plan",
                schema=vector_pipeline.SCENE_PLAN_JSON_SCHEMA,
                timeout=10,
                max_tokens=1000,
            )

        self.assertEqual(result, expected)
        payload = client.chat.completions.create.call_args.kwargs
        self.assertEqual(payload["model"], "qwen/qwen3.7-plus")
        self.assertEqual(payload["response_format"]["type"], "json_schema")
        self.assertTrue(payload["response_format"]["json_schema"]["strict"])
        self.assertTrue(payload["extra_body"]["provider"]["require_parameters"])

    def test_planner_returns_valid_strict_json(self) -> None:
        expected = scientific_scene_plan()
        with patch(
            "ai_engine.vector_pipeline._openrouter_api_key",
            return_value="test-key",
        ), patch(
            "ai_engine.vector_pipeline._planner_enabled",
            return_value=True,
        ), patch(
            "ai_engine.vector_pipeline._call_qwen_json",
            return_value=expected,
        ) as qwen:
            result = vector_pipeline._plan_scene(
                "Нарисуй брусок на наклонной плоскости",
                None,
            )
        self.assertEqual(result, expected)
        self.assertEqual(
            qwen.call_args.kwargs["model"],
            "qwen/qwen3.7-plus",
        )

    def test_raw_svg_and_point_arrays_are_rejected(self) -> None:
        raw_svg = scientific_scene_plan()
        raw_svg["objects"][0]["role"] = "<svg><path d='M0,0'/></svg>"
        with self.assertRaises(vector_pipeline.ScenePlanValidationError):
            vector_pipeline.validate_scientific_scene_plan(raw_svg)

        points = scientific_scene_plan()
        points["objects"][0]["points"] = [[0, 0], [1, 1]]
        with self.assertRaises(vector_pipeline.ScenePlanValidationError):
            vector_pipeline.validate_scientific_scene_plan(points)

    def test_missing_anchor_is_rejected(self) -> None:
        plan = scientific_scene_plan()
        plan["labels"][0]["attach_to"] = "missing.mid"
        with self.assertRaises(vector_pipeline.ScenePlanValidationError) as ctx:
            vector_pipeline.validate_scientific_scene_plan(plan)
        self.assertIn("missing component", str(ctx.exception))

    def test_missing_angle_reference_and_false_count_are_rejected(self) -> None:
        missing_angle_ref = scientific_scene_plan()
        angle = next(
            item
            for item in missing_angle_ref["objects"]
            if item["type"] == "angle_arc"
        )
        angle["between"] = ["missing_surface", "horizontal"]
        with self.assertRaises(vector_pipeline.ScenePlanValidationError) as ctx:
            vector_pipeline.validate_scientific_scene_plan(missing_angle_ref)
        self.assertIn("missing component", str(ctx.exception))

        false_count = scientific_scene_plan()
        force_count = next(
            item
            for item in false_count["constraints"]
            if item["id"] == "force_count"
        )
        force_count["value"] = 2
        with self.assertRaises(vector_pipeline.ScenePlanValidationError) as ctx:
            vector_pipeline.validate_scientific_scene_plan(false_count)
        self.assertIn("requires exactly 2 force, found 3", str(ctx.exception))

    def test_normal_force_must_be_perpendicular(self) -> None:
        plan = scientific_scene_plan()
        normal = next(item for item in plan["vectors"] if item["id"] == "normal")
        normal["direction"] = {
            "type": "parallel_to",
            "reference": "incline1",
            "sense": "up_slope",
        }
        with self.assertRaises(vector_pipeline.ScenePlanValidationError) as ctx:
            vector_pipeline.validate_scientific_scene_plan(plan)
        self.assertIn("normal must be perpendicular_to", str(ctx.exception))

    def test_friction_force_must_be_parallel(self) -> None:
        plan = scientific_scene_plan()
        friction = next(
            item for item in plan["vectors"] if item["id"] == "friction"
        )
        friction["direction"] = {
            "type": "perpendicular_to",
            "reference": "incline1",
            "side": "outward",
        }
        with self.assertRaises(vector_pipeline.ScenePlanValidationError) as ctx:
            vector_pipeline.validate_scientific_scene_plan(plan)
        self.assertIn("friction must be parallel_to", str(ctx.exception))

    def test_extra_support_is_rejected(self) -> None:
        plan = scientific_scene_plan()
        plan["objects"].append(
            {
                "id": "rail1",
                "type": "support",
                "role": "extra rail",
                "shape": "rail",
                "count": 1,
            }
        )
        with self.assertRaises(vector_pipeline.ScenePlanValidationError) as ctx:
            vector_pipeline.validate_scientific_scene_plan(plan)
        self.assertIn("forbids extra supports", str(ctx.exception))

    def test_critic_returns_concrete_violation_without_changing_plan(self) -> None:
        plan = scientific_scene_plan()
        violation = {
            "valid": False,
            "score": 0.4,
            "violations": [
                {
                    "type": "wrong_relation",
                    "component": "normal",
                    "description": (
                        "Normal force is not perpendicular to the incline"
                    ),
                    "severity": "high",
                }
            ],
            "repair_action": "regenerate",
            "repair_prompt": "Keep the normal vector perpendicular to the incline.",
        }
        original = copy.deepcopy(plan)
        with patch(
            "ai_engine.vector_pipeline._openrouter_api_key",
            return_value="test-key",
        ), patch(
            "ai_engine.vector_pipeline._critic_enabled",
            return_value=True,
        ), patch(
            "ai_engine.vector_pipeline._call_qwen_json",
            return_value=violation,
        ) as qwen:
            result = vector_pipeline._critique_scene(
                plan,
                "data:image/png;base64,AAAA",
            )
        self.assertEqual(result, violation)
        self.assertEqual(plan, original)
        content = qwen.call_args.kwargs["user_content"]
        self.assertEqual(content[1]["type"], "image_url")
        self.assertEqual(
            content[1]["image_url"]["url"],
            "data:image/png;base64,AAAA",
        )

    def test_invalid_critic_cannot_silently_accept_the_image(self) -> None:
        inconsistent = {
            "valid": False,
            "score": 0.2,
            "violations": [
                {
                    "type": "wrong_count",
                    "component": "force arrows",
                    "description": "The image contains four force arrows.",
                    "severity": "high",
                }
            ],
            "repair_action": "none",
            "repair_prompt": "",
        }
        with self.assertRaises(vector_pipeline.ScenePlanValidationError):
            vector_pipeline.validate_critic_result(inconsistent)

    def test_critic_repair_prompt_cannot_request_generated_labels_or_arrows(
        self,
    ) -> None:
        critic = {
            "valid": False,
            "score": 0.2,
            "violations": [
                {
                    "type": "wrong_count",
                    "component": "body",
                    "description": "There are two blocks.",
                    "severity": "high",
                },
                {
                    "type": "missing_object",
                    "component": "labels",
                    "description": "Labels are missing.",
                    "severity": "high",
                },
                {
                    "type": "wrong_direction",
                    "component": "friction vector",
                    "description": "Reverse the friction vector.",
                    "severity": "medium",
                },
            ],
            "repair_action": "regenerate",
            "repair_prompt": "Add all labels and arrows into the generated image.",
        }
        repair = vector_pipeline._critic_repair_text(critic)
        self.assertIn("physical object exactly once", repair)
        self.assertNotIn("label", repair.lower())
        self.assertNotIn("arrow", repair.lower())
        self.assertNotIn("friction", repair.lower())

    def test_critic_calibration_ignores_backend_owned_overlay_claims(self) -> None:
        plan = scientific_scene_plan()
        raw = {
            "valid": False,
            "score": 0.25,
            "violations": [
                {
                    "type": "missing_object",
                    "component": "angle_arc",
                    "description": "The angle arc is not present.",
                    "severity": "high",
                },
                {
                    "type": "wrong_direction",
                    "component": "normal",
                    "description": "Normal points in the wrong direction.",
                    "severity": "high",
                },
                {
                    "type": "wrong_relation",
                    "component": "friction",
                    "description": "Friction is not parallel to the incline.",
                    "severity": "high",
                },
                {
                    "type": "accidental_text",
                    "component": "labels",
                    "description": "None of the expected labels are present.",
                    "severity": "medium",
                },
                {
                    "type": "missing_contact",
                    "component": "block1",
                    "description": "The block is floating above the incline.",
                    "severity": "high",
                },
            ],
            "repair_action": "regenerate",
            "repair_prompt": "Add the missing labels and arrows.",
        }
        original = copy.deepcopy(raw)

        effective = vector_pipeline._calibrate_critic_result(
            raw,
            plan,
            deterministic_overlay=True,
        )

        self.assertEqual(raw, original)
        self.assertFalse(effective["valid"])
        self.assertEqual(
            [item["type"] for item in effective["violations"]],
            ["missing_contact"],
        )

    def test_critic_calibration_accepts_only_false_overlay_claims(self) -> None:
        raw = {
            "valid": False,
            "score": 0.3,
            "violations": [
                {
                    "type": "wrong_direction",
                    "component": "gravity",
                    "description": "Gravity is not vertical.",
                    "severity": "high",
                },
                {
                    "type": "missing_object",
                    "component": "angle1",
                    "description": "The angle is missing.",
                    "severity": "medium",
                },
            ],
            "repair_action": "regenerate",
            "repair_prompt": "Redraw all arrows.",
        }

        effective = vector_pipeline._calibrate_critic_result(
            raw,
            scientific_scene_plan(),
            deterministic_overlay=True,
        )

        self.assertTrue(effective["valid"])
        self.assertEqual(effective["violations"], [])
        self.assertEqual(effective["repair_action"], "none")
        self.assertGreaterEqual(effective["score"], 0.9)

    def test_pipeline_keeps_raw_critic_but_uses_calibrated_decision(self) -> None:
        generated = solid_png_data_url(224)
        raw = {
            "valid": False,
            "score": 0.3,
            "violations": [
                {
                    "type": "wrong_direction",
                    "component": "normal",
                    "description": "Normal is not perpendicular to the incline.",
                    "severity": "high",
                },
                {
                    "type": "accidental_text",
                    "component": "labels",
                    "description": "None of the expected labels are present.",
                    "severity": "medium",
                },
            ],
            "repair_action": "regenerate",
            "repair_prompt": "Add labels and redraw the normal arrow.",
        }
        with patch(
            "ai_engine.vector_pipeline._pipeline_mode",
            return_value="planner_critic",
        ), patch(
            "ai_engine.vector_pipeline._enabled",
            return_value=True,
        ), patch(
            "ai_engine.vector_pipeline._plan_scene",
            return_value=scientific_scene_plan(),
        ), patch(
            "ai_engine.vector_pipeline._critic_enabled",
            return_value=True,
        ), patch(
            "ai_engine.vector_pipeline._critique_scene",
            return_value=raw,
        ), patch(
            "ai_engine.image_enrichment.generate_raster_image",
            return_value=generated,
        ) as seedream:
            result = vector_pipeline.try_build_vector_illustration(
                "block on an inclined plane with all forces"
            )

        assert result is not None
        metadata = result["diagram_pipeline"]
        self.assertTrue(metadata["critic"]["valid"])
        self.assertEqual(metadata["critic"]["repair_action"], "none")
        self.assertEqual(metadata["critic_raw"], raw)
        self.assertIsNone(metadata["fallback"])
        seedream.assert_called_once()

    def test_qwen_timeout_activates_legacy_fallback(self) -> None:
        with patch(
            "ai_engine.vector_pipeline._pipeline_mode",
            return_value="planner",
        ), patch(
            "ai_engine.vector_pipeline._enabled",
            return_value=True,
        ), patch(
            "ai_engine.vector_pipeline._openrouter_api_key",
            return_value="test-key",
        ), patch(
            "ai_engine.vector_pipeline._call_qwen_json",
            side_effect=TimeoutError("Qwen timeout"),
        ):
            result = vector_pipeline.try_build_vector_illustration(
                "block on an inclined plane with all forces"
            )
        self.assertIsNone(result)

    def test_seedream_timeout_returns_deterministic_png_fallback(self) -> None:
        with patch(
            "ai_engine.vector_pipeline._pipeline_mode",
            return_value="planner",
        ), patch(
            "ai_engine.vector_pipeline._enabled",
            return_value=True,
        ), patch(
            "ai_engine.vector_pipeline._plan_scene",
            return_value=scientific_scene_plan(),
        ), patch(
            "ai_engine.image_enrichment.generate_raster_image",
            side_effect=TimeoutError("Seedream timeout"),
        ):
            result = vector_pipeline.try_build_vector_illustration(
                "block on an inclined plane with all forces"
            )
        self.assertIsNotNone(result)
        assert result is not None
        self.assertTrue(result["base_image_url"].startswith("data:image/png;base64,"))
        self.assertEqual(
            result["diagram_pipeline"]["fallback"],
            "seedream_unavailable",
        )

    def test_critic_timeout_returns_seedream_result(self) -> None:
        generated = solid_png_data_url(230)
        with patch(
            "ai_engine.vector_pipeline._pipeline_mode",
            return_value="planner_critic",
        ), patch(
            "ai_engine.vector_pipeline._enabled",
            return_value=True,
        ), patch(
            "ai_engine.vector_pipeline._plan_scene",
            return_value=scientific_scene_plan(),
        ), patch(
            "ai_engine.vector_pipeline._critic_enabled",
            return_value=True,
        ), patch(
            "ai_engine.vector_pipeline._critique_scene",
            return_value=None,
        ), patch(
            "ai_engine.image_enrichment.generate_raster_image",
            return_value=generated,
        ):
            result = vector_pipeline.try_build_vector_illustration(
                "block on an inclined plane with all forces"
            )
        self.assertIsNotNone(result)
        assert result is not None
        self.assertEqual(
            result["diagram_pipeline"]["fallback"],
            "critic_unavailable",
        )
        self.assertTrue(result["base_image_url"].startswith("data:image/png;base64,"))

    def test_legacy_mode_never_calls_qwen(self) -> None:
        with patch(
            "ai_engine.vector_pipeline._pipeline_mode",
            return_value="legacy",
        ), patch("ai_engine.vector_pipeline._plan_scene") as planner:
            result = vector_pipeline.try_build_vector_illustration(
                "block on an inclined plane with all forces"
            )
        self.assertIsNone(result)
        planner.assert_not_called()

    def test_same_plan_produces_identical_deterministic_svg(self) -> None:
        plan = scientific_scene_plan()
        layouts = [
            vector_pipeline.scene_plan_to_vector_layout(copy.deepcopy(plan))
            for _ in range(5)
        ]
        self.assertTrue(all(layout == layouts[0] for layout in layouts[1:]))
        outputs = [
            VectorRenderer(emit_text=False).render(layout)
            for layout in layouts
            if layout is not None
        ]
        self.assertEqual(len(outputs), 5)
        self.assertTrue(all(svg == outputs[0] for svg in outputs[1:]))

    def test_labels_and_arrow_overlay_do_not_depend_on_seedream_geometry(self) -> None:
        white = solid_png_data_url(255)
        gray = solid_png_data_url(209)
        with patch(
            "ai_engine.vector_pipeline._pipeline_mode",
            return_value="planner",
        ), patch(
            "ai_engine.vector_pipeline._enabled",
            return_value=True,
        ), patch(
            "ai_engine.vector_pipeline._plan_scene",
            return_value=scientific_scene_plan(),
        ), patch(
            "ai_engine.image_enrichment.generate_raster_image",
            side_effect=[white, gray],
        ):
            first = vector_pipeline.try_build_vector_illustration(
                "block on an inclined plane with all forces"
            )
            second = vector_pipeline.try_build_vector_illustration(
                "block on an inclined plane with all forces"
            )

        assert first is not None and second is not None
        self.assertEqual(first["labels"], second["labels"])
        self.assertEqual(first["overlay_svg_url"], second["overlay_svg_url"])
        self.assertEqual(first["vector_layout"], second["vector_layout"])
        self.assertNotEqual(first["base_image_url"], second["base_image_url"])

    def test_final_overlay_contains_exact_structure_contours(self) -> None:
        layout = vector_pipeline.scene_plan_to_vector_layout(
            scientific_scene_plan()
        )
        assert layout is not None
        _, _, overlay, _ = VectorRenderer(
            emit_text=False
        ).render_layers_with_labels(layout)
        root = _svg_root(overlay)
        roles = {
            element.attrib.get("data-role")
            for element in root.iter()
        }
        self.assertIn("body", roles)
        self.assertIn("incline", roles)
        self.assertIn("force-vector", roles)
        for element in root.iter():
            if element.attrib.get("data-role") in {"body", "incline"}:
                self.assertEqual(element.attrib.get("fill"), "none")

    def test_seedream_prompt_is_compact_and_derived_from_semantics(self) -> None:
        prompt = vector_pipeline.build_seedream_prompt(
            scientific_scene_plan(),
            deterministic_overlay=True,
            style="sketch",
            palette="natural-earth",
        )
        self.assertLess(len(prompt), 1200)
        self.assertIn("exactly one", prompt)
        self.assertIn("gravity vertically downward", prompt)
        self.assertIn("normal perpendicular outward", prompt)
        self.assertIn("Render no arrows", prompt)
        self.assertIn("Strict monochrome scientific ink sketch", prompt)
        self.assertNotIn("natural earth colors", prompt)
        self.assertNotIn("misspelled labels", prompt)

    def test_default_model_roles_are_qwen_and_seedream(self) -> None:
        self.assertEqual(
            vector_pipeline.DEFAULT_PLANNER_MODEL,
            "qwen/qwen3.7-plus",
        )
        self.assertEqual(
            vector_pipeline.DEFAULT_CRITIC_MODEL,
            "qwen/qwen3.7-plus",
        )
        self.assertEqual(
            vector_pipeline.DEFAULT_IMAGE_MODEL,
            "bytedance-seed/seedream-4.5",
        )
