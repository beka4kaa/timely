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
from django.test import SimpleTestCase, TestCase


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
        self.assertIn("deep ocean blue, sky blue, pure white, cool grey", prompt)
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

    def test_inclined_plane_prompt_enforces_exact_topology_and_forces(self) -> None:
        from ai_engine.image_enrichment import _build_final_prompt

        prompt = _build_final_prompt(
            (
                "Subject / visual content to depict: exactly one block on an inclined "
                "plane with gravity, normal force, friction and an angle arc."
            ),
            style="flat",
            palette="natural-earth",
            scene=True,
            task_diagram=True,
            scientific_diagram=True,
        )

        self.assertIn("MECHANICS TOPOLOGY CONTRACT", prompt)
        self.assertIn("INCLINED PLANE EXACT TOPOLOGY", prompt)
        self.assertIn("exactly ONE block and exactly ONE continuous inclined surface", prompt)
        self.assertIn("no force arrow may terminate at the body center", prompt)
        self.assertIn("no double-headed arrows", prompt)
        self.assertIn("second parallel", prompt)
        self.assertIn("callout arrows aimed into the center", prompt)

    def test_text_free_guard_is_the_last_instruction(self) -> None:
        """Короткая директива запрета текста должна стоять В САМОМ КОНЦЕ.

        На длинном промпте image-модель «топит» запреты в середине и всё равно
        печатает псевдо-подписи; терминальная фраза это перебивает.
        """
        from unittest.mock import patch

        from ai_engine.image_enrichment import TEXT_FREE_TERMINAL, _build_final_prompt

        with patch("ai_engine.image_enrichment._MODEL", "bytedance-seed/seedream-4.5"):
            prompt = _build_final_prompt(
                "Subject / visual content to depict: a block on an inclined plane.",
                style="flat",
                palette="natural-earth",
                scientific_diagram=True,
            )

        self.assertTrue(prompt.endswith(TEXT_FREE_TERMINAL))

    def test_image_only_models_never_request_text_modality(self) -> None:
        """Регрессия: Seedream — чисто image-модель. Если она не попадёт в
        `_is_image_only_model`, запрос уйдёт с modalities ["image", "text"] и
        провайдер ответит 404 "No endpoints found that support the requested
        output modalities" — то есть генерация сломается целиком."""
        from ai_engine.image_enrichment import _modalities_for

        self.assertEqual(_modalities_for("bytedance-seed/seedream-4.5"), ["image"])

        # Gemini-image возвращает и картинку, и текст — полный список остаётся.
        self.assertEqual(
            _modalities_for("google/gemini-3-pro-image"), ["image", "text"]
        )

    def test_explicit_sketch_keeps_mechanics_contract_without_flat_style(self) -> None:
        from ai_engine.image_enrichment import _build_final_prompt

        prompt = _build_final_prompt(
            "Subject / visual content to depict: one block on an inclined plane with force arrows.",
            style="sketch",
            palette="natural-earth",
            scientific_diagram=True,
            explicit_style_override=True,
        )

        self.assertIn("STRICTLY MONOCHROME hand-drawn black ink pen", prompt)
        self.assertIn("MECHANICS TOPOLOGY CONTRACT", prompt)
        self.assertIn("INCLINED PLANE EXACT TOPOLOGY", prompt)
        self.assertNotIn("Clean flat vector educational textbook diagram", prompt)

    def test_enrichment_keeps_scientific_topology_during_style_override(self) -> None:
        from unittest.mock import patch

        from ai_engine.image_enrichment import _enrich_command

        command = {
            "type": "image_with_labels",
            "image_prompt": "one block on an inclined plane with gravity and normal force",
            "requires_segmentation": False,
            "labels": [],
        }
        with patch(
            "ai_engine.illustration_pipeline.build_vector_illustration",
            return_value={"base_image_url": "data:image/png;base64,AA==", "labels": []},
        ) as build:
            enriched = _enrich_command(command, style="sketch")

        self.assertTrue(build.call_args.kwargs["scientific_diagram"])
        self.assertTrue(build.call_args.kwargs["explicit_style_override"])
        self.assertFalse(build.call_args.kwargs["task_diagram"])
        self.assertEqual(enriched["gen_style"], "sketch")

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
        self.assertIn("minimal clutter", prompt)
        self.assertIn("polished infographic quality", prompt)

    def test_prompt_never_asks_for_labels_in_positive_voice(self) -> None:
        """Позитивные упоминания подписей заставляют модель их рисовать.

        Регрессия из прода: в промпте было «clean labeled arrows … readable
        scientific labels reserved for the deterministic overlay layer» и
        «keep text areas clean and simple for readable labels». Оговорку про
        overlay диффузионная модель не понимает — она видит «читаемые научные
        подписи» и впечатывает псевдо-текст в картинку («Ruterrflord's Gold
        Foil Experiment», «Ineniger Exs»), поверх которого потом ложатся
        настоящие подписи. Запреты («no text», «do not draw labels») оставлять
        МОЖНО — вредны именно утвердительные формулировки.
        """
        from ai_engine.image_enrichment import _build_final_prompt

        forbidden = ("readable labels", "labeled arrows", "readable scientific labels")
        for scientific, task in ((True, True), (True, False), (False, False)):
            prompt = _build_final_prompt(
                "Subject / visual content to depict: a block on an inclined plane.",
                style="flat",
                palette="monochrome-ink",
                scientific_diagram=scientific,
                task_diagram=task,
            )
            for phrase in forbidden:
                self.assertNotIn(
                    phrase,
                    prompt,
                    f"позитивное упоминание подписей {phrase!r} вернулось в промпт "
                    f"(scientific={scientific}, task={task})",
                )


