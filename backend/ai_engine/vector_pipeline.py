"""
Детерминированный путь научных схем: LLM → vector_layout → SVG/PNG + подписи.

Зачем он существует
───────────────────
Растровый путь (`image_enrichment` → Seedream) не умеет в научную геометрию.
Проверено вживую на эталонном сюжете «брусок на наклонной плоскости, покажи
все силы»:

  • прежняя модель впечатывала в пиксели псевдо-текст («Fikicn», «Filek»,
    «Porgls») вопреки полному TEXT_FREE-контракту и короткому терминальному
    запрету — и этот текст сталкивался с нашим DOM-слоем подписей;
  • Seedream 4.5 текст победил (кадр реально чистый), но геометрию — нет:
    двусторонняя вертикальная стрелка, тяжесть вверх, пунктирные построения,
    купол во весь кадр вместо маленькой дуги 30°.

Вывод: генеративная модель может отвечать за оформление, но не за смысл.
`VectorRenderer` рисует ту же схему детерминированно и всегда одинаково.

Что этот модуль добавляет сверх рендерера
─────────────────────────────────────────
Рендерер — чистая функция от layout. Здесь живёт всё «грязное»: поход в LLM за
семантикой, решение «берёмся ли мы вообще за этот сюжет», фича-флаг и падение
обратно в растр. Ни одна ошибка отсюда не должна доходить до пользователя:
любой сбой — это `None` и обычный растровый путь.

Главный побочный выигрыш — координаты. Рендерер знает, где именно середина
древка каждой силы, поэтому `arrow_to` считается арифметикой, а не vision-
грунтингом (тот стоит отдельного запроса к VLM с таймаутом 60с и всё равно
угадывает).
"""

from __future__ import annotations

import base64
import copy
import json
import logging
import math
import os
import re
import xml.etree.ElementTree as ET
from typing import Any

from django.conf import settings

from .vector_renderer import (
    VectorRenderError,
    VectorRenderer,
    ensure_semantic_vector_layout,
    svg_to_png_data_url,
)

logger = logging.getLogger(__name__)

DIAGRAM_PIPELINE_MODES = {
    "legacy",
    "planner",
    "planner_critic",
    "deterministic",
}
DEFAULT_PLANNER_MODEL = "qwen/qwen3.7-plus"
DEFAULT_CRITIC_MODEL = "qwen/qwen3.7-plus"
DEFAULT_IMAGE_MODEL = "bytedance-seed/seedream-4.5"


def _flag(name: str, default: str) -> bool:
    """Тот же контракт, что и `illustration_pipeline._flag`."""
    raw = str(getattr(settings, name, os.getenv(name, default))).strip().lower()
    return raw in ("1", "true", "yes", "on")


def _pipeline_mode() -> str:
    """Resolve the A/B mode without enabling new network calls by default."""
    explicit = os.getenv("DIAGRAM_PIPELINE_MODE")
    raw = explicit
    if raw is None:
        raw = str(getattr(settings, "DIAGRAM_PIPELINE_MODE", "legacy"))
        # Backward compatibility for the previously shipped boolean flag.
        if raw.strip().lower() == "legacy" and _flag(
            "ILLUSTRATION_VECTOR_PIPELINE", "false"
        ):
            raw = "deterministic"
    mode = str(raw).strip().lower()
    if mode not in DIAGRAM_PIPELINE_MODES:
        logger.warning("[DiagramPipeline] unknown mode %r; using legacy", mode)
        return "legacy"
    return mode


def _enabled() -> bool:
    return _pipeline_mode() != "legacy"


def _planner_enabled() -> bool:
    return _flag("DIAGRAM_PLANNER_ENABLED", "true")


def _critic_enabled() -> bool:
    return _flag("DIAGRAM_CRITIC_ENABLED", "true")


def _planner_model() -> str:
    return str(
        getattr(
            settings,
            "DIAGRAM_PLANNER_MODEL",
            os.getenv("DIAGRAM_PLANNER_MODEL", DEFAULT_PLANNER_MODEL),
        )
    )


def _critic_model() -> str:
    return str(
        getattr(
            settings,
            "DIAGRAM_CRITIC_MODEL",
            os.getenv("DIAGRAM_CRITIC_MODEL", DEFAULT_CRITIC_MODEL),
        )
    )


def _image_model() -> str:
    return str(
        getattr(
            settings,
            "IMAGE_GEN_MODEL",
            os.getenv("IMAGE_GEN_MODEL", DEFAULT_IMAGE_MODEL),
        )
    )


def _openrouter_api_key() -> str:
    return str(
        getattr(settings, "DIAGRAM_API_KEY", "")
        or os.getenv("DIAGRAM_API_KEY", "")
        or getattr(settings, "IMAGE_GEN_API_KEY", "")
        or os.getenv("TEXT_LLM_API_KEY", "")
        or os.getenv("OPENROUTER_API_KEY", "")
    )


def _openrouter_base_url() -> str:
    configured = str(
        getattr(settings, "DIAGRAM_OPENROUTER_BASE_URL", "")
        or os.getenv("DIAGRAM_OPENROUTER_BASE_URL", "")
        or os.getenv("TEXT_LLM_BASE_URL", "")
    ).rstrip("/")
    if configured:
        return configured
    image_endpoint = str(
        getattr(
            settings,
            "IMAGE_GEN_API_URL",
            "https://openrouter.ai/api/v1/chat/completions",
        )
    )
    suffix = "/chat/completions"
    return (
        image_endpoint[: -len(suffix)]
        if image_endpoint.endswith(suffix)
        else "https://openrouter.ai/api/v1"
    )


def _max_retries() -> int:
    raw = getattr(
        settings,
        "DIAGRAM_MAX_RETRIES",
        os.getenv("DIAGRAM_MAX_RETRIES", "1"),
    )
    try:
        return max(0, min(2, int(raw)))
    except (TypeError, ValueError):
        return 1


# Стиль в ответе: подписи фронтенд типографирует сам, растр — плоская схема.
VECTOR_GEN_STYLE = "scientific_flat_textbook"


# ──────────────────────────────────────────────────────────────────
# Гейтинг: за какие сюжеты этот путь берётся
# ──────────────────────────────────────────────────────────────────
# Осознанно узко. DSL умеет 11 типов компонентов, а `angle_arc` поддерживает
# только пару [surface, "horizontal"] — то есть уверенно закрывает механику с
# наклонной плоскостью и не закрывает круговорот воды или строение клетки.
# Всё, во что мы не уверены, честно уходит в растр.


def _looks_like_supported_mechanics(prompt: str) -> bool:
    # Импорт локальный: регексы живут в image_enrichment (исторический владелец
    # эвристик стиля), а тащить его на верхний уровень незачем — модуль тяжёлый.
    from .image_enrichment import INCLINED_PLANE_CONTEXT_RE

    return bool(INCLINED_PLANE_CONTEXT_RE.search(prompt or ""))


# ──────────────────────────────────────────────────────────────────
# Scientific scene plan V0.1
# ──────────────────────────────────────────────────────────────────


class ScenePlanValidationError(ValueError):
    """A planner or critic response violated the semantic contract."""

    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__("; ".join(errors))


