"""
Smart Canvas Analyzer: GLM prompt, JSON parsing/repair and strict validation.

GLM is used only for semantic understanding and structured planning. Rendering
is deterministic in backend/frontend.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from .glm_client import glm_chat_image


REQUIRED_PHASES = ["Анализ условия", "Базовые законы", "Вывод", "Итог"]
ALLOWED_DISCIPLINES = {"physics", "mathematics", "chemistry", "biology", "engineering", "other"}
ALLOWED_BLOCK_TYPES = {
    "title",
    "text_block",
    "formula_block",
    "bullet_block",
    "diagram_ref",
    "warning_block",
    "final_answer_block",
}
ALLOWED_PLACEMENTS = {
    "top",
    "middle",
    "bottom",
    "left_column",
    "right_column",
    "below_diagram",
    "above_diagram",
    "full_width",
}
ALLOWED_SLIDE_LAYOUTS = {
    "left_text_right_diagram",
    "right_text_left_diagram",
    "vertical_steps",
    "diagram_then_explanation",
    "explanation_then_diagram",
    "two_column_comparison",
    "full_width_diagram_with_caption",
}
ALLOWED_DIAGRAM_TYPES = {
    "concept_diagram",
    "free_body_diagram",
    "math_graph",
    "geometry_diagram",
    "circuit_diagram",
    "optics_ray_diagram",
    "mechanics_diagram",
    "process_diagram",
    "comparison_diagram",
    "final_summary_diagram",
}
ALLOWED_VECTOR_COMPONENTS = {
    "axis",
    "curve",
    "body",
    "surface",
    "vector",
    "label",
    "math_label",
    "angle_arc",
    "dimension_line",
    "connector",
    "trajectory",
    "field_lines",
    "ray",
    "circuit_symbol",
    "point",
}
ALLOWED_FALLBACKS = {"svg", "png"}


class AnalyzerValidationError(ValueError):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


@dataclass(frozen=True)
class ParseResult:
    data: dict[str, Any]
    repaired: bool = False


SMART_CANVAS_ANALYZER_SYSTEM_PROMPT = """
You are the Smart Canvas Analyzer for an educational whiteboard.

Return STRICT JSON only.
No Markdown. No commentary. No code fences. No trailing explanation. No text
before or after JSON.

GLM responsibilities:
- understand the canvas screenshot semantically;
- recognize one or more scientific/mathematical topics;
- create a structured academic plan;
- create semantic vector_layout requests;
- create board-ready text blocks with deterministic order and placement.

GLM must NOT generate raw SVG, raw SVG path strings, Bezier control points,
arrays of X/Y points, arbitrary pixel coordinates, HTML, Markdown outside JSON,
or floating text without layout order.

The backend/frontend is responsible for deterministic rendering: board text
blocks, formulas, labels, arrows, diagrams, SVG/PNG fallback and final canvas
layout. Image models may be used only for visual styling and are never the
source of truth for labels, formulas or geometry.

Твое объяснение должно быть строго последовательным, академическим и пошаговым.
Нельзя сразу давать готовый ответ. Двигайся от анализа условия к базовым
законам, затем к математическому выводу и только потом к итогу. Не пропускай
логические шаги. Объясняй, почему выбран именно этот закон или метод. Если на
изображении несколько тем или несколько объектов, раздели их на отдельные
lessons и diagrams.

Required explanation phases for every lesson, exactly:
1. "Анализ условия"
2. "Базовые законы"
3. "Вывод"
4. "Итог"

Each phase must have exact phase name, numeric order, clear academic text and
diagram_refs array. Do not merge phases. Do not skip phases. Do not output a
final answer before the derivation phase.