class ExtractJsonLatexEscapeTests(TestCase):
    """Разбор ответа модели, когда в подписях LaTeX.

    Реальный баг: board-DSL просит подписи вида «$30^\\circ$», модель пишет
    бэкслеш ОДИНАРНЫМ, и json.loads падает на «Invalid \\escape». Разбор всего
    ответа возвращал None, скилл уходил в ветку «модель не выдала JSON», и
    пользователь получал в чате простыню сырого JSON вместо доски.
    """

    def test_single_backslash_latex_still_parses(self) -> None:
        from ai_engine.draw_views import _extract_json

        raw = r'{"reply": "ок", "topic": "Угол наклона $30^\circ$"}'
        parsed = _extract_json(raw)

        self.assertIsInstance(parsed, dict)
        self.assertEqual(parsed["topic"], r"Угол наклона $30^\circ$")

    def test_common_latex_commands_survive(self) -> None:
        from ai_engine.draw_views import _extract_json

        for latex in (r"$\vec{F}$", r"$\frac{1}{2}$", r"$\alpha$", r"$\upsilon$", r"$\theta$"):
            with self.subTest(latex=latex):
                parsed = _extract_json('{"content": "%s"}' % latex)
                self.assertIsInstance(parsed, dict)
                self.assertEqual(parsed["content"], latex)

    def test_valid_escapes_are_not_mangled(self) -> None:
        """Починка не должна ломать корректный JSON: \\n остаётся переводом
        строки, \\uXXXX — символом, а не превращается в литеральный текст."""
        from ai_engine.draw_views import _extract_json

        parsed = _extract_json(r'{"a": "line1\nline2", "b": "АБ", "c": "path\\to", "d": "q\"q"}')

        self.assertEqual(parsed["a"], "line1\nline2")
        self.assertEqual(parsed["b"], "АБ")
        self.assertEqual(parsed["c"], "path\\to")
        self.assertEqual(parsed["d"], 'q"q')

    def test_fenced_json_with_latex_parses(self) -> None:
        from ai_engine.draw_views import _extract_json

        raw = '```json\n{"reply": "ок", "topic": "$30^\\circ$"}\n```'
        self.assertIsInstance(_extract_json(raw), dict)

    def test_still_returns_none_for_non_json(self) -> None:
        from ai_engine.draw_views import _extract_json

        self.assertIsNone(_extract_json("Просто текстовый ответ без JSON."))
        self.assertIsNone(_extract_json(""))

    def test_full_board_payload_with_latex_labels(self) -> None:
        """Форма, на которой это реально сломалось: доска с image_with_labels,
        где среди подписей есть «Угол наклона $30^\\circ$»."""
        from ai_engine.draw_views import _extract_json, _sanitize_board_data

        raw = (
            '{"reply": "ок", "intent": "new", "subject": "Физика",'
            ' "topic": "Наклонная плоскость", "board_steps": [{"step_number": 1,'
            ' "title": "Силы", "commands": [{"type": "image_with_labels",'
            ' "image_prompt": "a block on an incline", "labels": ['
            r'{"content": "Вес $mg$", "x": 50, "y": 50},'
            r'{"content": "Угол наклона $30^\circ$", "x": 20, "y": 20}'
            "]}]}]}"
        )
        parsed = _extract_json(raw)
        self.assertIsInstance(parsed, dict)

        board = _sanitize_board_data(parsed)
        commands = board["board_steps"][0]["commands"]
        labels = [
            label["content"]
            for command in commands
            if command.get("type") == "image_with_labels"
            for label in command.get("labels") or []
        ]
        self.assertIn(r"Угол наклона $30^\circ$", labels)


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

    def test_label_target_kind_is_sanitized(self) -> None:
        from ai_engine.draw_views import _sanitize_command

        command = {
            "type": "image_with_labels",
            "image_prompt": "one block with one downward force arrow",
            "labels": [
                {
                    "content": "$mg$",
                    "target_kind": "VECTOR",
                    "x": 50,
                    "y": 40,
                    "arrow_to": {"x": 50, "y": 55},
                },
                {
                    "content": "Брусок",
                    "target_kind": "raw_svg",
                    "x": 50,
                    "y": 50,
                },
            ],
        }

        sanitized = _sanitize_command(command)
        self.assertEqual(sanitized["labels"][0]["target_kind"], "vector")
        self.assertNotIn("target_kind", sanitized["labels"][1])