_SCENE_TOP_FIELDS = {
    "type",
    "schema_version",
    "scene_kind",
    "canvas",
    "objects",
    "relations",
    "vectors",
    "labels",
    "constraints",
    "render_prompt",
}
_SCENE_KINDS = {
    "free_body_diagram",
    "mechanics_diagram",
    "math_graph",
    "spring_system",
    "process_diagram",
    "scientific_diagram",
}
_OBJECT_TYPES = {
    "body",
    "surface",
    "support",
    "connector",
    "axis",
    "curve",
    "angle_arc",
    "trajectory",
    "scientific_object",
    "process_node",
}
_OBJECT_FIELDS = {
    "id",
    "type",
    "role",
    "shape",
    "count",
    "size",
    "angle_deg",
    "between",
}
_RELATION_TYPES = {
    "contact",
    "on",
    "attached_to",
    "contains",
    "inside",
    "connected_to",
    "parallel_to",
    "perpendicular_to",
    "between",
    "flows_to",
}
_RELATION_FIELDS = {"id", "type", "subject", "object", "sense", "side"}
_VECTOR_KINDS = {
    "force",
    "velocity",
    "acceleration",
    "electric_field",
    "magnetic_field",
}
_VECTOR_FIELDS = {"id", "kind", "subtype", "target", "direction", "length"}
_DIRECTION_FIELDS = {"type", "reference", "sense", "side"}
_DIRECTION_TYPES = {
    "up",
    "down",
    "left",
    "right",
    "parallel_to",
    "perpendicular_to",
}
_LABEL_FIELDS = {"id", "text", "attach_to", "placement"}
_PLACEMENTS = {"above", "below", "left", "right", "center", "auto"}
_CONSTRAINT_FIELDS = {"id", "type", "target", "value"}
_CONSTRAINT_TYPES = {
    "exact_count",
    "max_count",
    "single_headed",
    "no_extra",
    "text_free_raster",
    "labels_match_components",
}
_LENGTHS = {"short", "medium", "long"}
_SIZES = {"small", "medium", "large"}
_COMPACT_STYLE_PROMPTS = {
    "flat": (
        "Modern premium flat vector scientific illustration with restrained "
        "colors, crisp thin outlines and subtle flat shading."
    ),
    "scientific_flat_textbook": (
        "Professional flat scientific textbook illustration with restrained "
        "colors, crisp technical outlines and subtle flat shading."
    ),
    "2_5d": (
        "Professional isometric 2.5D educational illustration with restrained "
        "materials, soft shading and precise scientific contours."
    ),
    "3d": (
        "Professional educational 3D render with simple matte materials, soft "
        "studio lighting and clearly readable scientific forms."
    ),
    "sketch": (
        "Strict monochrome scientific ink sketch on white paper with confident "
        "clean strokes and restrained cross-hatching."
    ),
}
_COMPACT_PALETTE_PROMPTS = {
    "natural-earth": "Use restrained natural earth colors.",
    "oceanic-clean": "Use deep blue, sky blue, white and cool grey.",
    "monochrome-ink": "Use only black, dark slate, light grey and white.",
    "he_inspired": "Use deep red, warm beige, grey and soft pink.",
    "warm_biotech": "Use cyan, deep blue, light grey and dark slate.",
    "in_vitro_violet": "Use deep violet, muted beige, mauve and dark green.",
}
_ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")
_SHAPE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")
_UNSAFE_SCENE_TEXT_RE = re.compile(
    r"(?:<|>|https?:|data:|javascript:|foreignobject|<\s*svg|<\s*path|"
    r"<\s*script|\bM\s*-?\d+(?:\.\d+)?[, ]+-?\d+)",
    re.IGNORECASE,
)
_FORBIDDEN_SCENE_KEYS = {
    "svg",
    "raw_svg",
    "path",
    "path_data",
    "d",
    "points",
    "vertices",
    "polyline",
    "bezier",
    "control_points",
    "html",
    "foreignObject",
    "script",
    "href",
    "xlink:href",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
    "width",
    "height",
    "pixel",
    "pixels",
}
_ANCHORS_BY_TYPE = {
    "body": {"center", "top", "bottom", "left", "right", "contact"},
    "surface": {"center", "left", "right", "vertex"},
    "support": {"center", "top", "bottom", "left", "right"},
    "connector": {"center", "start", "end", "left", "right"},
    "axis": {"center", "origin"},
    "curve": {"center"},
    "angle_arc": {"vertex", "mid"},
    "trajectory": {"start", "mid", "end"},
    "scientific_object": {"center", "top", "bottom", "left", "right"},
    "process_node": {"center"},
}
_VECTOR_ANCHORS = {"start", "mid", "end"}


SCENE_PLAN_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": sorted(_SCENE_TOP_FIELDS),
    "properties": {
        "type": {"const": "scientific_scene_plan"},
        "schema_version": {"const": "0.1"},
        "scene_kind": {"type": "string", "enum": sorted(_SCENE_KINDS)},
        "canvas": {
            "type": "object",
            "additionalProperties": False,
            "required": ["aspect_ratio", "background"],
            "properties": {
                "aspect_ratio": {"const": "16:9"},
                "background": {"const": "white"},
            },
        },
        "objects": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "type", "role", "shape", "count"],
                "properties": {
                    "id": {"type": "string"},
                    "type": {"type": "string", "enum": sorted(_OBJECT_TYPES)},
                    "role": {"type": "string"},
                    "shape": {"type": "string"},
                    "count": {"type": "integer", "minimum": 1, "maximum": 20},
                    "size": {
                        "type": ["string", "null"],
                        "enum": [None, *sorted(_SIZES)],
                    },
                    "angle_deg": {
                        "type": ["number", "null"],
                        "minimum": 0,
                        "maximum": 180,
                    },
                    "between": {
                        "type": ["array", "null"],
                        "minItems": 2,
                        "maxItems": 2,
                        "items": {"type": "string"},
                    },
                },
            },
        },
        "relations": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "type", "subject", "object"],
                "properties": {
                    "id": {"type": "string"},
                    "type": {"type": "string", "enum": sorted(_RELATION_TYPES)},
                    "subject": {"type": "string"},
                    "object": {"type": "string"},
                    "sense": {"type": ["string", "null"]},
                    "side": {"type": ["string", "null"]},
                },
            },
        },
        "vectors": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "id",
                    "kind",
                    "subtype",
                    "target",
                    "direction",
                    "length",
                ],
                "properties": {
                    "id": {"type": "string"},
                    "kind": {"type": "string", "enum": sorted(_VECTOR_KINDS)},
                    "subtype": {"type": "string"},
                    "target": {"type": "string"},
                    "direction": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["type"],
                        "properties": {
                            "type": {
                                "type": "string",
                                "enum": sorted(_DIRECTION_TYPES),
                            },
                            "reference": {"type": ["string", "null"]},
                            "sense": {"type": ["string", "null"]},
                            "side": {"type": ["string", "null"]},
                        },
                    },
                    "length": {"type": "string", "enum": sorted(_LENGTHS)},
                },
            },
        },
        "labels": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "text", "attach_to", "placement"],
                "properties": {
                    "id": {"type": "string"},
                    "text": {"type": "string"},
                    "attach_to": {"type": "string"},
                    "placement": {"type": "string", "enum": sorted(_PLACEMENTS)},
                },
            },
        },
        "constraints": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "type", "target", "value"],
                "properties": {
                    "id": {"type": "string"},
                    "type": {
                        "type": "string",
                        "enum": sorted(_CONSTRAINT_TYPES),
                    },
                    "target": {"type": "string"},
                    "value": {"type": "integer", "minimum": 0, "maximum": 50},
                },
            },
        },
        "render_prompt": {"type": "string", "maxLength": 500},
    },
}


CRITIC_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["valid", "score", "violations", "repair_action", "repair_prompt"],
    "properties": {
        "valid": {"type": "boolean"},
        "score": {"type": "number", "minimum": 0, "maximum": 1},
        "violations": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["type", "component", "description", "severity"],
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": [
                            "wrong_count",
                            "wrong_relation",
                            "wrong_direction",
                            "missing_contact",
                            "missing_object",
                            "duplicate_support",
                            "angle_misplaced",
                            "clutter",
                            "accidental_text",
                            "unsafe_label_space",
                        ],
                    },
                    "component": {"type": "string"},
                    "description": {"type": "string"},
                    "severity": {
                        "type": "string",
                        "enum": ["low", "medium", "high"],
                    },
                },
            },
        },
        "repair_action": {
            "type": "string",
            "enum": ["none", "regenerate", "use_deterministic"],
        },
        "repair_prompt": {"type": "string", "maxLength": 500},
    },
}


def _strict_fields(
    value: Any,
    *,
    allowed: set[str],
    required: set[str],
    path: str,
    errors: list[str],
) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        errors.append(f"{path} must be an object")
        return None
    unknown = sorted(set(value) - allowed)
    missing = sorted(required - set(value))
    if unknown:
        errors.append(f"{path} has unknown fields: {', '.join(unknown)}")
    if missing:
        errors.append(f"{path} is missing fields: {', '.join(missing)}")
    return value


def _valid_id(value: Any, path: str, errors: list[str]) -> str | None:
    if not isinstance(value, str) or not _ID_RE.fullmatch(value):
        errors.append(f"{path} must be a safe semantic id")
        return None
    return value


def _safe_text(
    value: Any,
    path: str,
    errors: list[str],
    *,
    max_length: int,
    allow_empty: bool = False,
) -> str | None:
    if not isinstance(value, str):
        errors.append(f"{path} must be a string")
        return None
    stripped = value.strip()
    if not stripped and not allow_empty:
        errors.append(f"{path} must not be empty")
        return None
    if len(stripped) > max_length:
        errors.append(f"{path} is too long")
    if _UNSAFE_SCENE_TEXT_RE.search(stripped):
        errors.append(f"{path} contains unsafe SVG/HTML/external data")
    return stripped


def _reject_raw_geometry(value: Any, path: str, errors: list[str]) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            key_text = str(key)
            if key_text in _FORBIDDEN_SCENE_KEYS:
                errors.append(f"Forbidden raw geometry field at {path}.{key_text}")
            _reject_raw_geometry(child, f"{path}.{key_text}", errors)
    elif isinstance(value, list):
        if value and all(
            isinstance(item, list)
            and len(item) >= 2
            and all(isinstance(number, (int, float)) for number in item)
            for item in value
        ):
            errors.append(f"Forbidden point array at {path}")
        for index, child in enumerate(value):
            _reject_raw_geometry(child, f"{path}[{index}]", errors)
    elif isinstance(value, str) and _UNSAFE_SCENE_TEXT_RE.search(value):
        errors.append(f"Unsafe SVG/HTML/external data at {path}")


def _ref_parts(reference: str) -> tuple[str, str | None]:
    root, separator, anchor = reference.partition(".")
    return root, anchor if separator else None


def _validate_scene_reference(
    reference: Any,
    *,
    objects_by_id: dict[str, dict[str, Any]],
    vectors_by_id: dict[str, dict[str, Any]],
    path: str,
    errors: list[str],
    allow_horizontal: bool = False,
) -> None:
    if not isinstance(reference, str):
        errors.append(f"{path} must be an id or semantic anchor")
        return
    if allow_horizontal and reference == "horizontal":
        return
    root, anchor = _ref_parts(reference)
    if root in objects_by_id:
        if anchor is None:
            return
        allowed = _ANCHORS_BY_TYPE.get(objects_by_id[root]["type"], {"center"})
        if anchor not in allowed:
            errors.append(f"{path} references unknown anchor: {reference}")
        return
    if root in vectors_by_id:
        if anchor is None or anchor in _VECTOR_ANCHORS:
            return
        errors.append(f"{path} references unknown vector anchor: {reference}")
        return
    errors.append(f"{path} references missing component: {reference}")


