import base64
import math
import os
import re
import tempfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from html import escape
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import requests
from django.test import TestCase


class VectorValidationError(ValueError):
    """Raised when semantic vector DSL input is unsafe or unsupported."""


@dataclass(frozen=True)
class Vec:
    x: float
    y: float

    def __add__(self, other: "Vec") -> "Vec":
        return Vec(self.x + other.x, self.y + other.y)

    def __sub__(self, other: "Vec") -> "Vec":
        return Vec(self.x - other.x, self.y - other.y)

    def __mul__(self, scalar: float) -> "Vec":
        return Vec(self.x * scalar, self.y * scalar)

    def unit(self) -> "Vec":
        length = math.hypot(self.x, self.y)
        if length == 0:
            raise VectorValidationError("Cannot normalize zero-length vector")
        return Vec(self.x / length, self.y / length)


@dataclass(frozen=True)
class SurfaceGeometry:
    left: Vec
    right: Vec
    center: Vec
    tangent: Vec
    normal: Vec


class VectorRenderer:
    """
    Deterministic semantic-layout renderer.

    The LLM may provide only semantic components. This class owns validation,
    geometry, SVG path generation, anchors, and escaping.
    """

    COMPONENT_TYPES = {
        "axis",
        "curve",
        "label",
        "math_label",
        "vector",
        "body",
        "surface",
        "angle_arc",
        "dimension_line",
        "connector",
        "trajectory",
    }
    BODY_SHAPES = {"block", "sphere", "particle", "rod"}
    SURFACE_SHAPES = {"floor", "wall", "incline"}
    CURVE_SHAPES = {"line", "parabola", "exponential"}
    VECTOR_KINDS = {"force", "velocity", "acceleration", "electric_field", "magnetic_field"}
    VECTOR_DIRECTIONS = {"up", "down", "left", "right", "parallel_to", "perpendicular_to"}
    CONNECTOR_KINDS = {"rope", "spring", "rod"}
    TRAJECTORY_SHAPES = {"projectile", "circular", "straight", "dashed_path"}
    PLACEMENTS = {"above", "below", "left", "right", "center"}
    LENGTHS = {"short": 70.0, "medium": 110.0, "long": 150.0}
    SIZES = {"small": 52.0, "medium": 82.0, "large": 116.0}
    DISALLOWED_KEYS = {
        "raw_svg",
        "svg",
        "svg_path",
        "path",
        "path_data",
        "d",
        "points",
        "vertices",
        "polyline",
        "bezier",
        "control_points",
        "foreignObject",
        "script",
        "image",
        "href",
        "xlink:href",
    }
    EXTERNAL_REF_RE = re.compile(r"(?:https?:|data:|javascript:|<\s*svg|<\s*script|foreignObject)", re.I)

    def __init__(self) -> None:
        self.width = 1024.0
        self.height = 768.0
        self.elements: list[str] = []
        self.anchors: dict[str, Vec] = {}
        self.surfaces: dict[str, SurfaceGeometry] = {}
        self.axes: dict[str, dict[str, Any]] = {}

    def render(self, layout: dict[str, Any]) -> str:
        self._validate_layout(layout)
        canvas = layout["canvas"]
        self.width = float(canvas["width"])
        self.height = float(canvas["height"])
        self.elements = []
        self.anchors = {}
        self.surfaces = {}
        self.axes = {}

        self.elements.append(f'<rect width="100%" height="100%" fill="{escape(canvas["background"])}"/>')
        for component in layout["components"]:
            self._render_component(component)

        body = "\n  ".join(self.elements)
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{int(self.width)}" '
            f'height="{int(self.height)}" viewBox="0 0 {int(self.width)} {int(self.height)}" '
            f'role="img" aria-label="deterministic vector layout">\n'
            "  <defs>\n"
            '    <marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" '
            'orient="auto" markerUnits="strokeWidth">\n'
            '      <path d="M2,2 L10,6 L2,10 Z" fill="black"/>\n'
            "    </marker>\n"
            "  </defs>\n"
            f"  {body}\n"
            "</svg>"
        )

    def _validate_layout(self, layout: dict[str, Any]) -> None:
        if not isinstance(layout, dict):
            raise VectorValidationError("Layout must be an object")
        self._reject_unsafe(layout)
        if layout.get("type") != "vector_layout":
            raise VectorValidationError("Layout type must be vector_layout")
        if layout.get("schema_version") != "0.1":
            raise VectorValidationError("Unsupported schema_version")
        canvas = layout.get("canvas")
        if not isinstance(canvas, dict):
            raise VectorValidationError("canvas must be an object")
        for key in ("width", "height", "background"):
            if key not in canvas:
                raise VectorValidationError(f"canvas.{key} is required")
        if not isinstance(canvas["width"], (int, float)) or not isinstance(canvas["height"], (int, float)):
            raise VectorValidationError("canvas dimensions must be numeric")
        if canvas["width"] <= 0 or canvas["height"] <= 0:
            raise VectorValidationError("canvas dimensions must be positive")
        if canvas["background"] not in {"white", "#fff", "#ffffff"}:
            raise VectorValidationError("Only a white background is allowed in V1")
        components = layout.get("components")
        if not isinstance(components, list):
            raise VectorValidationError("components must be a list")
        seen: set[str] = set()
        for component in components:
            if not isinstance(component, dict):
                raise VectorValidationError("Each component must be an object")
            cid = component.get("id")
            ctype = component.get("type")
            if not isinstance(cid, str) or not cid:
                raise VectorValidationError("Each component needs a non-empty id")
            if cid in seen:
                raise VectorValidationError(f"Duplicate component id: {cid}")
            seen.add(cid)
            if ctype not in self.COMPONENT_TYPES:
                raise VectorValidationError(f"Unknown component type: {ctype}")

    def _reject_unsafe(self, value: Any, key_path: str = "layout") -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                if key in self.DISALLOWED_KEYS:
                    raise VectorValidationError(f"Raw geometry/SVG field is not allowed: {key_path}.{key}")
                self._reject_unsafe(child, f"{key_path}.{key}")
        elif isinstance(value, list):
            for i, child in enumerate(value):
                self._reject_unsafe(child, f"{key_path}[{i}]")
        elif isinstance(value, str) and self.EXTERNAL_REF_RE.search(value):
            raise VectorValidationError(f"External refs or raw SVG are not allowed: {key_path}")

    def _render_component(self, component: dict[str, Any]) -> None:
        ctype = component["type"]
        if ctype == "axis":
            self._render_axis(component)
        elif ctype == "curve":
            self._render_curve(component)
        elif ctype in {"label", "math_label"}:
            self._render_label(component)
        elif ctype == "surface":
            self._render_surface(component)
        elif ctype == "body":
            self._render_body(component)
        elif ctype == "vector":
            self._render_vector(component)
        elif ctype == "angle_arc":
            self._render_angle_arc(component)
        elif ctype == "dimension_line":
            self._render_dimension_line(component)
        elif ctype == "connector":
            self._render_connector(component)
        elif ctype == "trajectory":
            self._render_trajectory(component)

    def _render_axis(self, c: dict[str, Any]) -> None:
        if c.get("origin") != "center":
            raise VectorValidationError("V1 axis supports only origin=center")
        cid = c["id"]
        origin = Vec(self.width / 2, self.height / 2)
        x_scale = self.width / 8
        # Wider y-range keeps standard school graphs like y=x² on [-3,3]
        # inside the deterministic 16:9 canvas without asking the model to scale.
        y_scale = self.height / 20
        self.axes[cid] = {"origin": origin, "x_scale": x_scale, "y_scale": y_scale}
        self._register_anchors(cid, {"center": origin, "origin": origin})
        if c.get("show_grid"):
            for i in range(-3, 4):
                x = origin.x + i * x_scale
                y = origin.y + i * y_scale
                self.elements.append(self._line(Vec(x, 40), Vec(x, self.height - 40), "#e5e7eb", 1))
                self.elements.append(self._line(Vec(40, y), Vec(self.width - 40, y), "#e5e7eb", 1))
        self.elements.append(self._line(Vec(40, origin.y), Vec(self.width - 50, origin.y), "black", 4, arrow=True))
        self.elements.append(self._line(Vec(origin.x, self.height - 40), Vec(origin.x, 50), "black", 4, arrow=True))
        self._text(c.get("x_label", "x"), Vec(self.width - 58, origin.y + 32), size=30)
        self._text(c.get("y_label", "y"), Vec(origin.x + 30, 66), size=30)

    def _render_curve(self, c: dict[str, Any]) -> None:
        shape = c.get("shape")
        if shape not in self.CURVE_SHAPES:
            raise VectorValidationError(f"Unknown curve shape: {shape}")
        axis = self.axes.get(c.get("coordinate_system"))
        if not axis:
            raise VectorValidationError(f"Missing coordinate system: {c.get('coordinate_system')}")
        domain = c.get("domain")
        if not (isinstance(domain, list) and len(domain) == 2):
            raise VectorValidationError("curve.domain must be [min, max]")
        x0, x1 = float(domain[0]), float(domain[1])
        if x0 >= x1:
            raise VectorValidationError("curve.domain must be increasing")
        params = c.get("parameters") or {}
        samples = 121
        parts: list[str] = []
        for i in range(samples):
            x = x0 + (x1 - x0) * i / (samples - 1)
            y = self._curve_y(shape, x, params)
            point = self._math_to_svg(axis, x, y)
            parts.append(("M" if i == 0 else "L") + f"{point.x:.2f},{point.y:.2f}")
        self.elements.append(
            f'<path d="{" ".join(parts)}" fill="none" stroke="black" stroke-width="6" '
            'stroke-linecap="round" stroke-linejoin="round"/>'
        )
        if c.get("label"):
            self._text(c["label"], self._math_to_svg(axis, x1 * 0.62, self._curve_y(shape, x1 * 0.62, params)) + Vec(28, -18), size=28)

    def _curve_y(self, shape: str, x: float, params: dict[str, Any]) -> float:
        if shape == "line":
            return float(params.get("m", 1)) * x + float(params.get("b", 0))
        if shape == "parabola":
            a = float(params.get("a", 1))
            h = float(params.get("h", 0))
            k = float(params.get("k", 0))
            return a * (x - h) ** 2 + k
        a = float(params.get("a", 1))
        b = float(params.get("b", 1))
        h = float(params.get("h", 0))
        k = float(params.get("k", 0))
        return max(-4.0, min(4.0, a * math.exp(b * (x - h)) + k))

    def _math_to_svg(self, axis: dict[str, Any], x: float, y: float) -> Vec:
        origin = axis["origin"]
        return Vec(origin.x + x * axis["x_scale"], origin.y - y * axis["y_scale"])

    def _render_surface(self, c: dict[str, Any]) -> None:
        shape = c.get("shape")
        if shape not in self.SURFACE_SHAPES:
            raise VectorValidationError(f"Unknown surface shape: {shape}")
        cid = c["id"]
        if shape == "floor":
            left = Vec(self.width * 0.15, self.height * 0.72)
            right = Vec(self.width * 0.85, self.height * 0.72)
        elif shape == "wall":
            left = Vec(self.width * 0.15, self.height * 0.72)
            right = Vec(self.width * 0.15, self.height * 0.25)
        else:
            angle = math.radians(float(c.get("angle_deg", 30)))
            left = Vec(self.width * 0.2, self.height * 0.72)
            run = self.width * 0.55
            right = Vec(left.x + run, left.y - math.tan(angle) * run)
        tangent = (right - left).unit()
        normal = Vec(-tangent.y, tangent.x).unit()
        if normal.y > 0:
            normal = normal * -1
        center = Vec((left.x + right.x) / 2, (left.y + right.y) / 2)
        geom = SurfaceGeometry(left=left, right=right, center=center, tangent=tangent, normal=normal)
        self.surfaces[cid] = geom
        self._register_anchors(cid, {"left": left, "right": right, "center": center})
        self.elements.append(self._line(left, right, "black", 5))
        if c.get("label"):
            self._text(c["label"], center + normal * 34, size=26)

    def _render_body(self, c: dict[str, Any]) -> None:
        shape = c.get("shape")
        if shape not in self.BODY_SHAPES:
            raise VectorValidationError(f"Unknown body shape: {shape}")
        cid = c["id"]
        size = self.SIZES.get(str(c.get("size", "medium")), self.SIZES["medium"])
        tangent = Vec(1, 0)
        normal = Vec(0, -1)
        center = Vec(self.width / 2, self.height / 2)
        surface_id = c.get("on")
        if surface_id:
            surface = self.surfaces.get(surface_id)
            if not surface:
                raise VectorValidationError(f"Missing surface: {surface_id}")
            tangent = surface.tangent
            normal = surface.normal
            center = surface.center + normal * (size * 0.38 + 4)

        if shape == "block":
            half_w = size * 0.58
            half_h = size * 0.34
            corners = [
                center - tangent * half_w - normal * half_h,
                center + tangent * half_w - normal * half_h,
                center + tangent * half_w + normal * half_h,
                center - tangent * half_w + normal * half_h,
            ]
            points = " ".join(f"{p.x:.1f},{p.y:.1f}" for p in corners)
            self.elements.append(f'<polygon points="{points}" fill="white" stroke="black" stroke-width="4"/>')
            anchors = {
                "center": center,
                "top": center + normal * half_h,
                "bottom": center - normal * half_h,
                "left": center - tangent * half_w,
                "right": center + tangent * half_w,
            }
        elif shape in {"sphere", "particle"}:
            radius = size * (0.34 if shape == "sphere" else 0.16)
            self.elements.append(f'<circle cx="{center.x:.1f}" cy="{center.y:.1f}" r="{radius:.1f}" fill="white" stroke="black" stroke-width="4"/>')
            anchors = {
                "center": center,
                "top": center + Vec(0, -radius),
                "bottom": center + Vec(0, radius),
                "left": center + Vec(-radius, 0),
                "right": center + Vec(radius, 0),
            }
        else:
            left = center - tangent * (size * 0.5)
            right = center + tangent * (size * 0.5)
            self.elements.append(self._line(left, right, "black", 5))
            anchors = {"center": center, "left": left, "right": right, "top": center + normal * 12, "bottom": center - normal * 12}
        self._register_anchors(cid, anchors)
        if c.get("label"):
            self._text(c["label"], center + Vec(0, 8), size=26, anchor="middle")

    def _render_vector(self, c: dict[str, Any]) -> None:
        kind = c.get("kind")
        if kind not in self.VECTOR_KINDS:
            raise VectorValidationError(f"Unknown vector kind: {kind}")
        start = self._resolve_anchor(c.get("target"))
        direction = self._vector_direction(c)
        length = self.LENGTHS.get(str(c.get("length", "medium")), self.LENGTHS["medium"])
        end = start + direction * length
        self.elements.append(self._line(start, end, "black", 5, arrow=True))
        if c.get("label"):
            self._text(c["label"], start + (end - start) * 0.55 + self._label_offset(direction), size=26)

    def _vector_direction(self, c: dict[str, Any]) -> Vec:
        direct = c.get("direction")
        if direct in {"up", "down", "left", "right"}:
            return {"up": Vec(0, -1), "down": Vec(0, 1), "left": Vec(-1, 0), "right": Vec(1, 0)}[direct]
        if "parallel_to" in c or direct == "parallel_to":
            sid = c.get("parallel_to") or c.get("surface")
            surface = self.surfaces.get(sid)
            if not surface:
                raise VectorValidationError(f"Missing surface for parallel vector: {sid}")
            return surface.tangent if c.get("sense") != "down_slope" else surface.tangent * -1
        if "perpendicular_to" in c or direct == "perpendicular_to":
            sid = c.get("perpendicular_to") or c.get("surface")
            surface = self.surfaces.get(sid)
            if not surface:
                raise VectorValidationError(f"Missing surface for perpendicular vector: {sid}")
            return surface.normal if c.get("side") != "inward" else surface.normal * -1
        raise VectorValidationError(f"Unknown vector direction: {direct}")

    def _render_label(self, c: dict[str, Any]) -> None:
        point = self._resolve_anchor(c.get("attach_to"))
        placement = c.get("placement", "center")
        if placement not in self.PLACEMENTS:
            raise VectorValidationError(f"Unknown label placement: {placement}")
        offsets = {
            "above": Vec(0, -32),
            "below": Vec(0, 42),
            "left": Vec(-42, 8),
            "right": Vec(42, 8),
            "center": Vec(0, 8),
        }
        self._text(c.get("text", ""), point + offsets[placement], size=28, anchor="middle")

    def _render_angle_arc(self, c: dict[str, Any]) -> None:
        between = c.get("between")
        if not (isinstance(between, list) and len(between) == 2 and between[1] == "horizontal"):
            raise VectorValidationError("V1 angle_arc supports [surface, horizontal]")
        surface = self.surfaces.get(between[0])
        if not surface:
            raise VectorValidationError(f"Missing surface for angle_arc: {between[0]}")
        center = surface.left
        radius = 58
        p0 = center + Vec(radius, 0)
        p1 = center + surface.tangent * radius
        self.elements.append(
            f'<path d="M{p0.x:.1f},{p0.y:.1f} A{radius},{radius} 0 0 0 {p1.x:.1f},{p1.y:.1f}" '
            'fill="none" stroke="black" stroke-width="3"/>'
        )
        if c.get("label"):
            self._text(c["label"], center + Vec(radius * 0.55, -radius * 0.2), size=24)

    def _render_dimension_line(self, c: dict[str, Any]) -> None:
        start = self._resolve_anchor(c.get("from"))
        end = self._resolve_anchor(c.get("to"))
        self.elements.append(self._line(start, end, "black", 3, arrow=True))
        if c.get("label"):
            self._text(c["label"], start + (end - start) * 0.5 + Vec(12, -12), size=24)

    def _render_connector(self, c: dict[str, Any]) -> None:
        kind = c.get("kind")
        if kind not in self.CONNECTOR_KINDS:
            raise VectorValidationError(f"Unknown connector kind: {kind}")
        start = self._resolve_anchor(c.get("from"))
        end = self._resolve_anchor(c.get("to"))
        if kind == "spring":
            self.elements.append(self._spring_path(start, end))
        else:
            self.elements.append(self._line(start, end, "black", 4))
        if c.get("label"):
            self._text(c["label"], start + (end - start) * 0.5 + Vec(0, -24), size=26, anchor="middle")

    def _render_trajectory(self, c: dict[str, Any]) -> None:
        shape = c.get("shape")
        if shape not in self.TRAJECTORY_SHAPES:
            raise VectorValidationError(f"Unknown trajectory shape: {shape}")
        start = self._resolve_anchor(c.get("from"))
        direction = c.get("direction", "up_right")
        if shape == "projectile":
            dx = 220 if direction.endswith("right") else -220
            end = start + Vec(dx, 80)
            control = start + Vec(dx * 0.45, -130)
            d = f"M{start.x:.1f},{start.y:.1f} Q{control.x:.1f},{control.y:.1f} {end.x:.1f},{end.y:.1f}"
        elif shape == "circular":
            d = f"M{start.x:.1f},{start.y:.1f} A80,80 0 1 1 {start.x + 1:.1f},{start.y:.1f}"
        else:
            end = start + Vec(180, -80 if shape == "straight" else 0)
            d = f"M{start.x:.1f},{start.y:.1f} L{end.x:.1f},{end.y:.1f}"
        self.elements.append(f'<path d="{d}" fill="none" stroke="black" stroke-width="4" stroke-dasharray="12 10" marker-end="url(#arrow)"/>')
        if c.get("label"):
            self._text(c["label"], start + Vec(110, -90), size=24)

    def _spring_path(self, start: Vec, end: Vec) -> str:
        delta = end - start
        tangent = delta.unit()
        normal = Vec(-tangent.y, tangent.x)
        turns = 8
        lead = 18
        points = [start, start + tangent * lead]
        length = math.hypot(delta.x, delta.y) - 2 * lead
        for i in range(1, turns + 1):
            base = start + tangent * (lead + length * i / (turns + 1))
            points.append(base + normal * (14 if i % 2 else -14))
        points.extend([end - tangent * lead, end])
        d = " ".join(("M" if i == 0 else "L") + f"{p.x:.1f},{p.y:.1f}" for i, p in enumerate(points))
        return f'<path d="{d}" fill="none" stroke="black" stroke-width="4" stroke-linejoin="round"/>'

    def _register_anchors(self, cid: str, anchors: dict[str, Vec]) -> None:
        for name, point in anchors.items():
            self.anchors[f"{cid}.{name}"] = point

    def _resolve_anchor(self, ref: Any) -> Vec:
        if not isinstance(ref, str) or ref not in self.anchors:
            raise VectorValidationError(f"Missing anchor: {ref}")
        return self.anchors[ref]

    def _line(self, start: Vec, end: Vec, color: str, width: float, arrow: bool = False) -> str:
        marker = ' marker-end="url(#arrow)"' if arrow else ""
        return (
            f'<line x1="{start.x:.1f}" y1="{start.y:.1f}" x2="{end.x:.1f}" y2="{end.y:.1f}" '
            f'stroke="{color}" stroke-width="{width}" stroke-linecap="round"{marker}/>'
        )

    def _text(self, text: Any, point: Vec, size: int = 24, anchor: str = "start") -> None:
        self.elements.append(
            f'<text x="{point.x:.1f}" y="{point.y:.1f}" font-family="Arial, sans-serif" '
            f'font-size="{size}" font-weight="600" text-anchor="{anchor}" fill="black">{escape(str(text))}</text>'
        )

    def _label_offset(self, direction: Vec) -> Vec:
        return Vec(14 if direction.x >= 0 else -44, -14 if direction.y >= 0 else -22)