class SemanticLabelGroundingTests(TestCase):
    def test_vector_label_targets_arrow_shaft_not_body_center(self) -> None:
        from unittest.mock import patch

        from ai_engine.illustration_pipeline import _ground_labels_with_vision

        captured: dict[str, str] = {}

        def fake_vision_chat(_url, _key, _model, prompt, _image, _timeout):
            captured["prompt"] = prompt
            return '[{"name":"Сила тяжести mg","x":62,"y":58}]'

        labels = [
            {
                "content": "Сила тяжести mg",
                "target_kind": "vector",
                "x": 50.0,
                "y": 40.0,
                "arrow_to": {"x": 50.0, "y": 50.0},
            }
        ]
        image = np.full((120, 200, 3), 255, np.uint8)
        with (
            patch("ai_engine.illustration_pipeline._GROUNDING_USE_GRID", False),
            patch("ai_engine.illustration_pipeline._vision_chat", side_effect=fake_vision_chat),
        ):
            grounded = _ground_labels_with_vision(image, labels, "брусок на плоскости")

        self.assertIn("середина ДРЕВКА", captured["prompt"])
        self.assertIn("не центр тела", captured["prompt"])
        self.assertIn("target_kind=vector", captured["prompt"])
        self.assertEqual(grounded[0]["target_kind"], "vector")
        self.assertEqual(grounded[0]["arrow_to"], {"x": 62.0, "y": 58.0})


class LabelTargetKindInferenceTests(TestCase):
    """`target_kind` должен проставляться и БЕЗ vision-грунтинга.

    Регрессия: эвристика жила внутри `_ground_labels_with_vision`, а при
    рестайле грунтинг пропускается (`skip_grounding=True`). Из-за этого подписи
    сил приходили в `layout_labels_on_margins` как `object`, а он выносит
    object на поля — «mg» уезжала от своей стрелки на край кадра.
    """

    def test_force_labels_are_classified_as_vectors(self) -> None:
        from ai_engine.illustration_pipeline import infer_label_target_kind

        for content in ("mg", "T", "N", "сила тяжести", "натяжение", "tension"):
            with self.subTest(content=content):
                self.assertEqual(
                    infer_label_target_kind({"content": content}), "vector"
                )

    def test_angle_and_object_labels(self) -> None:
        from ai_engine.illustration_pipeline import infer_label_target_kind

        self.assertEqual(infer_label_target_kind({"content": "θ"}), "angle")
        self.assertEqual(infer_label_target_kind({"content": "30°"}), "angle")
        self.assertEqual(infer_label_target_kind({"content": "Груз"}), "object")
        self.assertEqual(infer_label_target_kind({"content": "Блок"}), "object")

    def test_explicit_target_kind_wins(self) -> None:
        from ai_engine.illustration_pipeline import infer_label_target_kind

        # Явное указание модели уважаем: она видит сцену, а мы только текст.
        self.assertEqual(
            infer_label_target_kind({"content": "mg", "target_kind": "object"}),
            "object",
        )

    def test_apply_does_not_mutate_input(self) -> None:
        from ai_engine.illustration_pipeline import apply_label_target_kinds

        labels = [{"content": "mg"}]
        result = apply_label_target_kinds(labels)

        self.assertEqual(result[0]["target_kind"], "vector")
        self.assertNotIn("target_kind", labels[0])

    def test_force_label_stays_local_after_restyle_layout(self) -> None:
        """Сквозная проверка мотивации: с проставленным kind раскладка не
        уносит силу на поля."""
        from ai_engine.illustration_pipeline import apply_label_target_kinds
        from ai_engine.label_layout import layout_labels_on_margins

        img = LabelMarginLayoutTests._frame(35, 65)
        anchor = {"x": 52.0, "y": 48.0}
        labels = apply_label_target_kinds(
            [{"content": "mg", "x": 52.0, "y": 41.0, "arrow_to": anchor}]
        )

        result = layout_labels_on_margins(img, labels)[0]

        # vector/angle раскладка не трогает — подпись осталась у своей стрелки.
        self.assertLess(abs(result["x"] - 52.0), 1.0)
        self.assertLess(abs(result["y"] - 41.0), 1.0)