def _validate_relation_compatibility(
    relation: dict[str, Any],
    *,
    objects_by_id: dict[str, dict[str, Any]],
    vectors_by_id: dict[str, dict[str, Any]],
    path: str,
    errors: list[str],
) -> None:
    relation_type = relation.get("type")
    subject_root, subject_anchor = _ref_parts(str(relation.get("subject", "")))
    object_root, _ = _ref_parts(str(relation.get("object", "")))
    subject_object = objects_by_id.get(subject_root)
    object_object = objects_by_id.get(object_root)

    if relation_type in {"contact", "on"}:
        if not subject_object or subject_object.get("type") != "body":
            errors.append(f"{path} {relation_type} subject must be a body")
        if not object_object or object_object.get("type") != "surface":
            errors.append(f"{path} {relation_type} object must be a surface")
        if relation_type == "contact" and subject_anchor != "contact":
            errors.append(f"{path} contact subject must use the body.contact anchor")
    elif relation_type in {"parallel_to", "perpendicular_to"}:
        if subject_root not in vectors_by_id:
            errors.append(f"{path} {relation_type} subject must be a vector")
        if not object_object or object_object.get("type") != "surface":
            errors.append(f"{path} {relation_type} object must be a surface")

        direction = vectors_by_id.get(subject_root, {}).get("direction") or {}
        if direction.get("type") != relation_type:
            errors.append(
                f"{path} conflicts with {subject_root}.direction.type"
            )
        reference_root, _ = _ref_parts(str(direction.get("reference", "")))
        if reference_root != object_root:
            errors.append(
                f"{path} conflicts with {subject_root}.direction.reference"
            )
        if relation_type == "parallel_to":
            if relation.get("sense") != direction.get("sense"):
                errors.append(f"{path} sense conflicts with vector direction")
            if relation.get("side") is not None:
                errors.append(f"{path}.side is forbidden for parallel_to")
        else:
            if relation.get("side") != direction.get("side"):
                errors.append(f"{path} side conflicts with vector direction")
            if relation.get("sense") is not None:
                errors.append(f"{path}.sense is forbidden for perpendicular_to")
    elif relation.get("sense") is not None or relation.get("side") is not None:
        errors.append(f"{path} sense/side is not valid for {relation_type}")


def _semantic_target_count(
    target: str,
    *,
    objects: list[dict[str, Any]],
    vectors: list[dict[str, Any]],
    labels: list[dict[str, Any]],
) -> int | None:
    normalized = target.strip().lower()
    aliases = {
        "bodies": "body",
        "surfaces": "surface",
        "supports": "support",
        "forces": "force",
        "vectors": "vector",
        "labels": "label",
    }
    normalized = aliases.get(normalized, normalized)
    if normalized == "label":
        return len(labels)
    if normalized == "vector":
        return len(vectors)
    object_matches = [
        item
        for item in objects
        if item.get("type") == normalized or item.get("role") == normalized
    ]
    if object_matches or normalized in _OBJECT_TYPES:
        return sum(int(item.get("count", 0)) for item in object_matches)
    vector_matches = [
        item
        for item in vectors
        if item.get("kind") == normalized or item.get("subtype") == normalized
    ]
    if vector_matches or normalized in _VECTOR_KINDS:
        return len(vector_matches)
    return None