def svg_to_png_bytes(svg: str) -> bytes:
    """
    Convert this prototype renderer's deterministic SVG subset to PNG.

    CairoSVG is not present in the repo and requires system libcairo on macOS.
    For the isolated prototype we keep this replaceable and render our own
    small safe subset with already-present OpenCV/numpy dependencies.
    """
    root = ET.fromstring(svg)
    width = int(float(root.attrib.get("width", "1024")))
    height = int(float(root.attrib.get("height", "768")))
    img = np.full((height, width, 3), 255, dtype=np.uint8)
    for el in root.iter():
        tag = el.tag.rsplit("}", 1)[-1]
        if tag == "line":
            p1 = (int(float(el.attrib["x1"])), int(float(el.attrib["y1"])))
            p2 = (int(float(el.attrib["x2"])), int(float(el.attrib["y2"])))
            cv2.line(img, p1, p2, (0, 0, 0), max(1, int(float(el.attrib.get("stroke-width", "1")))), cv2.LINE_AA)
        elif tag == "circle":
            center = (int(float(el.attrib["cx"])), int(float(el.attrib["cy"])))
            radius = int(float(el.attrib["r"]))
            cv2.circle(img, center, radius, (0, 0, 0), max(1, int(float(el.attrib.get("stroke-width", "1")))), cv2.LINE_AA)
        elif tag == "polygon":
            pts = np.array([
                [int(float(x)), int(float(y))]
                for x, y in (pair.split(",") for pair in el.attrib.get("points", "").split())
            ], dtype=np.int32)
            if len(pts) >= 2:
                cv2.polylines(img, [pts], True, (0, 0, 0), max(1, int(float(el.attrib.get("stroke-width", "1")))), cv2.LINE_AA)
        elif tag == "path":
            pts = _path_points_for_png(el.attrib.get("d", ""))
            if len(pts) >= 2:
                cv2.polylines(img, [np.array(pts, dtype=np.int32)], False, (0, 0, 0), max(1, int(float(el.attrib.get("stroke-width", "2")))), cv2.LINE_AA)
        elif tag == "text":
            text = "".join(el.itertext())
            x = int(float(el.attrib.get("x", "0")))
            y = int(float(el.attrib.get("y", "0")))
            cv2.putText(img, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (0, 0, 0), 2, cv2.LINE_AA)
    ok, encoded = cv2.imencode(".png", img)
    if not ok:
        raise RuntimeError("OpenCV failed to encode PNG")
    return encoded.tobytes()