class LabelMarginLayoutTests(TestCase):
    """Раскладка подписей по спокойным зонам (ai_engine.label_layout).

    Мотивация: раньше текст ставился вслепую на 7% выше объекта, попадал на
    саму иллюстрацию, и фронтенд рисовал под ним белый ореол-подложку. Тесты
    синтетические — без сети и без обращений к моделям.
    """

    @staticmethod
    def _frame(content_x0: float, content_x1: float, w: int = 640, h: int = 360):
        """Белый кадр с чёрным блоком содержимого в диапазоне X (в процентах)."""
        import cv2
        import numpy as np

        img = np.full((h, w, 3), 245, np.uint8)
        cv2.rectangle(
            img,
            (int(w * content_x0 / 100), int(h * 0.25)),
            (int(w * content_x1 / 100), int(h * 0.75)),
            (20, 20, 20),
            -1,
        )
        return img

    def test_text_moves_off_the_object_onto_quiet_background(self) -> None:
        from ai_engine.label_layout import _BusynessMap, _label_box_pct, layout_labels_on_margins

        img = self._frame(35, 65)
        labels = [{"content": "Ядро", "arrow_to": {"x": 50.0, "y": 50.0}}]
        result = layout_labels_on_margins(img, labels)[0]

        # Текст обязан уехать с объекта на чистый фон.
        busy = _BusynessMap(img)
        bw, bh = _label_box_pct(result["content"])
        self.assertLess(busy.std(result["x"], result["y"], bw, bh), 0.05)
        # arrow_to не трогаем — выноска должна по-прежнему указывать на объект.
        self.assertEqual(result["arrow_to"], {"x": 50.0, "y": 50.0})

    def test_label_stays_fully_inside_canvas(self) -> None:
        """Координата — ЦЕНТР текста, поэтому у края половина может уехать."""
        from ai_engine.label_layout import _label_box_pct, layout_labels_on_margins

        img = self._frame(40, 60)
        labels = [{"content": "Очень длинная подпись объекта", "arrow_to": {"x": 50.0, "y": 30.0}}]
        result = layout_labels_on_margins(img, labels)[0]

        bw, _bh = _label_box_pct(result["content"])
        self.assertGreaterEqual(result["x"] - bw / 2, 0.0)
        self.assertLessEqual(result["x"] + bw / 2, 100.0)

    def test_leader_line_does_not_cross_the_frame(self) -> None:
        """Подпись остаётся на стороне своего объекта."""
        from ai_engine.label_layout import layout_labels_on_margins

        img = self._frame(30, 70)
        labels = [
            {"content": "Слева", "arrow_to": {"x": 34.0, "y": 40.0}},
            {"content": "Справа", "arrow_to": {"x": 66.0, "y": 60.0}},
        ]
        for lb in layout_labels_on_margins(img, labels):
            self.assertEqual(
                lb["x"] < 50.0,
                lb["arrow_to"]["x"] < 50.0,
                f"подпись {lb['content']!r} уехала через середину кадра",
            )

    def test_labels_do_not_overlap_each_other(self) -> None:
        from ai_engine.label_layout import _label_box_pct, layout_labels_on_margins

        img = self._frame(45, 55)
        labels = [{"content": f"Подпись {i}", "arrow_to": {"x": 50.0, "y": 50.0}} for i in range(5)]
        placed = layout_labels_on_margins(img, labels)

        boxes = [(lb["x"], lb["y"], *_label_box_pct(lb["content"])) for lb in placed]
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                ax, ay, aw, ah = boxes[i]
                bx, by, bw, bh = boxes[j]
                overlap = abs(ax - bx) * 2 < (aw + bw) and abs(ay - by) * 2 < (ah + bh)
                self.assertFalse(overlap, f"подписи {i} и {j} наехали друг на друга")

    def test_labels_without_arrow_to_are_untouched(self) -> None:
        """Без грунтинга объекта двигать подпись наугад хуже, чем оставить."""
        from ai_engine.label_layout import layout_labels_on_margins

        img = self._frame(30, 70)
        labels = [{"content": "Свободная", "x": 12.0, "y": 88.0}]
        self.assertEqual(layout_labels_on_margins(img, labels), labels)

    def test_vector_and_angle_labels_stay_local(self) -> None:
        from ai_engine.label_layout import layout_labels_on_margins

        img = self._frame(30, 70)
        labels = [
            {
                "content": "$mg$",
                "target_kind": "vector",
                "x": 52.0,
                "y": 44.0,
                "arrow_to": {"x": 52.0, "y": 50.0},
            },
            {
                "content": "$\\theta$",
                "target_kind": "angle",
                "x": 24.0,
                "y": 74.0,
                "arrow_to": {"x": 22.0, "y": 78.0},
            },
        ]

        self.assertEqual(layout_labels_on_margins(img, labels), labels)

    def test_full_bleed_scene_still_finds_quiet_zones(self) -> None:
        """Полнокадровая сцена: фоновых полей нет, но спокойные зоны есть.

        Регрессия: первая версия искала пиксели цвета рамки и на пейзаже
        получала поля 0% — раскладка не срабатывала вообще.
        """
        import cv2
        import numpy as np

        from ai_engine.label_layout import _BusynessMap, _label_box_pct, layout_labels_on_margins

        h, w = 360, 640
        img = np.zeros((h, w, 3), np.uint8)
        img[: int(h * 0.5), :, :] = (220, 200, 170)          # ровное «небо»
        img[int(h * 0.5) :, :, :] = (120, 160, 90)           # ровная «земля»
        for x in range(int(w * 0.4), int(w * 0.6), 4):       # пёстрая деталь в центре
            cv2.line(img, (x, int(h * 0.3)), (x, int(h * 0.8)), (10, 10, 10), 2)

        labels = [{"content": "Объект", "arrow_to": {"x": 50.0, "y": 55.0}}]
        result = layout_labels_on_margins(img, labels)[0]

        self.assertIn("x", result)
        busy = _BusynessMap(img)
        bw, bh = _label_box_pct(result["content"])
        self.assertLess(busy.std(result["x"], result["y"], bw, bh), 0.05)