def validate_scientific_scene_plan(plan: dict[str, Any]) -> None:
    """Strictly validate planner JSON before any geometry or provider call."""
    errors: list[str] = []
    root = _strict_fields(
        plan,
        allowed=_SCENE_TOP_FIELDS,
        required=_SCENE_TOP_FIELDS,
        path="$",
        errors=errors,
    )
    if root is None:
        raise ScenePlanValidationError(errors)
    _reject_raw_geometry(plan, "$", errors)

    if plan.get("type") != "scientific_scene_plan":
        errors.append("$.type must be 'scientific_scene_plan'")
    if plan.get("schema_version") != "0.1":
        errors.append("$.schema_version must be '0.1'")
    if plan.get("scene_kind") not in _SCENE_KINDS:
        errors.append(f"Unknown scene_kind: {plan.get('scene_kind')}")

    canvas = _strict_fields(
        plan.get("canvas"),
        allowed={"aspect_ratio", "background"},
        required={"aspect_ratio", "background"},
        path="$.canvas",
        errors=errors,
    )
    if canvas:
        if canvas.get("aspect_ratio") != "16:9":
            errors.append("$.canvas.aspect_ratio must be '16:9'")
        if canvas.get("background") != "white":
            errors.append("$.canvas.background must be 'white'")

    arrays: dict[str, list[Any]] = {}
    for key in ("objects", "relations", "vectors", "labels", "constraints"):
        value = plan.get(key)
        if not isinstance(value, list):
            errors.append(f"$.{key} must be an array")
            arrays[key] = []
        else:
            arrays[key] = value

    seen_ids: set[str] = set()
    objects_by_id: dict[str, dict[str, Any]] = {}
    for index, raw_object in enumerate(arrays["objects"]):
        path = f"$.objects[{index}]"
        item = _strict_fields(
            raw_object,
            allowed=_OBJECT_FIELDS,
            required={"id", "type", "role", "shape", "count"},
            path=path,
            errors=errors,
        )
        if item is None:
            continue
        object_id = _valid_id(item.get("id"), f"{path}.id", errors)
        if object_id:
            if object_id in seen_ids:
                errors.append(f"Duplicate semantic id: {object_id}")
            seen_ids.add(object_id)
            objects_by_id[object_id] = item
        object_type = item.get("type")
        if object_type not in _OBJECT_TYPES:
            errors.append(f"{path}.type is unknown: {object_type}")
        _safe_text(item.get("role"), f"{path}.role", errors, max_length=120)
        shape = item.get("shape")
        if not isinstance(shape, str) or not _SHAPE_RE.fullmatch(shape):
            errors.append(f"{path}.shape must be a safe semantic token")
        count = item.get("count")
        if not isinstance(count, int) or isinstance(count, bool) or not 1 <= count <= 20:
            errors.append(f"{path}.count must be an integer from 1 to 20")
        size = item.get("size")
        if size is not None and size not in _SIZES:
            errors.append(f"{path}.size is unknown: {size}")
        angle = item.get("angle_deg")
        if angle is not None and (
            not isinstance(angle, (int, float))
            or isinstance(angle, bool)
            or not 0 <= float(angle) <= 180
        ):
            errors.append(f"{path}.angle_deg must be between 0 and 180")
        between = item.get("between")
        if object_type == "angle_arc":
            if not isinstance(between, list) or len(between) != 2:
                errors.append(f"{path}.between must have two semantic references")
        elif between is not None:
            errors.append(f"{path}.between is allowed only for angle_arc")

    vectors_by_id: dict[str, dict[str, Any]] = {}
    for index, raw_vector in enumerate(arrays["vectors"]):
        path = f"$.vectors[{index}]"
        item = _strict_fields(
            raw_vector,
            allowed=_VECTOR_FIELDS,
            required=_VECTOR_FIELDS,
            path=path,
            errors=errors,
        )
        if item is None:
            continue
        vector_id = _valid_id(item.get("id"), f"{path}.id", errors)
        if vector_id:
            if vector_id in seen_ids:
                errors.append(f"Duplicate semantic id: {vector_id}")
            seen_ids.add(vector_id)
            vectors_by_id[vector_id] = item
        if item.get("kind") not in _VECTOR_KINDS:
            errors.append(f"{path}.kind is unknown: {item.get('kind')}")
        _safe_text(item.get("subtype"), f"{path}.subtype", errors, max_length=60)
        if item.get("length") not in _LENGTHS:
            errors.append(f"{path}.length is unknown: {item.get('length')}")
        direction = _strict_fields(
            item.get("direction"),
            allowed=_DIRECTION_FIELDS,
            required={"type"},
            path=f"{path}.direction",
            errors=errors,
        )
        if direction:
            direction_type = direction.get("type")
            if direction_type not in _DIRECTION_TYPES:
                errors.append(f"{path}.direction.type is unknown: {direction_type}")
            reference = direction.get("reference")
            sense = direction.get("sense")
            side = direction.get("side")
            if direction_type == "parallel_to":
                if not isinstance(reference, str):
                    errors.append(
                        f"{path}.direction.reference is required for parallel_to"
                    )
                if sense not in {"up_slope", "down_slope"}:
                    errors.append(
                        f"{path}.direction.sense is required for parallel_to"
                    )
                if side is not None:
                    errors.append(
                        f"{path}.direction.side is forbidden for parallel_to"
                    )
            elif direction_type == "perpendicular_to":
                if not isinstance(reference, str):
                    errors.append(
                        f"{path}.direction.reference is required for perpendicular_to"
                    )
                if side not in {"outward", "inward"}:
                    errors.append(
                        f"{path}.direction.side is required for perpendicular_to"
                    )
                if sense is not None:
                    errors.append(
                        f"{path}.direction.sense is forbidden for perpendicular_to"
                    )
            elif reference is not None:
                errors.append(
                    f"{path}.direction.reference is forbidden for {direction_type}"
                )
            elif sense is not None or side is not None:
                errors.append(
                    f"{path}.direction sense/side is forbidden for {direction_type}"
                )
            if sense not in {None, "up_slope", "down_slope"}:
                errors.append(f"{path}.direction.sense is invalid")
            if side not in {None, "outward", "inward"}:
                errors.append(f"{path}.direction.side is invalid")

    for index, raw_relation in enumerate(arrays["relations"]):
        path = f"$.relations[{index}]"
        item = _strict_fields(
            raw_relation,
            allowed=_RELATION_FIELDS,
            required={"id", "type", "subject", "object"},
            path=path,
            errors=errors,
        )
        if item is None:
            continue
        relation_id = _valid_id(item.get("id"), f"{path}.id", errors)
        if relation_id:
            if relation_id in seen_ids:
                errors.append(f"Duplicate semantic id: {relation_id}")
            seen_ids.add(relation_id)
        relation_type = item.get("type")
        if relation_type not in _RELATION_TYPES:
            errors.append(f"{path}.type is unknown: {relation_type}")
        _validate_scene_reference(
            item.get("subject"),
            objects_by_id=objects_by_id,
            vectors_by_id=vectors_by_id,
            path=f"{path}.subject",
            errors=errors,
        )
        _validate_scene_reference(
            item.get("object"),
            objects_by_id=objects_by_id,
            vectors_by_id=vectors_by_id,
            path=f"{path}.object",
            errors=errors,
            allow_horizontal=relation_type == "between",
        )
        if item.get("sense") not in {None, "up_slope", "down_slope"}:
            errors.append(f"{path}.sense is invalid")
        if item.get("side") not in {None, "outward", "inward"}:
            errors.append(f"{path}.side is invalid")
        _validate_relation_compatibility(
            item,
            objects_by_id=objects_by_id,
            vectors_by_id=vectors_by_id,
            path=path,
            errors=errors,
        )

    for vector_id, vector in vectors_by_id.items():
        target_root, _ = _ref_parts(str(vector.get("target", "")))
        if target_root not in objects_by_id:
            errors.append(
                f"$.vectors[{vector_id}].target must reference a physical object"
            )
        _validate_scene_reference(
            vector.get("target"),
            objects_by_id=objects_by_id,
            vectors_by_id=vectors_by_id,
            path=f"$.vectors[{vector_id}].target",
            errors=errors,
        )
        direction = vector.get("direction") or {}
        reference = direction.get("reference")
        if reference is not None:
            reference_root, _ = _ref_parts(str(reference))
            if objects_by_id.get(reference_root, {}).get("type") != "surface":
                errors.append(
                    f"$.vectors[{vector_id}].direction.reference must be a surface"
                )
            _validate_scene_reference(
                reference,
                objects_by_id=objects_by_id,
                vectors_by_id=vectors_by_id,
                path=f"$.vectors[{vector_id}].direction.reference",
                errors=errors,
            )

    for object_id, item in objects_by_id.items():
        if item.get("type") != "angle_arc":
            continue
        between = item.get("between")
        if not isinstance(between, list) or len(between) != 2:
            continue
        for index, reference in enumerate(between):
            _validate_scene_reference(
                reference,
                objects_by_id=objects_by_id,
                vectors_by_id=vectors_by_id,
                path=f"$.objects[{object_id}].between[{index}]",
                errors=errors,
                allow_horizontal=index == 1,
            )

    label_roots: list[str] = []
    for index, raw_label in enumerate(arrays["labels"]):
        path = f"$.labels[{index}]"
        item = _strict_fields(
            raw_label,
            allowed=_LABEL_FIELDS,
            required=_LABEL_FIELDS,
            path=path,
            errors=errors,
        )
        if item is None:
            continue
        label_id = _valid_id(item.get("id"), f"{path}.id", errors)
        if label_id:
            if label_id in seen_ids:
                errors.append(f"Duplicate semantic id: {label_id}")
            seen_ids.add(label_id)
        _safe_text(item.get("text"), f"{path}.text", errors, max_length=160)
        if item.get("placement") not in _PLACEMENTS:
            errors.append(f"{path}.placement is invalid")
        attach_to = item.get("attach_to")
        _validate_scene_reference(
            attach_to,
            objects_by_id=objects_by_id,
            vectors_by_id=vectors_by_id,
            path=f"{path}.attach_to",
            errors=errors,
        )
        if isinstance(attach_to, str):
            label_roots.append(_ref_parts(attach_to)[0])

    for index, raw_constraint in enumerate(arrays["constraints"]):
        path = f"$.constraints[{index}]"
        item = _strict_fields(
            raw_constraint,
            allowed=_CONSTRAINT_FIELDS,
            required=_CONSTRAINT_FIELDS,
            path=path,
            errors=errors,
        )
        if item is None:
            continue
        constraint_id = _valid_id(item.get("id"), f"{path}.id", errors)
        if constraint_id:
            if constraint_id in seen_ids:
                errors.append(f"Duplicate semantic id: {constraint_id}")
            seen_ids.add(constraint_id)
        if item.get("type") not in _CONSTRAINT_TYPES:
            errors.append(f"{path}.type is unknown")
        _safe_text(item.get("target"), f"{path}.target", errors, max_length=80)
        value = item.get("value")
        if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 50:
            errors.append(f"{path}.value must be an integer from 0 to 50")
            continue
        target = item.get("target")
        constraint_type = item.get("type")
        if not isinstance(target, str):
            continue
        if constraint_type in {"exact_count", "max_count"}:
            actual = _semantic_target_count(
                target,
                objects=[
                    entry
                    for entry in arrays["objects"]
                    if isinstance(entry, dict)
                ],
                vectors=[
                    entry
                    for entry in arrays["vectors"]
                    if isinstance(entry, dict)
                ],
                labels=[
                    entry
                    for entry in arrays["labels"]
                    if isinstance(entry, dict)
                ],
            )
            if actual is None:
                errors.append(f"{path}.target is not countable: {target}")
            elif constraint_type == "exact_count" and actual != value:
                errors.append(
                    f"{path} requires exactly {value} {target}, found {actual}"
                )
            elif constraint_type == "max_count" and actual > value:
                errors.append(
                    f"{path} allows at most {value} {target}, found {actual}"
                )
        elif constraint_type == "single_headed":
            if target not in {"force", "forces", "vector", "vectors"} or value != 1:
                errors.append(
                    f"{path} single_headed must target vectors with value 1"
                )
        elif constraint_type == "text_free_raster":
            if target != "image" or value != 1:
                errors.append(
                    f"{path} text_free_raster must target image with value 1"
                )
        elif constraint_type == "labels_match_components":
            if target != "labels" or value != 1:
                errors.append(
                    f"{path} labels_match_components must target labels with value 1"
                )

    _safe_text(
        plan.get("render_prompt"),
        "$.render_prompt",
        errors,
        max_length=500,
    )

    if plan.get("scene_kind") == "free_body_diagram":
        _validate_free_body_physics(
            plan,
            objects_by_id=objects_by_id,
            vectors_by_id=vectors_by_id,
            label_roots=label_roots,
            errors=errors,
        )

    if errors:
        raise ScenePlanValidationError(errors)