Required JSON shape:
{
  "schema_version": "0.2",
  "language": "ru",
  "recognized_topics": [
    {
      "id": "topic_1",
      "title": "Название темы",
      "discipline": "physics | mathematics | chemistry | biology | engineering | other",
      "confidence": 0.0,
      "short_description": "Краткое описание того, что изображено на доске."
    }
  ],
  "lessons": [
    {
      "id": "lesson_1",
      "topic_id": "topic_1",
      "title": "Краткое название объяснения",
      "academic_explanation": [
        {"phase": "Анализ условия", "order": 1, "text": "...", "diagram_refs": ["diagram_1"]},
        {"phase": "Базовые законы", "order": 2, "text": "...", "diagram_refs": ["diagram_1"]},
        {"phase": "Вывод", "order": 3, "text": "...", "diagram_refs": ["diagram_2"]},
        {"phase": "Итог", "order": 4, "text": "...", "diagram_refs": ["diagram_3"]}
      ]
    }
  ],
  "diagrams": [
    {
      "id": "diagram_1",
      "topic_id": "topic_1",
      "title": "Схема сил",
      "purpose": "Показывает силы, действующие на тело.",
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
          {"id": "normal", "type": "vector", "kind": "force", "subtype": "normal", "target": "block1.center", "direction": {"perpendicular_to": "incline1", "side": "outward"}, "label": "N"},
          {"id": "friction", "type": "vector", "kind": "force", "subtype": "friction", "target": "block1.center", "direction": {"parallel_to": "incline1", "sense": "up_slope"}, "label": "f"},
          {"id": "theta", "type": "angle_arc", "between": ["incline1", "horizontal"], "label": "θ"}
        ]
      }
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
          {"id": "text_1", "type": "text_block", "role": "phase_summary", "lesson_id": "lesson_1", "phase": "Анализ условия", "order": 1, "placement": "left_column", "text": "...", "max_lines": 5},
          {"id": "diagram_block_1", "type": "diagram_ref", "diagram_id": "diagram_1", "order": 2, "placement": "right_column"}
        ]
      }
    ]
  },
  "render_requests": [
    {"id": "render_1", "type": "canvas_render", "storyboard_id": "storyboard_1", "diagram_ids": ["diagram_1"], "style": "scientific_flat_textbook", "text_rendering": "deterministic_overlay", "fallback": "svg"}
  ]
}

Canvas storyboard rules:
- Every slide and block must have an explicit numeric order.
- Text blocks must be short enough to fit on canvas; prefer several small blocks.
- Allowed block types: title, text_block, formula_block, bullet_block, diagram_ref,
  warning_block, final_answer_block.
- Allowed placements: top, middle, bottom, left_column, right_column,
  below_diagram, above_diagram, full_width.
- Allowed slide layouts: left_text_right_diagram, right_text_left_diagram,
  vertical_steps, diagram_then_explanation, explanation_then_diagram,
  two_column_comparison, full_width_diagram_with_caption.

Diagram rules:
- Default render_style for scientific diagrams: scientific_flat_textbook.
- Allowed diagram_type values: concept_diagram, free_body_diagram, math_graph,
  geometry_diagram, circuit_diagram, optics_ray_diagram, mechanics_diagram,
  process_diagram, comparison_diagram, final_summary_diagram.
- Use semantic vector components only: axis, curve, body, surface, vector, label,
  math_label, angle_arc, dimension_line, connector, trajectory, field_lines, ray,
  circuit_symbol, point.
- Use semantic relations such as target, on, direction, perpendicular_to,
  parallel_to, between, from, to.
- Avoid start/end numeric arrays, points arrays, SVG snippets, path data and
  arbitrary pixel coordinates.