class ClarifySkillTests(TestCase):
    """Скилл уточняющего вопроса (ai_engine.skills.clarify)."""

    def _run(self, **kwargs):
        from ai_engine.skills.clarify import ClarifySkill

        return ClarifySkill().run(user_message="", history=[], **kwargs)

    def test_first_option_is_marked_recommended(self) -> None:
        result = self._run(
            question="На какое тело?",
            options=[{"label": "Автомобиль"}, {"label": "Падающий мяч"}],
        )
        options = result.meta["clarify"]["options"]
        self.assertTrue(options[0]["recommended"])
        self.assertNotIn("recommended", options[1])
        self.assertEqual(result.skill, "ask_clarification")

    def test_model_supplied_other_option_is_dropped(self) -> None:
        """Интерфейс сам рисует «Другое — напишу сам».

        Модель всё равно иногда дописывает такой пункт (наблюдалось вживую), и
        рядом с кнопкой интерфейса дубликат выглядит багом.
        """
        result = self._run(
            question="На какое тело?",
            options=[
                {"label": "Автомобиль"},
                {"label": "Падающий мяч"},
                {"label": "Другое", "description": "Укажу свою ситуацию"},
                {"label": "Свой вариант"},
            ],
        )
        labels = [o["label"] for o in result.meta["clarify"]["options"]]
        self.assertEqual(labels, ["Автомобиль", "Падающий мяч"])

    def test_real_options_are_not_mistaken_for_other(self) -> None:
        """Фильтр «Другое» не должен съедать настоящие варианты."""
        from ai_engine.skills.clarify import _is_other_option

        for label in ("Самолёт", "Иномарка", "Свободное падение", "Наклонная плоскость"):
            self.assertFalse(_is_other_option(label), f"{label!r} ошибочно принят за «Другое»")

    def test_options_are_capped(self) -> None:
        from ai_engine.skills.clarify import MAX_OPTIONS

        result = self._run(
            question="Что рисуем?",
            options=[{"label": f"Вариант {i}"} for i in range(10)],
        )
        self.assertLessEqual(len(result.meta["clarify"]["options"]), MAX_OPTIONS)

    def test_degenerate_question_falls_back_to_plain_chat(self) -> None:
        """Вопрос без выбора бесполезен — отдаём его обычной репликой."""
        result = self._run(question="Что именно нужно?", options=[{"label": "Единственный"}])
        self.assertEqual(result.skill, "chat")
        self.assertNotIn("clarify", result.meta)
        self.assertIn("Что именно нужно", result.reply)

    def test_clarification_tool_is_exposed_to_the_model(self) -> None:
        from ai_engine.skills.router import ROUTABLE_TOOLS

        names = [t["function"]["name"] for t in ROUTABLE_TOOLS]
        self.assertIn("ask_clarification", names)
        self.assertIn("draw_board", names)