def _validate_free_body_physics(
    plan: dict[str, Any],
    *,
    objects_by_id: dict[str, dict[str, Any]],
    vectors_by_id: dict[str, dict[str, Any]],
    label_roots: list[str],
    errors: list[str],
) -> None:
    bodies = [item for item in objects_by_id.values() if item.get("type") == "body"]
    surfaces = [
        item for item in objects_by_id.values() if item.get("type") == "surface"
    ]
    supports = [
        item for item in objects_by_id.values() if item.get("type") == "support"
    ]
    angles = [
        item for item in objects_by_id.values() if item.get("type") == "angle_arc"
    ]
    extra_objects = [
        item
        for item in objects_by_id.values()
        if item.get("type") not in {"body", "surface", "angle_arc", "support"}
    ]
    if len(bodies) != 1 or bodies[0].get("count") != 1:
        errors.append("free_body_diagram requires exactly one body")
    if len(surfaces) != 1 or surfaces[0].get("count") != 1:
        errors.append("free_body_diagram requires exactly one surface")
    if supports:
        errors.append("free_body_diagram forbids extra supports/platforms")
    if extra_objects:
        errors.append("free_body_diagram forbids extra semantic objects")
    if len(angles) != 1 or angles[0].get("count") != 1:
        errors.append("free_body_diagram requires exactly one angle_arc")
    if not bodies or not surfaces:
        return

    body_id = str(bodies[0].get("id"))
    surface_id = str(surfaces[0].get("id"))
    if surfaces[0].get("shape") != "incline":
        errors.append("free_body_diagram currently requires an incline surface")
    angle_deg = surfaces[0].get("angle_deg")
    if (
        not isinstance(angle_deg, (int, float))
        or isinstance(angle_deg, bool)
        or not 5 <= float(angle_deg) <= 75
    ):
        errors.append("incline angle_deg must be between 5 and 75")
    if angles and angles[0].get("between") != [surface_id, "horizontal"]:
        errors.append("angle_arc must be between the incline and horizontal")

    contact_ok = False
    relations = plan.get("relations") or []
    for relation in relations:
        if not isinstance(relation, dict):
            continue
        subject_root = _ref_parts(str(relation.get("subject", "")))[0]
        object_root = _ref_parts(str(relation.get("object", "")))[0]
        if (
            relation.get("type") in {"contact", "on"}
            and subject_root == body_id
            and object_root == surface_id
        ):
            contact_ok = True
    if not contact_ok:
        errors.append("body on a surface requires an explicit contact relation")

    by_subtype: dict[str, dict[str, Any]] = {}
    for vector in vectors_by_id.values():
        if vector.get("kind") != "force":
            errors.append("free_body_diagram vectors must all be force vectors")
        if vector.get("target") != f"{body_id}.center":
            errors.append(
                f"force vector {vector.get('id')} must attach to {body_id}.center"
            )
        subtype = str(vector.get("subtype", "")).lower()
        canonical = "gravity" if subtype in {"gravity", "weight"} else subtype
        if canonical in by_subtype:
            errors.append(f"Duplicate force vector subtype: {canonical}")
        by_subtype[canonical] = vector
    if set(by_subtype) != {"gravity", "normal", "friction"}:
        errors.append(
            "free_body_diagram requires exactly gravity, normal and friction"
        )
        return

    gravity_direction = by_subtype["gravity"].get("direction") or {}
    if gravity_direction.get("type") != "down":
        errors.append("gravity must point vertically down")

    normal_direction = by_subtype["normal"].get("direction") or {}
    if (
        normal_direction.get("type") != "perpendicular_to"
        or _ref_parts(str(normal_direction.get("reference", "")))[0] != surface_id
        or normal_direction.get("side") != "outward"
    ):
        errors.append("normal must be perpendicular_to the surface and outward")

    friction_direction = by_subtype["friction"].get("direction") or {}
    if (
        friction_direction.get("type") != "parallel_to"
        or _ref_parts(str(friction_direction.get("reference", "")))[0]
        != surface_id
        or friction_direction.get("sense") not in {"up_slope", "down_slope"}
    ):
        errors.append("friction must be parallel_to the surface")

    semantic_relations = {
        (
            relation.get("type"),
            _ref_parts(str(relation.get("subject", "")))[0],
            _ref_parts(str(relation.get("object", "")))[0],
        ): relation
        for relation in relations
        if isinstance(relation, dict)
    }
    normal_relation = semantic_relations.get(
        ("perpendicular_to", str(by_subtype["normal"]["id"]), surface_id)
    )
    if normal_relation is None:
        errors.append("normal requires an explicit perpendicular_to relation")
    elif normal_relation.get("side") != "outward":
        errors.append("normal relation must specify side outward")

    friction_relation = semantic_relations.get(
        ("parallel_to", str(by_subtype["friction"]["id"]), surface_id)
    )
    if friction_relation is None:
        errors.append("friction requires an explicit parallel_to relation")
    elif friction_relation.get("sense") != friction_direction.get("sense"):
        errors.append("friction relation sense must match vector direction")

    expected_label_roots = set(vectors_by_id) | {
        str(angle.get("id")) for angle in angles
    }
    if set(label_roots) != expected_label_roots or len(label_roots) != len(
        expected_label_roots
    ):
        errors.append("labels must correspond one-to-one with vectors and angle")


def validate_critic_result(result: dict[str, Any]) -> None:
    errors: list[str] = []
    item = _strict_fields(
        result,
        allowed={"valid", "score", "violations", "repair_action", "repair_prompt"},
        required={"valid", "score", "violations", "repair_action", "repair_prompt"},
        path="$",
        errors=errors,
    )
    if item is None:
        raise ScenePlanValidationError(errors)
    if not isinstance(item.get("valid"), bool):
        errors.append("$.valid must be boolean")
    score = item.get("score")
    if (
        not isinstance(score, (int, float))
        or isinstance(score, bool)
        or not 0 <= float(score) <= 1
    ):
        errors.append("$.score must be between 0 and 1")
    if item.get("repair_action") not in {"none", "regenerate", "use_deterministic"}:
        errors.append("$.repair_action is invalid")
    _safe_text(
        item.get("repair_prompt"),
        "$.repair_prompt",
        errors,
        max_length=500,
        allow_empty=True,
    )
    violations = item.get("violations")
    if not isinstance(violations, list):
        errors.append("$.violations must be an array")
        violations = []
    allowed_violation_types = set(
        CRITIC_JSON_SCHEMA["properties"]["violations"]["items"]["properties"][
            "type"
        ]["enum"]
    )
    for index, raw_violation in enumerate(violations):
        path = f"$.violations[{index}]"
        violation = _strict_fields(
            raw_violation,
            allowed={"type", "component", "description", "severity"},
            required={"type", "component", "description", "severity"},
            path=path,
            errors=errors,
        )
        if not violation:
            continue
        if violation.get("type") not in allowed_violation_types:
            errors.append(f"{path}.type is invalid")
        if violation.get("severity") not in {"low", "medium", "high"}:
            errors.append(f"{path}.severity is invalid")
        _safe_text(
            violation.get("component"),
            f"{path}.component",
            errors,
            max_length=80,
        )
        _safe_text(
            violation.get("description"),
            f"{path}.description",
            errors,
            max_length=300,
        )
    if item.get("valid"):
        if violations:
            errors.append("valid critic result must not contain violations")
        if item.get("repair_action") != "none":
            errors.append("valid critic result must use repair_action 'none'")
        if str(item.get("repair_prompt") or "").strip():
            errors.append("valid critic result must have an empty repair_prompt")
    else:
        if not violations:
            errors.append("invalid critic result must contain a concrete violation")
        if item.get("repair_action") not in {"regenerate", "use_deterministic"}:
            errors.append(
                "invalid critic result must request regenerate or use_deterministic"
            )
    if errors:
        raise ScenePlanValidationError(errors)


_SCENE_PLANNER_SYSTEM_PROMPT = """
You are the semantic planner for deterministic scientific illustrations.
Return exactly one JSON object matching scientific_scene_plan schema_version
0.1. Do not output Markdown, code fences, commentary or text outside JSON.

You describe scientific meaning only. The backend owns all geometry. Never
emit SVG, path data, HTML, Bezier controls, arrays of points, arbitrary x/y
coordinates, pixel positions, width or height.

Use objects for bodies, surfaces, supports and angle arcs; relations for
contact/on/parallel_to/perpendicular_to; vectors for forces; labels only as
semantic attachments. Use known anchors such as block1.center,
block1.contact, incline1.vertex, gravity.mid and angle1.mid.

For a block resting on an incline with all forces:
- exactly one body and one incline surface;
- no support/platform object;
- one explicit contact relation from body.contact to the surface;
- exactly gravity, normal and friction;
- gravity direction.type is down;
- normal direction.type is perpendicular_to, references the surface, side outward;
- friction direction.type is parallel_to and references the surface;
- also include explicit perpendicular_to and parallel_to relations;
- exactly one angle_arc between the incline and horizontal;
- one label for each vector and one for the angle;
- each semantic item has a unique id;
- render_prompt describes visual STYLE only, not layout or object positions.

Required free-body example:
{
  "type": "scientific_scene_plan",
  "schema_version": "0.1",
  "scene_kind": "free_body_diagram",
  "canvas": {"aspect_ratio": "16:9", "background": "white"},
  "objects": [
    {"id": "incline1", "type": "surface", "role": "inclined plane", "shape": "incline", "count": 1, "angle_deg": 30},
    {"id": "block1", "type": "body", "role": "rectangular block", "shape": "block", "count": 1, "size": "medium"},
    {"id": "angle1", "type": "angle_arc", "role": "incline angle", "shape": "arc", "count": 1, "between": ["incline1", "horizontal"]}
  ],
  "relations": [
    {"id": "contact1", "type": "contact", "subject": "block1.contact", "object": "incline1.center"},
    {"id": "normal_relation", "type": "perpendicular_to", "subject": "normal", "object": "incline1", "side": "outward"},
    {"id": "friction_relation", "type": "parallel_to", "subject": "friction", "object": "incline1", "sense": "up_slope"}
  ],
  "vectors": [
    {"id": "gravity", "kind": "force", "subtype": "gravity", "target": "block1.center", "direction": {"type": "down"}, "length": "medium"},
    {"id": "normal", "kind": "force", "subtype": "normal", "target": "block1.center", "direction": {"type": "perpendicular_to", "reference": "incline1", "side": "outward"}, "length": "medium"},
    {"id": "friction", "kind": "force", "subtype": "friction", "target": "block1.center", "direction": {"type": "parallel_to", "reference": "incline1", "sense": "up_slope"}, "length": "medium"}
  ],
  "labels": [
    {"id": "gravity_label", "text": "Сила тяжести mg", "attach_to": "gravity.mid", "placement": "right"},
    {"id": "normal_label", "text": "Нормальная реакция N", "attach_to": "normal.mid", "placement": "above"},
    {"id": "friction_label", "text": "Сила трения f", "attach_to": "friction.mid", "placement": "above"},
    {"id": "angle_label", "text": "30°", "attach_to": "angle1.mid", "placement": "right"}
  ],
  "constraints": [
    {"id": "body_count", "type": "exact_count", "target": "body", "value": 1},
    {"id": "surface_count", "type": "exact_count", "target": "surface", "value": 1},
    {"id": "force_count", "type": "exact_count", "target": "force", "value": 3},
    {"id": "support_count", "type": "exact_count", "target": "support", "value": 0},
    {"id": "single_heads", "type": "single_headed", "target": "force", "value": 1},
    {"id": "text_free", "type": "text_free_raster", "target": "image", "value": 1},
    {"id": "label_match", "type": "labels_match_components", "target": "labels", "value": 1}
  ],
  "render_prompt": "Professional flat scientific textbook illustration with clean outlines and restrained colors."
}
""".strip()