""".strip()


USER_ANALYZER_PROMPT = (
    "Analyze this whiteboard/canvas screenshot and return the strict JSON object "
    "defined by the system prompt. Adapt topics, lessons, diagrams and storyboard "
    "to the actual screenshot. Use Russian academic explanation text."
)


def parse_json_with_repair(raw: str) -> ParseResult:
    """Parse strict JSON; repair only the wrapper/trailing-comma cases."""
    try:
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            raise AnalyzerValidationError(["GLM JSON root must be an object"])
        return ParseResult(parsed, repaired=False)
    except json.JSONDecodeError:
        pass

    repaired = raw.strip()
    repaired = re.sub(r"^```(?:json)?\s*", "", repaired, flags=re.I)
    repaired = re.sub(r"\s*```$", "", repaired)
    start = repaired.find("{")
    end = repaired.rfind("}")
    if start >= 0 and end > start:
        repaired = repaired[start:end + 1]
    repaired = re.sub(r",(\s*[}\]])", r"\1", repaired)

    try:
        parsed = json.loads(repaired)
    except json.JSONDecodeError as exc:
        raise AnalyzerValidationError([f"JSON parse failed after repair: {exc}"]) from exc
    if not isinstance(parsed, dict):
        raise AnalyzerValidationError(["GLM JSON root must be an object"])
    return ParseResult(parsed, repaired=True)


def validate_analyzer_response(data: dict[str, Any]) -> None:
    errors: list[str] = []
    _validate_top_level(data, errors)
    topic_ids = _validate_topics(data.get("recognized_topics"), errors)
    diagram_ids = _validate_diagrams(data.get("diagrams"), topic_ids, errors)
    lesson_ids = _validate_lessons(data.get("lessons"), topic_ids, diagram_ids, errors)
    _validate_storyboard(data.get("canvas_storyboard"), lesson_ids, diagram_ids, errors)
    _validate_render_requests(data.get("render_requests"), diagram_ids, errors)
    _validate_no_forbidden_raw_geometry(data, errors)
    if errors:
        raise AnalyzerValidationError(errors)


def analyze_canvas_with_glm(image_base64: str) -> tuple[dict[str, Any], bool, str]:
    """Call GLM, parse/repair and validate. Returns data, repaired, raw_text."""
    raw = glm_chat_image(
        image_base64=image_base64,
        system_prompt=SMART_CANVAS_ANALYZER_SYSTEM_PROMPT,
        user_prompt=USER_ANALYZER_PROMPT,
        max_tokens=6000,
    )
    parsed = parse_json_with_repair(raw)
    validate_analyzer_response(parsed.data)
    return parsed.data, parsed.repaired, raw


def _validate_top_level(data: dict[str, Any], errors: list[str]) -> None:
    for key in ("schema_version", "language", "recognized_topics", "lessons", "diagrams", "canvas_storyboard", "render_requests"):
        if key not in data:
            errors.append(f"Missing top-level key: {key}")
    if data.get("schema_version") != "0.2":
        errors.append("schema_version must be '0.2'")
    if not isinstance(data.get("recognized_topics"), list) or not data.get("recognized_topics"):
        errors.append("recognized_topics must be a non-empty array")
    if not isinstance(data.get("lessons"), list) or not data.get("lessons"):
        errors.append("lessons must be a non-empty array")
    if not isinstance(data.get("diagrams"), list):
        errors.append("diagrams must be an array")
    if not isinstance(data.get("canvas_storyboard"), dict):
        errors.append("canvas_storyboard must be an object")
    if not isinstance(data.get("render_requests"), list):
        errors.append("render_requests must be an array")


def _validate_topics(topics: Any, errors: list[str]) -> set[str]:
    ids: set[str] = set()
    if not isinstance(topics, list):
        return ids
    for idx, topic in enumerate(topics):
        if not isinstance(topic, dict):
            errors.append(f"recognized_topics[{idx}] must be an object")
            continue
        for key in ("id", "title", "discipline", "confidence"):
            if key not in topic:
                errors.append(f"topic missing {key}")
        if isinstance(topic.get("id"), str):
            ids.add(topic["id"])
        if topic.get("discipline") not in ALLOWED_DISCIPLINES:
            errors.append(f"Unknown discipline: {topic.get('discipline')}")
        confidence = topic.get("confidence")
        if not isinstance(confidence, (int, float)) or not 0 <= float(confidence) <= 1:
            errors.append("topic.confidence must be between 0 and 1")
    return ids


def _validate_lessons(lessons: Any, topic_ids: set[str], diagram_ids: set[str], errors: list[str]) -> set[str]:
    ids: set[str] = set()
    if not isinstance(lessons, list):
        return ids
    for idx, lesson in enumerate(lessons):
        if not isinstance(lesson, dict):
            errors.append(f"lessons[{idx}] must be an object")
            continue
        lesson_id = lesson.get("id")
        if isinstance(lesson_id, str):
            ids.add(lesson_id)
        else:
            errors.append("lesson.id is required")
        if lesson.get("topic_id") not in topic_ids:
            errors.append(f"lesson.topic_id references unknown topic: {lesson.get('topic_id')}")
        phases = lesson.get("academic_explanation")
        if not isinstance(phases, list) or len(phases) != 4:
            errors.append("academic_explanation must contain exactly 4 phases")
            continue
        for expected_order, expected_phase in enumerate(REQUIRED_PHASES, start=1):
            phase = phases[expected_order - 1]
            if not isinstance(phase, dict):
                errors.append(f"phase {expected_order} must be an object")
                continue
            if phase.get("phase") != expected_phase:
                errors.append(f"phase {expected_order} must be {expected_phase}")
            if phase.get("order") != expected_order:
                errors.append(f"phase {expected_phase} has wrong order")
            if not isinstance(phase.get("text"), str) or not phase["text"].strip():
                errors.append(f"phase {expected_phase} text is empty")
            refs = phase.get("diagram_refs")
            if not isinstance(refs, list):
                errors.append(f"phase {expected_phase}.diagram_refs must be an array")
            else:
                for ref in refs:
                    if ref not in diagram_ids:
                        errors.append(f"phase {expected_phase} references unknown diagram: {ref}")
    return ids


def _validate_diagrams(diagrams: Any, topic_ids: set[str], errors: list[str]) -> set[str]:
    ids: set[str] = set()
    if not isinstance(diagrams, list):
        return ids
    for idx, diagram in enumerate(diagrams):
        if not isinstance(diagram, dict):
            errors.append(f"diagrams[{idx}] must be an object")
            continue
        for key in ("id", "topic_id", "title", "purpose", "diagram_type", "render_style", "vector_layout"):
            if key not in diagram:
                errors.append(f"diagram missing {key}")
        if isinstance(diagram.get("id"), str):
            ids.add(diagram["id"])
        if diagram.get("topic_id") not in topic_ids:
            errors.append(f"diagram.topic_id references unknown topic: {diagram.get('topic_id')}")
        if diagram.get("diagram_type") not in ALLOWED_DIAGRAM_TYPES:
            errors.append(f"Unknown diagram_type: {diagram.get('diagram_type')}")
        layout = diagram.get("vector_layout")
        if not isinstance(layout, dict):
            errors.append("diagram.vector_layout must be an object")
            continue
        if layout.get("type") != "vector_layout":
            errors.append("vector_layout.type must equal 'vector_layout'")
        components = layout.get("components")
        if not isinstance(components, list):
            errors.append("vector_layout.components must be an array")
        else:
            for comp in components:
                if not isinstance(comp, dict):
                    errors.append("vector component must be an object")
                    continue
                if comp.get("type") not in ALLOWED_VECTOR_COMPONENTS:
                    errors.append(f"Unknown vector component type: {comp.get('type')}")
    return ids


def _validate_storyboard(storyboard: Any, lesson_ids: set[str], diagram_ids: set[str], errors: list[str]) -> None:
    if not isinstance(storyboard, dict):
        return
    slides = storyboard.get("slides")
    if not isinstance(slides, list) or not slides:
        errors.append("canvas_storyboard.slides must be a non-empty array")
        return
    slide_orders: list[int] = []
    for slide in slides:
        if not isinstance(slide, dict):
            errors.append("slide must be an object")
            continue
        for key in ("id", "order", "title", "layout", "blocks"):
            if key not in slide:
                errors.append(f"slide missing {key}")
        if isinstance(slide.get("order"), int):
            slide_orders.append(slide["order"])
        if slide.get("layout") not in ALLOWED_SLIDE_LAYOUTS:
            errors.append(f"Unknown slide layout: {slide.get('layout')}")
        blocks = slide.get("blocks")
        if not isinstance(blocks, list):
            errors.append("slide.blocks must be an array")
            continue
        block_orders: list[int] = []
        for block in blocks:
            if not isinstance(block, dict):
                errors.append("block must be an object")
                continue
            for key in ("id", "type", "order", "placement"):
                if key not in block:
                    errors.append(f"block missing {key}")
            if block.get("type") not in ALLOWED_BLOCK_TYPES:
                errors.append(f"Unknown block type: {block.get('type')}")
            if block.get("placement") not in ALLOWED_PLACEMENTS:
                errors.append(f"Unknown block placement: {block.get('placement')}")
            if isinstance(block.get("order"), int):
                block_orders.append(block["order"])
            if block.get("type") == "diagram_ref":
                if block.get("diagram_id") not in diagram_ids:
                    errors.append(f"diagram_ref references unknown diagram: {block.get('diagram_id')}")
            else:
                for key in ("role", "lesson_id", "phase", "text", "max_lines"):
                    if key not in block:
                        errors.append(f"text block missing {key}")
                if block.get("lesson_id") not in lesson_ids:
                    errors.append(f"text block references unknown lesson: {block.get('lesson_id')}")
                if block.get("phase") and block.get("phase") not in REQUIRED_PHASES:
                    errors.append(f"text block has unknown phase: {block.get('phase')}")
                if not isinstance(block.get("text"), str) or not block["text"].strip():
                    errors.append("text block text is empty")
                if not isinstance(block.get("max_lines"), int):
                    errors.append("text block max_lines must be numeric")
        if block_orders != sorted(block_orders):
            errors.append(f"slide {slide.get('id')} block order is not deterministic")
    if slide_orders != sorted(slide_orders):
        errors.append("slide order is not deterministic")


def _validate_render_requests(render_requests: Any, diagram_ids: set[str], errors: list[str]) -> None:
    if not isinstance(render_requests, list):
        return
    for req in render_requests:
        if not isinstance(req, dict):
            errors.append("render_request must be an object")
            continue
        if req.get("text_rendering") != "deterministic_overlay":
            errors.append("render_request.text_rendering must be deterministic_overlay")
        if req.get("fallback") not in ALLOWED_FALLBACKS:
            errors.append("render_request.fallback must be svg or png")
        ids = req.get("diagram_ids")
        if not isinstance(ids, list):
            errors.append("render_request.diagram_ids must be an array")
        else:
            for diagram_id in ids:
                if diagram_id not in diagram_ids:
                    errors.append(f"render_request references unknown diagram: {diagram_id}")


def _validate_no_forbidden_raw_geometry(data: Any, errors: list[str], path: str = "$") -> None:
    if isinstance(data, dict):
        for key, value in data.items():
            next_path = f"{path}.{key}"
            key_lower = str(key).lower()
            if key_lower in {"svg", "raw_svg", "path", "d"}:
                errors.append(f"Forbidden raw SVG/path key at {next_path}")
            if key_lower == "points":
                errors.append(f"Forbidden points array at {next_path}")
            if key_lower in {"start", "end"} and _is_numeric_array(value):
                errors.append(f"Forbidden numeric coordinate array at {next_path}")
            _validate_no_forbidden_raw_geometry(value, errors, next_path)
    elif isinstance(data, list):
        if data and all(isinstance(item, list) and _is_numeric_array(item) for item in data):
            errors.append(f"Forbidden point arrays at {path}")
        for idx, item in enumerate(data):
            _validate_no_forbidden_raw_geometry(item, errors, f"{path}[{idx}]")
    elif isinstance(data, str):
        low = data.lower()
        if "<svg" in low or "<path" in low:
            errors.append(f"Forbidden raw SVG string at {path}")
        if re.search(r"\bM\s*-?\d+(?:\.\d+)?[, ]+-?\d+", data):
            errors.append(f"Forbidden SVG path data at {path}")


def _is_numeric_array(value: Any) -> bool:
    return isinstance(value, list) and len(value) >= 2 and all(isinstance(v, (int, float)) for v in value)