class VectorRendererGeometryTests(TestCase):
    """Числовая проверка направлений сил (ai_engine.vector_renderer).

    Регрессия из прода: векторы, привязанные к поверхности, рисовались
    горизонтально и ровно друг на друге. Причина была двойная —
    `_render_vector` передавал в `_direction` только `comp["direction"]`
    (то есть None, ключи привязки лежат на верхнем уровне), а формулы для
    perpendicular_to/parallel_to были зеркальны по знаку. Глазами такое
    легко пропустить, поэтому проверяем углы арифметикой.
    """

    @staticmethod
    def _arrow_angles(angle_deg: float) -> list[float]:
        """Углы всех векторов со стрелкой в математической системе (y вверх)."""
        import math as _math
        import re as _re

        from ai_engine.vector_renderer import VectorRenderer

        layout = {
            "type": "vector_layout",
            "schema_version": "0.1",
            "canvas": {"width": 800, "height": 500, "background": "white"},
            "components": [
                {"id": "i", "type": "surface", "shape": "incline", "angle_deg": angle_deg},
                {"id": "b", "type": "body", "shape": "block", "on": "i", "size": "medium"},
                {"id": "w", "type": "vector", "kind": "force", "target": "b.center",
                 "direction": "down", "label": "mg", "length": "medium"},
                {"id": "n", "type": "vector", "kind": "force", "target": "b.center",
                 "perpendicular_to": "i", "side": "outward", "label": "N", "length": "short"},
                {"id": "f", "type": "vector", "kind": "force", "target": "b.center",
                 "parallel_to": "i", "sense": "up_slope", "label": "F", "length": "short"},
            ],
        }
        svg = VectorRenderer().render(layout)
        angles = []
        for x1, y1, x2, y2 in _re.findall(
            r'<line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)"[^>]*marker-end', svg
        ):
            dx, dy = float(x2) - float(x1), float(y2) - float(y1)
            angles.append(_math.degrees(_math.atan2(-dy, dx)))
        return angles

    def _assert_angle(self, actual: float, expected: float, name: str) -> None:
        delta = abs(((actual - expected + 180) % 360) - 180)
        self.assertLess(delta, 0.5, f"{name}: получено {actual:.1f}°, ожидалось {expected:.1f}°")

    def test_forces_point_in_physically_correct_directions(self) -> None:
        for incline in (20.0, 30.0, 45.0):
            with self.subTest(incline=incline):
                mg, normal, friction = self._arrow_angles(incline)
                # Тяжесть всегда строго вниз, независимо от наклона.
                self._assert_angle(mg, -90.0, "mg")
                # Внешняя нормаль перпендикулярна склону: 90° + угол склона.
                self._assert_angle(normal, 90.0 + incline, "N")
                # Трение вверх по склону — вдоль поверхности.
                self._assert_angle(friction, incline, "Fтр")

    def test_normal_is_perpendicular_to_friction(self) -> None:
        """Инвариант, не зависящий от системы координат."""
        _mg, normal, friction = self._arrow_angles(30.0)
        delta = abs(((normal - friction + 180) % 360) - 180)
        self.assertAlmostEqual(delta, 90.0, delta=0.5)

    def test_surface_bound_vectors_are_not_collapsed_to_horizontal(self) -> None:
        """Прямая защита от исходного бага: N и Fтр не совпадают и не горизонтальны."""
        _mg, normal, friction = self._arrow_angles(30.0)
        self.assertNotAlmostEqual(normal, friction, delta=1.0)
        for name, angle in (("N", normal), ("Fтр", friction)):
            self.assertGreater(
                abs(((angle + 180) % 360) - 180), 1.0,
                f"{name} схлопнулся в горизонталь — вернулся запасной Vec(1, 0)",
            )