_CRITIC_SYSTEM_PROMPT = """
You are a visual critic for scientific diagrams. Return exactly one strict JSON
object and no other text. Compare the supplied final preview against the
immutable semantic plan. Never rewrite or silently change the plan.

Check object count, force-arrow count, single-headed arrows, vector directions,
contacts, parallel/perpendicular relations, angle placement, duplicate supports,
missing objects, severe clutter, accidental text or pseudo-text, and whether
deterministic labels can be placed safely. Describe every concrete violation.
The preview intentionally has NO visible text labels: labels are added later as
separate draggable DOM elements. Never report missing labels as a violation;
instead verify that the planned label anchors have clear whitespace. Force
arrows, angle arcs and exact contours are deterministic backend overlays. Check
them against the plan, but never ask the image generator to draw or label them.
The semantic plan is ground truth: do not infer an unstated motion or reverse a
vector that already matches its declared direction.
If the image is correct, use repair_action "none". If the raster base should be
regenerated, use "regenerate" and a short repair_prompt that preserves the plan.
If generated styling cannot preserve the plan, use "use_deterministic".
Any repair_prompt may discuss only raster objects, contacts, duplicate supports,
clutter and accidental pseudo-text. It must never request labels, formulas,
arrows, vectors or angle marks.
""".strip()


def _openrouter_client():
    from openai import OpenAI

    return OpenAI(
        api_key=_openrouter_api_key(),
        base_url=_openrouter_base_url(),
        max_retries=0,
    )


def _call_qwen_json(
    *,
    model: str,
    system_prompt: str,
    user_content: str | list[dict[str, Any]],
    schema_name: str,
    schema: dict[str, Any],
    timeout: int,
    max_tokens: int,
) -> dict[str, Any]:
    """Call the existing OpenRouter transport with enforced JSON Schema."""
    from .usage import provider_from_base_url, record_model_usage

    if not _openrouter_api_key():
        raise RuntimeError("OpenRouter API key is not configured")
    response = _openrouter_client().chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": schema_name,
                "strict": True,
                "schema": schema,
            },
        },
        extra_body={"provider": {"require_parameters": True}},
        temperature=0,
        max_tokens=max_tokens,
        timeout=timeout,
    )
    record_model_usage(
        response,
        model=model,
        provider=provider_from_base_url(_openrouter_base_url()),
        feature=(
            "diagram_critic"
            if schema_name == "scientific_diagram_critique"
            else "diagram_planner"
        ),
        input_payload=[system_prompt, user_content],
    )
    raw = response.choices[0].message.content
    if not isinstance(raw, str):
        raise ScenePlanValidationError(["Qwen response content must be JSON text"])
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ScenePlanValidationError([f"Qwen returned invalid JSON: {exc}"]) from exc
    if not isinstance(parsed, dict):
        raise ScenePlanValidationError(["Qwen JSON root must be an object"])
    return parsed


def _plan_scene(
    prompt: str,
    seed_labels: list[dict] | None,
) -> dict[str, Any] | None:
    if not _planner_enabled() or not _openrouter_api_key():
        logger.info("[DiagramPipeline] Qwen planner unavailable; using legacy fallback")
        return None
    preferred = [
        str(label.get("content", "")).strip()
        for label in (seed_labels or [])
        if isinstance(label, dict) and str(label.get("content", "")).strip()
    ]
    wording = (
        "\nPreferred label wording: " + "; ".join(preferred)
        if preferred
        else ""
    )
    try:
        plan = _call_qwen_json(
            model=_planner_model(),
            system_prompt=_SCENE_PLANNER_SYSTEM_PROMPT,
            user_content=f"Scientific illustration request: {prompt}{wording}",
            schema_name="scientific_scene_plan",
            schema=SCENE_PLAN_JSON_SCHEMA,
            timeout=int(getattr(settings, "DIAGRAM_PLANNER_TIMEOUT", 45)),
            max_tokens=int(getattr(settings, "DIAGRAM_PLANNER_MAX_TOKENS", 2400)),
        )
        validate_scientific_scene_plan(plan)
        return plan
    except Exception as exc:  # noqa: BLE001 — planner failure must fall back
        logger.warning("[DiagramPipeline] Qwen planner failed: %s", exc)
        return None


def _critique_scene(
    plan: dict[str, Any],
    image_url: str,
) -> dict[str, Any] | None:
    if not _critic_enabled() or not _openrouter_api_key():
        logger.info("[DiagramPipeline] Qwen critic unavailable; returning generated result")
        return None
    content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                "Immutable semantic plan:\n"
                + json.dumps(plan, ensure_ascii=False, separators=(",", ":"))
                + "\nInspect the final preview image and return the critic JSON."
            ),
        },
        {"type": "image_url", "image_url": {"url": image_url}},
    ]
    try:
        result = _call_qwen_json(
            model=_critic_model(),
            system_prompt=_CRITIC_SYSTEM_PROMPT,
            user_content=content,
            schema_name="scientific_diagram_critique",
            schema=CRITIC_JSON_SCHEMA,
            timeout=int(getattr(settings, "DIAGRAM_CRITIC_TIMEOUT", 45)),
            max_tokens=int(getattr(settings, "DIAGRAM_CRITIC_MAX_TOKENS", 1200)),
        )
        validate_critic_result(result)
        return result
    except Exception as exc:  # noqa: BLE001 — critic failure is non-fatal
        logger.warning("[DiagramPipeline] Qwen critic failed: %s", exc)
        return None


def _looks_like_scientific_request(prompt: str) -> bool:
    from .image_enrichment import (
        _is_scientific_diagram_context,
        _is_task_diagram_context,
    )

    return _is_scientific_diagram_context(prompt) or _is_task_diagram_context(prompt)


def _anchor_for_vector_layout(reference: str) -> str:
    root, anchor = _ref_parts(reference)
    alias = {"contact": "bottom", "vertex": "left"}.get(anchor or "", anchor)
    return f"{root}.{alias}" if alias else root


def scene_plan_to_vector_layout(
    plan: dict[str, Any],
) -> dict[str, Any] | None:
    """Normalize a supported semantic scene into the existing Vector DSL."""
    validate_scientific_scene_plan(plan)
    if plan.get("scene_kind") != "free_body_diagram":
        return None

    objects = [copy.deepcopy(item) for item in plan["objects"]]
    surface = next(item for item in objects if item["type"] == "surface")
    body = next(item for item in objects if item["type"] == "body")
    angle = next(item for item in objects if item["type"] == "angle_arc")
    labels_by_root = {
        _ref_parts(label["attach_to"])[0]: label["text"]
        for label in plan["labels"]
    }

    surface_id = surface["id"]
    body_id = body["id"]
    components: list[dict[str, Any]] = [
        {
            "id": surface_id,
            "type": "surface",
            "shape": surface["shape"],
            "angle_deg": float(surface.get("angle_deg") or 30),
        },
        {
            "id": body_id,
            "type": "body",
            "shape": body["shape"],
            "on": surface_id,
            "size": body.get("size") or "medium",
        },
    ]

    for vector in plan["vectors"]:
        direction = vector["direction"]
        direction_type = direction["type"]
        if direction_type in {"up", "down", "left", "right"}:
            normalized_direction: str | dict[str, Any] = direction_type
        elif direction_type == "parallel_to":
            normalized_direction = {
                "parallel_to": _ref_parts(direction["reference"])[0],
                "sense": direction.get("sense") or "up_slope",
            }
        else:
            normalized_direction = {
                "perpendicular_to": _ref_parts(direction["reference"])[0],
                "side": direction.get("side") or "outward",
            }
        subtype = str(vector["subtype"]).lower()
        components.append(
            {
                "id": vector["id"],
                "type": "vector",
                "kind": vector["kind"],
                "subtype": "weight" if subtype == "gravity" else subtype,
                "target": _anchor_for_vector_layout(vector["target"]),
                "direction": normalized_direction,
                "length": vector["length"],
                "label": labels_by_root[vector["id"]],
            }
        )

    between = angle.get("between") or [surface_id, "horizontal"]
    components.append(
        {
            "id": angle["id"],
            "type": "angle_arc",
            "between": [_ref_parts(str(between[0]))[0], "horizontal"],
            "label": labels_by_root[angle["id"]],
        }
    )
    layout = {
        "type": "vector_layout",
        "schema_version": "0.1",
        "canvas": {"width": 1024, "height": 576, "background": "white"},
        "components": components,
    }
    ensure_semantic_vector_layout(layout)
    return layout


def _compact_style_prompt(
    plan: dict[str, Any],
    *,
    style: str | None,
    palette: str | None,
) -> str:
    style_key = (style or "").strip().lower().replace(".", "_").replace("-", "_")
    if style_key == "2_5d":
        normalized_style = "2_5d"
    else:
        normalized_style = style_key
    style_prompt = _COMPACT_STYLE_PROMPTS.get(normalized_style)
    if style_prompt is None:
        style_prompt = str(plan.get("render_prompt") or "").strip()

    palette_key = (palette or "").strip().lower()
    palette_prompt = (
        ""
        if normalized_style == "sketch"
        else _COMPACT_PALETTE_PROMPTS.get(palette_key, "")
    )
    return " ".join(part for part in (style_prompt, palette_prompt) if part)


