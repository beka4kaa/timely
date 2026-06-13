"""
Deterministic semantic vector renderer for Smart Canvas Analyzer.

GLM may plan diagrams with semantic components, but it must not output raw SVG,
paths, point arrays or pixel coordinates. This renderer is the source of truth
for SVG geometry.
"""

from __future__ import annotations

import base64
import math
import re
from dataclasses import dataclass
from html import escape
from typing import Any


class VectorRenderError(ValueError):
    pass


@dataclass(frozen=True)
class Vec:
    x: float
    y: float

    def __add__(self, other: "Vec") -> "Vec":
        return Vec(self.x + other.x, self.y + other.y)

    def __sub__(self, other: "Vec") -> "Vec":
        return Vec(self.x - other.x, self.y - other.y)

    def __mul__(self, value: float) -> "Vec":
        return Vec(self.x * value, self.y * value)

    def unit(self) -> "Vec":
        length = math.hypot(self.x, self.y)
        if length == 0:
            return Vec(1, 0)
        return Vec(self.x / length, self.y / length)


FORBIDDEN_COMPONENT_KEYS = {
    "svg",
    "raw_svg",
    "path",
    "d",
    "points",
    "start",
    "end",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
}


def ensure_semantic_vector_layout(layout: dict[str, Any]) -> None:
    if not isinstance(layout, dict) or layout.get("type") != "vector_layout":
        raise VectorRenderError("vector_layout.type must be 'vector_layout'")
    components = layout.get("components")
    if not isinstance(components, list):
        raise VectorRenderError("vector_layout.components must be an array")
    for comp in components:
        if not isinstance(comp, dict):
            raise VectorRenderError("Every vector component must be an object")
        if FORBIDDEN_COMPONENT_KEYS.intersection(comp):
            raise VectorRenderError(f"Raw coordinates/SVG are not allowed in component {comp.get('id')}")
        raw = str(comp)
        if "<svg" in raw.lower() or "<path" in raw.lower():
            raise VectorRenderError("Raw SVG is not allowed in vector_layout")
        if re.search(r"\bM\s*-?\d+(?:\.\d+)?[, ]+-?\d+", raw):
            raise VectorRenderError("SVG path data is not allowed in vector_layout")