class FollowUpContextTests(TestCase):
    """Короткие команды-продолжения не должны терять тему разговора.

    Регрессия из прода: после объяснения первого закона Ньютона запрос
    «нарисуй мне» уходил в модель БЕЗ истории и БЕЗ темы от роутера — она
    сочиняла случайный сюжет и выдала куб с подписями «Верхняя грань» /
    «Правая грань» вместо схемы по инерции.
    """

    def test_bare_draw_commands_keep_chat_history(self) -> None:
        from ai_engine.draw_views import _needs_chat_history

        for text in (
            "нарисуй мне",
            "нарисуй",
            "покажи схему",
            "а теперь нарисуй",
            "построй",
            "draw me",
        ):
            self.assertTrue(
                _needs_chat_history(text),
                f"{text!r} — команда без предмета, историю выбрасывать нельзя",
            )

    def test_self_contained_requests_stay_clean(self) -> None:
        """Полноценная задача не должна тянуть контекст прошлой темы."""
        from ai_engine.draw_views import _needs_chat_history

        for text in (
            "Нарисуй брусок на наклонной плоскости 30 градусов",
            "Построй график функции y = x^2 - 4x + 3",
            "Изобрази строение растительной клетки",
        ):
            self.assertFalse(
                _needs_chat_history(text),
                f"{text!r} — самостоятельная задача, старый контекст ей вреден",
            )

    def test_router_topic_replaces_bare_command(self) -> None:
        """Тема от роутера подставляется вместо бессодержательной команды.

        Роутер видит историю и разрешает ссылку («нарисуй мне» → «Первый закон
        Ньютона…»), но раньше BoardSkill этот аргумент игнорировал.
        """
        from unittest.mock import patch

        from ai_engine.skills.board import BoardSkill

        topic = "Первый закон Ньютона (закон инерции) — тела в покое и движении"
        captured: dict = {}

        def fake_create(**kwargs):
            captured["messages"] = kwargs["messages"]
            raise RuntimeError("stop after capturing the prompt")

        with patch("ai_engine.skills.board.openrouter_client") as client:
            client.chat.completions.create.side_effect = fake_create
            with self.assertRaises(RuntimeError):
                BoardSkill().run(user_message="нарисуй мне", history=[], topic=topic)

        sent = captured["messages"][-1]["content"]
        self.assertIn("Первый закон Ньютона", sent)

    def test_detailed_request_is_not_overwritten_by_topic(self) -> None:
        """Содержательный запрос ведёт; тема роутера идёт лишь уточнением."""
        from unittest.mock import patch

        from ai_engine.skills.board import BoardSkill

        message = "Нарисуй брусок на наклонной плоскости 30 градусов со всеми силами"
        captured: dict = {}

        def fake_create(**kwargs):
            captured["messages"] = kwargs["messages"]
            raise RuntimeError("stop")

        with patch("ai_engine.skills.board.openrouter_client") as client:
            client.chat.completions.create.side_effect = fake_create
            with self.assertRaises(RuntimeError):
                BoardSkill().run(user_message=message, history=[], topic="схема сил")

        sent = captured["messages"][-1]["content"]
        self.assertIn("наклонной плоскости", sent)