def build_seedream_prompt(
    plan: dict[str, Any],
    *,
    deterministic_overlay: bool,
    repair_prompt: str = "",
    style: str | None = None,
    palette: str | None = None,
) -> str:
    """Build a short positive prompt from validated semantics, not user prose."""
    validate_scientific_scene_plan(plan)
    style_prompt = _compact_style_prompt(
        plan,
        style=style,
        palette=palette,
    )
    if plan["scene_kind"] == "free_body_diagram":
        surface = next(item for item in plan["objects"] if item["type"] == "surface")
        body = next(item for item in plan["objects"] if item["type"] == "body")
        angle = float(surface.get("angle_deg") or 30)
        vector_instruction = (
            "Reserve clear paths for exactly three deterministic force overlays: "
            "gravity vertically downward, normal perpendicular outward from the "
            "incline, and friction parallel along the incline. "
            "Render no arrows, labels, text, formulas or angle marks in the raster."
            if deterministic_overlay
            else (
                "Draw exactly three single-headed force arrows: gravity vertically "
                "downward, normal perpendicular outward from the incline, and "
                "friction parallel along the incline. Render no text or labels."
            )
        )
        angle_instruction = (
            "Leave the lower surface vertex visually clear for one deterministic "
            "angle overlay."
            if deterministic_overlay
            else "Draw one small angle arc at the lower surface vertex."
        )
        prompt = (
            "Create a clean educational mechanics diagram on a white background. "
            f"Show exactly one {body['shape']} flush on exactly one {angle:g}-degree "
            f"{surface['shape']} surface. The body must visibly touch the surface. "
            f"{vector_instruction} "
            f"{angle_instruction} "
            "No extra supports, rails, platforms, objects or decorative elements. "
            f"{style_prompt}"
        )
    else:
        object_text = "; ".join(
            f"exactly {item['count']} {item['role']} ({item['shape']})"
            for item in plan["objects"]
        )
        relation_text = "; ".join(
            f"{item['subject']} {item['type']} {item['object']}"
            for item in plan["relations"]
        )
        vector_text = "; ".join(
            f"{item['subtype']} from {item['target']} toward {item['direction']['type']}"
            for item in plan["vectors"]
        )
        prompt = (
            "Create a clean educational scientific illustration on a white background. "
            f"Objects: {object_text}. Relations: {relation_text or 'none'}. "
            f"Vectors: {vector_text or 'none'}. {style_prompt} "
            "Keep the composition uncluttered and render no text or pseudo-text."
        )
    if repair_prompt:
        prompt += f" Correction for this retry: {repair_prompt.strip()}"
    return re.sub(r"\s+", " ", prompt).strip()


def _svg_data_url(svg: str) -> str:
    encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"


def _render_deterministic_layers(layout: dict[str, Any]) -> dict[str, Any]:
    renderer = VectorRenderer(emit_text=False)
    full_svg, structure_svg, overlay_svg, labels = (
        renderer.render_layers_with_labels(layout)
    )
    return {
        "full_svg": full_svg,
        "structure_svg": structure_svg,
        "overlay_svg": overlay_svg,
        "labels": labels,
        "deterministic_png": svg_to_png_data_url(full_svg),
        "structure_png": svg_to_png_data_url(structure_svg),
        "overlay_svg_url": _svg_data_url(overlay_svg),
    }


def _decode_image_url(image_url: str):
    import cv2
    import numpy as np
    import requests

    if image_url.startswith("data:image/"):
        try:
            encoded = image_url.split(",", 1)[1]
            raw = base64.b64decode(encoded, validate=True)
        except (IndexError, ValueError) as exc:
            raise ValueError("Invalid image data URL") from exc
    elif image_url.startswith(("https://", "http://")):
        response = requests.get(
            image_url,
            timeout=min(30, int(getattr(settings, "IMAGE_GEN_TIMEOUT", 60))),
        )
        response.raise_for_status()
        raw = response.content
    else:
        raise ValueError("Unsupported generated image URL")
    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Generated image cannot be decoded")
    return image


def _hex_to_bgr(color: str) -> tuple[int, int, int]:
    value = color.lstrip("#")
    if not re.fullmatch(r"[0-9A-Fa-f]{6}", value):
        return (36, 55, 70)
    red, green, blue = (
        int(value[0:2], 16),
        int(value[2:4], 16),
        int(value[4:6], 16),
    )
    return blue, green, red


def _compose_vector_overlay(image_url: str, overlay_svg: str) -> str:
    """Rasterize the backend-owned SVG marks over a Seedream base image."""
    import cv2
    import numpy as np

    image = _decode_image_url(image_url)
    root = ET.fromstring(overlay_svg)
    width = int(round(float(root.attrib.get("width", image.shape[1]))))
    height = int(round(float(root.attrib.get("height", image.shape[0]))))
    image = cv2.resize(image, (width, height), interpolation=cv2.INTER_AREA)

    for element in root.iter():
        tag = element.tag.rsplit("}", 1)[-1]
        role = element.attrib.get("data-role")
        if tag == "line" and role in {
            "force-vector",
            "vector",
            "dimension-line",
            "axis",
            "floor",
            "wall",
            "body",
        }:
            start = (
                int(round(float(element.attrib["x1"]))),
                int(round(float(element.attrib["y1"]))),
            )
            end = (
                int(round(float(element.attrib["x2"]))),
                int(round(float(element.attrib["y2"]))),
            )
            color = _hex_to_bgr(element.attrib.get("stroke", "#243746"))
            thickness = max(
                1, int(round(float(element.attrib.get("stroke-width", "3"))))
            )
            if "marker-end" in element.attrib:
                length = max(1.0, math.dist(start, end))
                cv2.arrowedLine(
                    image,
                    start,
                    end,
                    color,
                    thickness,
                    line_type=cv2.LINE_AA,
                    tipLength=min(0.24, 16.0 / length),
                )
            else:
                cv2.line(
                    image,
                    start,
                    end,
                    color,
                    thickness,
                    lineType=cv2.LINE_AA,
                )
        elif tag == "polygon" and role in {"incline", "body"}:
            points = []
            for token in element.attrib.get("points", "").split():
                coordinates = token.split(",")
                if len(coordinates) != 2:
                    raise ValueError("Malformed deterministic polygon")
                points.append(
                    (
                        int(round(float(coordinates[0]))),
                        int(round(float(coordinates[1]))),
                    )
                )
            if len(points) < 3:
                raise ValueError("Deterministic polygon has too few points")
            color = _hex_to_bgr(element.attrib.get("stroke", "#243746"))
            thickness = max(
                1, int(round(float(element.attrib.get("stroke-width", "3"))))
            )
            cv2.polylines(
                image,
                [np.asarray(points, dtype=np.int32)],
                True,
                color,
                thickness,
                lineType=cv2.LINE_AA,
            )
        elif tag == "circle" and role == "body":
            center = (
                int(round(float(element.attrib["cx"]))),
                int(round(float(element.attrib["cy"]))),
            )
            radius = int(round(float(element.attrib["r"])))
            color = _hex_to_bgr(element.attrib.get("stroke", "#243746"))
            thickness = max(
                1, int(round(float(element.attrib.get("stroke-width", "3"))))
            )
            cv2.circle(
                image,
                center,
                radius,
                color,
                thickness,
                lineType=cv2.LINE_AA,
            )
        elif tag == "path" and role == "angle-arc":
            center = (
                int(round(float(element.attrib["data-center-x"]))),
                int(round(float(element.attrib["data-center-y"]))),
            )
            radius = int(round(float(element.attrib["data-radius"])))
            angle_deg = float(element.attrib["data-angle-deg"])
            color = _hex_to_bgr(element.attrib.get("stroke", "#111827"))
            thickness = max(
                1, int(round(float(element.attrib.get("stroke-width", "2.5"))))
            )
            cv2.ellipse(
                image,
                center,
                (radius, radius),
                0,
                -angle_deg,
                0,
                color,
                thickness,
                lineType=cv2.LINE_AA,
            )

    ok, encoded = cv2.imencode(".png", image)
    if not ok:
        raise ValueError("Could not encode deterministic overlay composite")
    return "data:image/png;base64," + base64.b64encode(encoded.tobytes()).decode(
        "ascii"
    )


def _critic_repair_text(critic: dict[str, Any]) -> str:
    """Translate critic findings into a small trusted raster-only correction.

    A critic-provided free-form prompt is metadata, not executable authority:
    the model may incorrectly ask Seedream to add labels/arrows that belong to
    the deterministic overlay. The backend therefore maps only repairable
    raster violations to fixed instructions.
    """
    repairs: list[str] = []
    for violation in critic.get("violations") or []:
        if not isinstance(violation, dict):
            continue
        violation_type = violation.get("type")
        component = str(violation.get("component") or "").strip().lower()
        if violation_type in {"wrong_count", "duplicate_support", "missing_object"}:
            if any(
                token in component
                for token in ("label", "text", "arrow", "vector", "angle")
            ):
                continue
            repairs.append(
                "Render every planned physical object exactly once with no "
                "duplicate bodies, surfaces, rails or supports."
            )
        elif violation_type in {"missing_contact", "wrong_relation"}:
            repairs.append(
                "Keep each planned body flush against its referenced contact "
                "surface and preserve all physical attachments."
            )
        elif violation_type == "clutter":
            repairs.append(
                "Remove decorative clutter while preserving every planned "
                "physical object and contact."
            )
        elif violation_type == "accidental_text":
            repairs.append(
                "Remove all visible text, pseudo-text, symbols and glyph-like marks."
            )
        elif violation_type == "unsafe_label_space":
            repairs.append(
                "Leave clean empty whitespace around the planned overlay anchors."
            )

    return " ".join(dict.fromkeys(repairs))[:500]