class VectorRenderer:
    def __init__(self) -> None:
        self.width = 1024
        self.height = 576
        self.elements: list[str] = []
        self.anchors: dict[str, Vec] = {}
        self.surfaces: dict[str, dict[str, Any]] = {}

    def render(self, layout: dict[str, Any]) -> str:
        ensure_semantic_vector_layout(layout)
        self.elements = []
        self.anchors = {}
        self.surfaces = {}

        canvas = layout.get("canvas") or {}
        if isinstance(canvas, dict):
            if isinstance(canvas.get("width"), int) and isinstance(canvas.get("height"), int):
                self.width = int(canvas["width"])
                self.height = int(canvas["height"])
            elif canvas.get("aspect_ratio") == "16:9":
                self.width = 1024
                self.height = 576

        components = layout.get("components") or []
        for comp in components:
            if comp.get("type") == "surface":
                self._render_surface(comp)
        for comp in components:
            if comp.get("type") == "body":
                self._render_body(comp)
        for comp in components:
            ctype = comp.get("type")
            if ctype == "vector":
                self._render_vector(comp)
            elif ctype == "angle_arc":
                self._render_angle_arc(comp)
            elif ctype in {"label", "math_label"}:
                self._render_label(comp)
            elif ctype == "axis":
                self._render_axis(comp)
            elif ctype == "curve":
                self._render_curve(comp)

        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.width}" height="{self.height}" '
            f'viewBox="0 0 {self.width} {self.height}" role="img">'
            "<defs>"
            '<marker id="arrow" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto">'
            '<path d="M2,2 L10,6 L2,10 Z" fill="#243746"/>'
            "</marker>"
            "</defs>"
            '<rect width="100%" height="100%" fill="white"/>'
            + "".join(self.elements)
            + "</svg>"
        )

    def _render_surface(self, comp: dict[str, Any]) -> None:
        cid = self._id(comp)
        shape = comp.get("shape", "floor")
        if shape == "incline":
            angle = float(comp.get("angle_deg", 30))
            start = Vec(self.width * 0.14, self.height * 0.78)
            end = Vec(self.width * 0.84, self.height * 0.78)
            rise = math.tan(math.radians(angle)) * (end.x - start.x)
            top = Vec(end.x, end.y - rise)
            points = f"{start.x:.1f},{start.y:.1f} {end.x:.1f},{end.y:.1f} {top.x:.1f},{top.y:.1f}"
            self.elements.append(
                f'<polygon points="{points}" fill="#E7ECEF" stroke="#243746" stroke-width="4" stroke-linejoin="round"/>'
            )
            self._register(cid, {
                "start": start,
                "end": end,
                "top": top,
                "center": Vec((start.x + end.x + top.x) / 3, (start.y + end.y + top.y) / 3),
            })
            self.surfaces[cid] = {"shape": shape, "angle_deg": angle, "start": start, "end": top}
            if comp.get("label"):
                self._text(comp["label"], start + Vec(42, -22), size=22, anchor="middle")
            return

        y = self.height * 0.76
        self.elements.append(f'<line x1="120" y1="{y:.1f}" x2="{self.width - 120}" y2="{y:.1f}" stroke="#243746" stroke-width="4"/>')
        self._register(cid, {"left": Vec(120, y), "right": Vec(self.width - 120, y), "center": Vec(self.width / 2, y)})
        self.surfaces[cid] = {"shape": "floor", "angle_deg": 0}

    def _render_body(self, comp: dict[str, Any]) -> None:
        cid = self._id(comp)
        shape = comp.get("shape", "block")
        size = 82 if comp.get("size") != "small" else 58
        if shape != "block":
            center = Vec(self.width * 0.5, self.height * 0.48)
            self.elements.append(f'<circle cx="{center.x:.1f}" cy="{center.y:.1f}" r="{size / 2:.1f}" fill="#D6DEE3" stroke="#243746" stroke-width="4"/>')
            self._register(cid, {"center": center})
            return

        surface_id = comp.get("on")
        angle = 0.0
        center = Vec(self.width * 0.48, self.height * 0.54)
        if surface_id in self.surfaces and self.surfaces[surface_id].get("shape") == "incline":
            angle = -float(self.surfaces[surface_id].get("angle_deg", 30))
            center = Vec(self.width * 0.48, self.height * 0.50)

        self.elements.append(
            f'<g transform="translate({center.x:.1f} {center.y:.1f}) rotate({angle:.1f})">'
            f'<rect x="{-size / 2:.1f}" y="{-size / 2:.1f}" width="{size:.1f}" height="{size:.1f}" '
            'fill="#D6DEE3" stroke="#243746" stroke-width="4"/>'
            "</g>"
        )
        self._register(cid, {
            "center": center,
            "top": center + Vec(0, -size / 2),
            "bottom": center + Vec(0, size / 2),
            "left": center + Vec(-size / 2, 0),
            "right": center + Vec(size / 2, 0),
        })
        if comp.get("label"):
            self._text(comp["label"], center + Vec(0, 7), size=24, anchor="middle")

    def _render_vector(self, comp: dict[str, Any]) -> None:
        start = self._anchor(comp.get("target"))
        direction = self._direction(comp.get("direction"), start)
        length = 105 if comp.get("length") != "short" else 78
        end = start + direction.unit() * length
        self.elements.append(self._line(start, end, arrow=True, width=5))
        if comp.get("label"):
            label_pos = end + Vec(16 if direction.x >= 0 else -18, -12)
            self._text(comp["label"], label_pos, size=22, anchor="start" if direction.x >= 0 else "end")

    def _render_angle_arc(self, comp: dict[str, Any]) -> None:
        incline = next((s for s in self.surfaces.values() if s.get("shape") == "incline"), None)
        angle = float(incline.get("angle_deg", 30)) if incline else 30.0
        base = Vec(self.width * 0.65, self.height * 0.78)
        r = 62
        end = Vec(base.x + r * math.cos(math.radians(-angle)), base.y + r * math.sin(math.radians(-angle)))
        d = f"M{base.x + r:.1f},{base.y:.1f} A{r:.1f},{r:.1f} 0 0 0 {end.x:.1f},{end.y:.1f}"
        self.elements.append(f'<path d="{d}" fill="none" stroke="#4D6473" stroke-width="4"/>')
        if comp.get("label"):
            label = Vec(base.x + r * 0.72 * math.cos(math.radians(-angle / 2)), base.y + r * 0.72 * math.sin(math.radians(-angle / 2)))
            self._text(comp["label"], label + Vec(8, -4), size=23, anchor="middle")

    def _render_axis(self, comp: dict[str, Any]) -> None:
        origin = Vec(self.width * 0.16, self.height * 0.78)
        self.elements.append(self._line(origin, Vec(self.width * 0.86, origin.y), arrow=True, width=3))
        self.elements.append(self._line(origin, Vec(origin.x, self.height * 0.16), arrow=True, width=3))
        self._register(self._id(comp), {"center": origin, "origin": origin})
        if comp.get("x_label"):
            self._text(comp["x_label"], Vec(self.width * 0.88, origin.y + 24), size=20)
        if comp.get("y_label"):
            self._text(comp["y_label"], Vec(origin.x - 24, self.height * 0.15), size=20)

    def _render_curve(self, comp: dict[str, Any]) -> None:
        shape = comp.get("shape", "parabola")
        if shape != "parabola":
            raise VectorRenderError(f"Unsupported curve shape: {shape}")
        pts: list[str] = []
        ox, oy = self.width * 0.5, self.height * 0.68
        scale_x, scale_y = 70, 30
        for i in range(-40, 41):
            x = i / 10
            y = x * x
            pts.append(f"{ox + x * scale_x:.1f},{oy - y * scale_y:.1f}")
        self.elements.append(f'<polyline points="{" ".join(pts)}" fill="none" stroke="#2E86AB" stroke-width="5"/>')
        if comp.get("label"):
            self._text(comp["label"], Vec(ox + 160, oy - 150), size=22)

    def _render_label(self, comp: dict[str, Any]) -> None:
        ref = comp.get("attach_to") or comp.get("target")
        point = self._anchor(ref) if ref else Vec(self.width * 0.5, self.height * 0.16)
        self._text(comp.get("text") or comp.get("label") or "", point + Vec(12, -12), size=22)

    def _direction(self, spec: Any, start: Vec) -> Vec:
        if isinstance(spec, str):
            return {
                "down": Vec(0, 1),
                "up": Vec(0, -1),
                "left": Vec(-1, 0),
                "right": Vec(1, 0),
            }.get(spec, Vec(1, 0))
        if isinstance(spec, dict):
            if spec.get("perpendicular_to") in self.surfaces:
                angle = float(self.surfaces[spec["perpendicular_to"]].get("angle_deg", 30))
                sign = -1 if spec.get("side") == "outward" else 1
                return Vec(math.sin(math.radians(angle)) * sign, -math.cos(math.radians(angle)) * sign)
            if spec.get("parallel_to") in self.surfaces:
                angle = float(self.surfaces[spec["parallel_to"]].get("angle_deg", 30))
                sense = -1 if spec.get("sense") == "up_slope" else 1
                return Vec(math.cos(math.radians(angle)) * sense, -math.sin(math.radians(angle)) * sense)
        return Vec(1, 0)

    def _id(self, comp: dict[str, Any]) -> str:
        cid = comp.get("id")
        if not isinstance(cid, str) or not cid:
            raise VectorRenderError("Every component must have an id")
        return cid

    def _register(self, cid: str, anchors: dict[str, Vec]) -> None:
        for name, point in anchors.items():
            self.anchors[f"{cid}.{name}"] = point

    def _anchor(self, ref: Any) -> Vec:
        if not isinstance(ref, str) or ref not in self.anchors:
            raise VectorRenderError(f"Missing anchor: {ref}")
        return self.anchors[ref]

    def _line(self, start: Vec, end: Vec, arrow: bool = False, width: int = 4) -> str:
        marker = ' marker-end="url(#arrow)"' if arrow else ""
        return (
            f'<line x1="{start.x:.1f}" y1="{start.y:.1f}" x2="{end.x:.1f}" y2="{end.y:.1f}" '
            f'stroke="#243746" stroke-width="{width}" stroke-linecap="round"{marker}/>'
        )

    def _text(self, text: Any, point: Vec, size: int = 20, anchor: str = "start") -> None:
        self.elements.append(
            f'<text x="{point.x:.1f}" y="{point.y:.1f}" font-family="Arial, sans-serif" '
            f'font-size="{size}" font-weight="600" text-anchor="{anchor}" fill="#17202A">{escape(str(text))}</text>'
        )


def svg_to_png_data_url(svg: str) -> str | None:
    """Best-effort deterministic PNG fallback. Returns None if CairoSVG is unavailable."""
    try:
        import cairosvg

        png = cairosvg.svg2png(bytestring=svg.encode("utf-8"))
    except Exception:
        return None
    return f"data:image/png;base64,{base64.b64encode(png).decode('ascii')}"