class StyleCommandTests(TestCase):
    """Текстовые команды смены стиля («do sketch», «в 3d»).

    Регрессия из прода: фронтенд шлёт `style` из выпадашки, а не из текста, и
    напечатанное «do sketch» не меняло НИЧЕГО — картинка перерисовывалась в
    прежнем стиле. Плюс роутер отвечал на такое обычным текстом, не вызывая
    отрисовку вообще.
    """

    def test_style_commands_are_recognised(self) -> None:
        from ai_engine.draw_views import style_from_message

        cases = {
            "do sketch": "sketch",
            "сделай скетчем": "sketch",
            "в 3d тоже самое": "3d",
            "do it flat style same task": "flat",
            "сделай изометрию": "2_5d",
            "перерисуй в 2.5d": "2_5d",
            "теперь flat": "flat",
        }
        for text, expected in cases.items():
            self.assertEqual(style_from_message(text), expected, f"{text!r}")

    def test_subject_descriptions_are_not_treated_as_style(self) -> None:
        """Слово стиля внутри описания предмета — это предмет, а не стиль."""
        from ai_engine.draw_views import style_from_message

        for text in (
            "Нарисуй плоское зеркало и ход лучей через него",
            "Нарисуй объёмную модель клетки с органеллами",
            "Изобрази изометрическую проекцию куба и разрез",
            "Построй график функции",
        ):
            self.assertIsNone(style_from_message(text), f"{text!r} принято за команду стиля")

    def test_router_sends_style_command_straight_to_board(self) -> None:
        """Маршрут детерминированный: модель на такое не зовёт тул.

        Без этого «do sketch» уходило в обычный чат, и GLM отвечал текстом
        «вот более набросочный вариант», не перерисовывая картинку.
        """
        from unittest.mock import patch

        from ai_engine.skills import router

        history = [{"role": "user", "content": "нарисуй брусок на наклонной плоскости"}]
        with patch.object(router.SKILLS["draw_board"], "run") as board_run:
            board_run.return_value = router.SkillResult(reply="ok", skill="draw_board")
            with patch.object(router, "openrouter_client") as client:
                result = router.route_and_run(user_message="do sketch", history=history)
                client.chat.completions.create.assert_not_called()
        self.assertEqual(result.skill, "draw_board")
        board_run.assert_called_once()

    def test_style_command_without_history_goes_through_the_model(self) -> None:
        """Перерисовывать нечего — пусть решает модель, а не эвристика."""
        from unittest.mock import patch

        from ai_engine.skills import router

        with patch.object(router, "openrouter_client") as client:
            client.chat.completions.create.side_effect = RuntimeError("модель вызвана")
            with self.assertRaises(RuntimeError):
                router.route_and_run(user_message="do sketch", history=[])


class LessonPlanContextTests(SimpleTestCase):
    """План урока направляет существующий chat/router pipeline."""

    def setUp(self) -> None:
        self.plan = {
            "topic": "Второй закон Ньютона",
            "objective": "Научиться строить схему сил и применять F = ma",
            "levelLabel": "Знаком с темой",
            "resultType": "solve_problem",
            "difficulties": ["Построить модель"],
            "successCriteria": [
                "Выбрать способ решения",
                "Проверить направление сил",
            ],
            "tasks": [
                {
                    "title": "Ключевая идея",
                    "description": "Связать равнодействующую с ускорением.",
                },
                {
                    "title": "Наглядная схема",
                    "description": "Показать тело и все действующие силы.",
                },
            ],
        }

    def test_lesson_instruction_contains_active_task(self) -> None:
        from ai_engine.chat_views import build_lesson_instruction

        instruction = build_lesson_instruction(
            self.plan,
            self.plan["tasks"][1],
        )

        self.assertIn("Второй закон Ньютона", instruction)
        self.assertIn("Текущий этап: Наглядная схема", instruction)
        self.assertIn("Результат на доске: solve_problem", instruction)
        self.assertIn("Особый фокус: Построить модель", instruction)
        self.assertIn("Критерии успеха:", instruction)
        self.assertIn("не переписывай план молча", instruction)

    def test_invalid_lesson_plan_is_ignored(self) -> None:
        from ai_engine.chat_views import build_lesson_instruction

        self.assertEqual(build_lesson_instruction("raw prompt", {}), "")
        self.assertEqual(build_lesson_instruction({"topic": "Тема"}, {}), "")

    def test_router_receives_lesson_instruction_as_system_context(self) -> None:
        from types import SimpleNamespace
        from unittest.mock import patch

        from ai_engine.skills import router

        response = SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content="Ответ по этапу.", tool_calls=None)
                )
            ]
        )
        with patch.object(router, "openrouter_client") as client:
            client.chat.completions.create.return_value = response
            result = router.route_and_run(
                user_message="Объясни",
                history=[],
                lesson_instruction="Текущий этап: Наглядная схема",
            )

        system_prompt = client.chat.completions.create.call_args.kwargs["messages"][0][
            "content"
        ]
        self.assertIn("Текущий этап: Наглядная схема", system_prompt)
        self.assertEqual(result.reply, "Ответ по этапу.")