def _calibrate_critic_result(
    critic: dict[str, Any],
    plan: dict[str, Any],
    *,
    deterministic_overlay: bool,
) -> dict[str, Any]:
    """Remove critic claims contradicted by backend-owned deterministic layers."""
    effective = copy.deepcopy(critic)
    vector_ids = {
        str(vector.get("id"))
        for vector in plan.get("vectors") or []
        if isinstance(vector, dict)
    }
    angle_ids = {
        str(item.get("id"))
        for item in plan.get("objects") or []
        if isinstance(item, dict) and item.get("type") == "angle_arc"
    }
    deterministic_ids = vector_ids | angle_ids
    kept: list[dict[str, Any]] = []

    for violation in effective.get("violations") or []:
        if not isinstance(violation, dict):
            continue
        violation_type = str(violation.get("type") or "")
        component = str(violation.get("component") or "").strip().lower()
        description = str(violation.get("description") or "").strip().lower()

        missing_label_claim = (
            "label" in component
            and any(
                phrase in description
                for phrase in ("missing", "not present", "none of", "absent")
            )
        )
        if missing_label_claim:
            continue

        component_is_deterministic = any(
            component == item.lower() or item.lower() in component
            for item in deterministic_ids
        )
        if deterministic_overlay and (
            (
                violation_type
                in {"wrong_direction", "wrong_relation", "angle_misplaced"}
                and component_is_deterministic
            )
            or (
                violation_type == "missing_object"
                and (
                    component_is_deterministic
                    or any(
                        token in component
                        for token in ("angle", "arrow", "vector")
                    )
                )
            )
        ):
            continue
        kept.append(violation)

    effective["violations"] = kept
    if not kept:
        effective.update(
            {
                "valid": True,
                "score": max(float(effective.get("score") or 0), 0.9),
                "repair_action": "none",
                "repair_prompt": "",
            }
        )
    elif effective.get("valid"):
        effective["valid"] = False
        effective["repair_action"] = "use_deterministic"
        effective["repair_prompt"] = ""
    validate_critic_result(effective)
    return effective


def _pipeline_metadata(
    *,
    mode: str,
    critic: dict[str, Any] | None,
    critic_raw: dict[str, Any] | None,
    attempts: int,
    fallback: str | None,
) -> dict[str, Any]:
    return {
        "mode": mode,
        "planner_model": _planner_model(),
        "critic_model": _critic_model() if mode == "planner_critic" else None,
        "image_model": _image_model(),
        "attempts": attempts,
        "fallback": fallback,
        "critic": copy.deepcopy(critic),
        "critic_raw": (
            copy.deepcopy(critic_raw)
            if critic_raw is not None and critic_raw != critic
            else None
        ),
    }


# ──────────────────────────────────────────────────────────────────
# Публичный вход
# ──────────────────────────────────────────────────────────────────


def try_build_vector_illustration(
    prompt: str,
    *,
    seed_labels: list[dict] | None = None,
    topic_hint: str = "",
    style: str | None = None,
    palette: str | None = None,
) -> dict[str, Any] | None:
    """Run the feature-flagged planner/critic pipeline or decline to legacy.

    `None` deliberately means “use the unchanged legacy `_enrich_command`”.
    The successful result preserves the existing image_with_labels contract;
    diagnostic plan/model fields are additive and ignored by old clients.
    """
    style = style if isinstance(style, str) else None
    palette = palette if isinstance(palette, str) else None
    if not _enabled():
        return None
    mode = _pipeline_mode()
    # Keeps old unit patches and the retired boolean flag useful.
    if mode == "legacy":
        mode = "deterministic"

    supported_mechanics = _looks_like_supported_mechanics(prompt)
    if mode == "deterministic" and not supported_mechanics:
        return None
    if not supported_mechanics and not _looks_like_scientific_request(prompt):
        return None

    plan = _plan_scene(prompt, seed_labels)
    if plan is None:
        return None

    try:
        layout = scene_plan_to_vector_layout(plan)
    except (ScenePlanValidationError, VectorRenderError) as exc:
        logger.warning("[DiagramPipeline] semantic normalization failed: %s", exc)
        return None

    layers: dict[str, Any] | None = None
    if layout is not None:
        try:
            layers = _render_deterministic_layers(layout)
        except Exception as exc:  # noqa: BLE001 — fallback remains legacy
            logger.warning("[DiagramPipeline] deterministic render failed: %s", exc)
            return None

    last_raw_critic: dict[str, Any] | None = None

    def build_result(
        base_image_url: str,
        *,
        critic: dict[str, Any] | None,
        attempts: int,
        fallback: str | None,
    ) -> dict[str, Any]:
        result: dict[str, Any] = {
            "base_image_url": base_image_url,
            "labels": copy.deepcopy(
                layers["labels"] if layers is not None else (seed_labels or [])
            ),
            "masks": None,
            "gen_style": style or VECTOR_GEN_STYLE,
            "semantic_plan": copy.deepcopy(plan),
            "diagram_pipeline": _pipeline_metadata(
                mode=mode,
                critic=critic,
                critic_raw=last_raw_critic,
                attempts=attempts,
                fallback=fallback,
            ),
        }
        if layout is not None:
            result["vector_layout"] = copy.deepcopy(layout)
        if layers is not None:
            result["overlay_svg_url"] = layers["overlay_svg_url"]
        return result

    if mode == "deterministic":
        if layers is None:
            return None
        return build_result(
            layers["deterministic_png"],
            critic=None,
            attempts=0,
            fallback=None,
        )

    from .image_enrichment import generate_raster_image

    retry_limit = _max_retries() if mode == "planner_critic" else 0
    repair_prompt = ""
    last_critic: dict[str, Any] | None = None
    attempts = 0
    while attempts <= retry_limit:
        attempts += 1
        compact_prompt = build_seedream_prompt(
            plan,
            deterministic_overlay=layers is not None,
            repair_prompt=repair_prompt,
            style=style,
            palette=palette,
        )
        try:
            generated = generate_raster_image(
                compact_prompt,
                style=style,
                palette=palette,
                reference_image_url=(
                    layers["structure_png"] if layers is not None else None
                ),
                scene=False,
                task_diagram=True,
                scientific_diagram=True,
                explicit_style_override=bool(
                    style
                    and style.strip().lower().replace(".", "_").replace("-", "_")
                    in {"sketch", "2_5d", "3d"}
                ),
                compact_prompt=True,
            )
        except Exception as exc:  # noqa: BLE001 — deterministic/legacy fallback
            logger.warning("[DiagramPipeline] Seedream failed: %s", exc)
            if layers is not None:
                return build_result(
                    layers["deterministic_png"],
                    critic=last_critic,
                    attempts=attempts,
                    fallback="seedream_unavailable",
                )
            return None

        if layers is not None:
            try:
                final_preview = _compose_vector_overlay(
                    generated,
                    layers["overlay_svg"],
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "[DiagramPipeline] SVG overlay composition failed: %s", exc
                )
                return build_result(
                    layers["deterministic_png"],
                    critic=last_critic,
                    attempts=attempts,
                    fallback="overlay_failed",
                )
        else:
            final_preview = generated

        if mode != "planner_critic" or not _critic_enabled():
            return build_result(
                final_preview,
                critic=None,
                attempts=attempts,
                fallback=None,
            )

        last_raw_critic = _critique_scene(plan, final_preview)
        if last_raw_critic is None:
            return build_result(
                final_preview,
                critic=None,
                attempts=attempts,
                fallback="critic_unavailable",
            )
        last_critic = _calibrate_critic_result(
            last_raw_critic,
            plan,
            deterministic_overlay=layers is not None,
        )
        if last_critic["valid"]:
            return build_result(
                final_preview,
                critic=last_critic,
                attempts=attempts,
                fallback=None,
            )
        if last_critic["repair_action"] == "use_deterministic" and layers is not None:
            return build_result(
                layers["deterministic_png"],
                critic=last_critic,
                attempts=attempts,
                fallback="critic_requested_deterministic",
            )
        if (
            last_critic["repair_action"] == "regenerate"
            and attempts <= retry_limit
        ):
            safe_repair = _critic_repair_text(last_critic)
            if safe_repair:
                repair_prompt = safe_repair
                continue
        if layers is not None:
            return build_result(
                layers["deterministic_png"],
                critic=last_critic,
                attempts=attempts,
                fallback="critic_rejected_styling",
            )
        return build_result(
            final_preview,
            critic=last_critic,
            attempts=attempts,
            fallback="critic_rejected_no_vector_fallback",
        )

    # The loop always returns, but keep an explicit safe fallback for type
    # checkers and future changes to retry accounting.
    if layers is not None:
        return build_result(
            layers["deterministic_png"],
            critic=last_critic,
            attempts=attempts,
            fallback="retry_exhausted",
        )
    return None