def _path_points_for_png(d: str) -> list[tuple[int, int]]:
    nums = [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", d)]
    if not nums:
        return []
    # Good enough for this renderer's deterministic M/L/Q/A paths in tests:
    # draw through all coordinate-like pairs, ignoring SVG path flags/radii.
    points: list[tuple[int, int]] = []
    for i in range(0, len(nums) - 1, 2):
        points.append((int(nums[i]), int(nums[i + 1])))
    return points


def maybe_call_flux_structure_adapter(png_bytes: bytes, prompt: str) -> dict[str, Any] | None:
    """
    Optional prototype-only FLUX adapter.

    No production client exists in the repo. This function is intentionally tiny
    and skipped unless FLUX_STRUCTURE_API_URL is explicitly set.
    """
    url = os.getenv("FLUX_STRUCTURE_API_URL")
    if not url:
        return None
    payload = {
        "prompt": prompt,
        "image_base64": base64.b64encode(png_bytes).decode("ascii"),
        "strength": float(os.getenv("FLUX_STRUCTURE_STRENGTH", "0.18")),
        "control_mode": os.getenv("FLUX_STRUCTURE_CONTROL_MODE", "structure"),
    }
    headers: dict[str, str] = {}
    token = os.getenv("FLUX_API_KEY")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    response = requests.post(url, json=payload, headers=headers, timeout=120)
    response.raise_for_status()
    return response.json() if response.headers.get("content-type", "").startswith("application/json") else {"bytes": len(response.content)}


def math_graph_layout() -> dict[str, Any]:
    return {
        "type": "vector_layout",
        "schema_version": "0.1",
        "canvas": {"width": 1024, "height": 768, "background": "white"},
        "components": [
            {"id": "axes1", "type": "axis", "origin": "center", "x_label": "x", "y_label": "y", "show_grid": True},
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
        "canvas": {"width": 1024, "height": 768, "background": "white"},
        "components": [
            {"id": "incline1", "type": "surface", "shape": "incline", "angle_deg": 30, "label": "θ"},
            {"id": "block1", "type": "body", "shape": "block", "label": "m", "on": "incline1", "size": "medium"},
            {"id": "weight1", "type": "vector", "kind": "force", "target": "block1.center", "direction": "down", "label": "mg", "length": "medium"},
            {"id": "normal1", "type": "vector", "kind": "force", "target": "block1.center", "perpendicular_to": "incline1", "side": "outward", "label": "N", "length": "short"},
            {"id": "friction1", "type": "vector", "kind": "force", "target": "block1.center", "parallel_to": "incline1", "sense": "up_slope", "label": "f", "length": "short"},
            {"id": "theta1", "type": "angle_arc", "between": ["incline1", "horizontal"], "label": "θ"},
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
            {"id": "block1", "type": "body", "shape": "block", "label": "m", "on": "floor1", "size": "medium"},
            {"id": "spring1", "type": "connector", "kind": "spring", "from": "wall1.right", "to": "block1.left", "label": "k"},
            {"id": "disp1", "type": "vector", "kind": "force", "target": "block1.center", "direction": "right", "label": "x", "length": "short"},
        ],
    }


class VectorDslPrototypeTests(TestCase):
    layouts = {
        "math_graph": math_graph_layout,
        "free_body": free_body_layout,
        "spring_block": spring_block_layout,
    }

    def test_render_fixture_svgs(self) -> None:
        renderer = VectorRenderer()
        with tempfile.TemporaryDirectory(prefix="vector-dsl-") as tmp:
            for name, factory in self.layouts.items():
                svg = renderer.render(factory())
                self.assertTrue(svg.startswith("<svg"))
                self.assertIn('fill="white"', svg)
                self.assertRegex(svg, r"<(?:path|line) ")
                self.assertNotIn("<script", svg)
                self.assertNotIn("foreignObject", svg)
                self.assertNotIn("href=", svg)
                Path(tmp, f"{name}.svg").write_text(svg, encoding="utf-8")
            self.assertIn("y = x²", renderer.render(math_graph_layout()))
            self.assertIn("mg", renderer.render(free_body_layout()))
            self.assertIn("k", renderer.render(spring_block_layout()))

    def test_svg_to_png_bytes(self) -> None:
        renderer = VectorRenderer()
        for factory in self.layouts.values():
            png = svg_to_png_bytes(renderer.render(factory()))
            self.assertGreater(len(png), 100)
            self.assertEqual(png[:8], b"\x89PNG\r\n\x1a\n")

    def test_unknown_component_type_fails(self) -> None:
        layout = math_graph_layout()
        layout["components"].append({"id": "bad1", "type": "raw_svg_widget"})
        with self.assertRaises(VectorValidationError):
            VectorRenderer().render(layout)

    def test_unknown_curve_shape_fails(self) -> None:
        layout = math_graph_layout()
        layout["components"][1]["shape"] = "squiggle"
        with self.assertRaises(VectorValidationError):
            VectorRenderer().render(layout)

    def test_raw_svg_passthrough_fails(self) -> None:
        layout = math_graph_layout()
        layout["components"].append({"id": "raw1", "type": "label", "attach_to": "axes1.center", "text": "<svg><script/></svg>"})
        with self.assertRaises(VectorValidationError):
            VectorRenderer().render(layout)

    def test_missing_anchor_fails(self) -> None:
        layout = math_graph_layout()
        layout["components"].append({"id": "bad_label", "type": "math_label", "text": "F = ma", "attach_to": "missing.center", "placement": "above"})
        with self.assertRaises(VectorValidationError):
            VectorRenderer().render(layout)

    def test_model_point_arrays_fail(self) -> None:
        layout = math_graph_layout()
        layout["components"].append({"id": "bad_curve", "type": "curve", "shape": "line", "coordinate_system": "axes1", "domain": [0, 1], "points": [[0, 0], [1, 1]]})
        with self.assertRaises(VectorValidationError):
            VectorRenderer().render(layout)

    def test_optional_flux_adapter_skips_without_credentials(self) -> None:
        renderer = VectorRenderer()
        png = svg_to_png_bytes(renderer.render(math_graph_layout()))
        if not os.getenv("FLUX_STRUCTURE_API_URL"):
            self.assertIsNone(maybe_call_flux_structure_adapter(png, "Educational whiteboard illustration, clean black pencil sketch, preserve exact geometry, preserve all arrows, preserve all labels, no extra objects, no distorted text."))
            return
        result = maybe_call_flux_structure_adapter(png, "Educational whiteboard illustration, clean black pencil sketch, preserve exact geometry, preserve all arrows, preserve all labels, no extra objects, no distorted text.")
        self.assertIsInstance(result, dict)


class TaskDiagramPromptTests(TestCase):
    def test_task_diagram_context_detection(self) -> None:
        from ai_engine.image_enrichment import _is_task_diagram_context

        self.assertTrue(_is_task_diagram_context("Физика", "uniform cylinder with two threads"))
        self.assertTrue(_is_task_diagram_context("Механика", "block on incline with force arrows"))
        self.assertFalse(_is_task_diagram_context("Биология", "cell with nucleus and mitochondria"))

    def test_task_diagram_prompt_adds_school_flat_modifier(self) -> None:
        from ai_engine.image_enrichment import _build_final_prompt

        prompt = _build_final_prompt(
            "Subject / visual content to depict: uniform cylinder suspended by two vertical threads.",
            style="flat",
            palette="natural-earth",
            scene=True,
            task_diagram=True,
        )

        self.assertIn("TASK / PROBLEM DIAGRAM MODE", prompt)
        self.assertIn("classroom whiteboard", prompt)
        self.assertIn("pure black, dark slate, light grey, pure white", prompt)
        self.assertNotIn("clear water blue, nature green, earth brown", prompt)

    def test_regular_scene_does_not_get_task_diagram_modifier(self) -> None:
        from ai_engine.image_enrichment import _build_final_prompt

        prompt = _build_final_prompt(
            "Subject / visual content to depict: a forest ecosystem process.",
            style="flat",
            palette="natural-earth",
            scene=True,
            task_diagram=False,
        )

        self.assertNotIn("TASK / PROBLEM DIAGRAM MODE", prompt)
        self.assertIn("clear water blue, nature green, earth brown", prompt)


class ScientificFlatTextbookPromptTests(TestCase):
    def test_scientific_diagram_detection_and_style_routing(self) -> None:
        from ai_engine.image_enrichment import (
            _effective_style_key,
            _is_scientific_diagram_context,
        )

        self.assertTrue(
            _is_scientific_diagram_context(
                "Draw a block on an inclined plane with gravity, normal force, friction, and angle theta."
            )
        )
        self.assertTrue(_is_scientific_diagram_context("Explain and draw the water cycle in nature."))
        self.assertFalse(_is_scientific_diagram_context("Draw a cozy fantasy castle."))
        self.assertEqual(
            _effective_style_key("flat", scientific_diagram=True),
            "scientific_flat_textbook",
        )
        self.assertEqual(
            _effective_style_key("sketch", scientific_diagram=True),
            "sketch",
        )

    def test_inclined_plane_prompt_uses_flat_textbook_style(self) -> None:
        from ai_engine.image_enrichment import _build_final_prompt

        prompt = _build_final_prompt(
            (
                "Subject / visual content to depict: block on an inclined plane with "
                "gravity, normal force, friction and angle theta."
            ),
            style="flat",
            palette="natural-earth",
            scene=True,
            scientific_diagram=True,
        )

        self.assertIn("Clean flat vector educational textbook diagram", prompt)
        self.assertIn("educational textbook", prompt)
        self.assertIn("white background", prompt)
        self.assertIn("muted blue", prompt)
        self.assertIn("light gray", prompt)
        self.assertIn("crisp dark blue-gray outlines", prompt)
        self.assertIn("photorealistic", prompt)
        self.assertIn("dark background", prompt)
        self.assertIn("rough pencil sketch", prompt)
        self.assertIn("glow behind text", prompt)

    def test_cylinder_unwinding_prompt_preserves_required_content(self) -> None:
        from ai_engine.image_enrichment import _build_final_prompt

        prompt = _build_final_prompt(
            (
                "Subject / visual content to depict: fixed support, two vertical "
                "threads, uniform cylinder, descent arrow, rotation arrows and "
                "initial position guide."
            ),
            style="flat",
            palette="natural-earth",
            scene=True,
            scientific_diagram=True,
        )

        self.assertIn("fixed support", prompt)
        self.assertIn("threads", prompt)
        self.assertIn("uniform cylinder", prompt)
        self.assertIn("descent arrow", prompt)
        self.assertIn("rotation arrows", prompt)
        self.assertIn("initial position", prompt)
        self.assertIn("clean flat vector educational textbook", prompt.lower())

    def test_water_cycle_prompt_uses_flat_educational_diagram_language(self) -> None:
        from ai_engine.image_enrichment import _build_final_prompt

        prompt = _build_final_prompt(
            "Subject / visual content to depict: explain and draw the water cycle in nature.",
            style="flat",
            palette="natural-earth",
            scene=True,
            scientific_diagram=True,
        )

        self.assertIn("flat vector educational textbook diagram", prompt)
        self.assertIn("white or very light background", prompt)
        self.assertIn("Arrows must point exactly", prompt)
        self.assertIn("readable labels", prompt)
        self.assertIn("minimal clutter", prompt)
        self.assertIn("polished infographic quality", prompt)


class DrawContextHygieneTests(TestCase):
    def test_new_topic_omits_old_chat_history(self) -> None:
        from ai_engine.draw_views import _history_for_model, _needs_chat_history

        self.assertFalse(_needs_chat_history("Нарисуй схему наклонной плоскости с блоком"))
        history = [
            {"role": "user", "content": "Нарисуй цилиндр с нитями"},
            {"role": "assistant", "content": "Готово, это цилиндр."},
        ]
        self.assertEqual(_history_for_model(history, "Нарисуй клетку с ядром"), [])

    def test_followup_keeps_short_recent_history(self) -> None:
        from ai_engine.draw_views import _history_for_model, _needs_chat_history

        self.assertTrue(_needs_chat_history("сделай это скетчем"))
        history = [
            {"role": "user", "content": "Нарисуй цилиндр с нитями"},
            {"role": "assistant", "content": "Готово, это цилиндр."},
        ]
        self.assertEqual(len(_history_for_model(history, "сделай это скетчем")), 2)
