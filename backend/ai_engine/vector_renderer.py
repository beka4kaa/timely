"""
Deterministic renderer for the semantic scientific-diagram DSL.

The language model may describe bodies, surfaces and relationships, but it
cannot provide SVG, paths, point arrays or pixel coordinates.  This module is
the geometry source of truth and intentionally has no image-model dependency.
"""

from __future__ import annotations

import base64
import math
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from html import escape
from typing import Any, Iterable


class VectorRenderError(ValueError):
    """Raised when a vector layout is unsafe, invalid or unsupported."""


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
        if length <= 1e-9:
            raise VectorRenderError("Cannot normalize a zero-length vector")
        return Vec(self.x / length, self.y / length)


@dataclass(frozen=True)
class Box:
    left: float
    top: float
    right: float
    bottom: float

    def expanded(self, gap: float) -> "Box":
        return Box(
            self.left - gap,
            self.top - gap,
            self.right + gap,
            self.bottom + gap,
        )

    def overlaps(self, other: "Box") -> bool:
        return not (
            self.right <= other.left
            or self.left >= other.right
            or self.bottom <= other.top
            or self.top >= other.bottom
        )


@dataclass(frozen=True)
class SurfaceGeometry:
    shape: str
    left: Vec
    right: Vec
    tangent: Vec
    normal: Vec
    angle_deg: float

    @property
    def center(self) -> Vec:
        return self.left + (self.right - self.left) * 0.5

    def point_at(self, fraction: float) -> Vec:
        return self.left + (self.right - self.left) * fraction


_COMPONENT_TYPES = {
    "axis",
    "curve",
    "label",
    "math_label",
    "vector",
    "body",
    "surface",
    "pulley",
    "angle_arc",
    "dimension_line",
    "connector",
    "trajectory",
}
_BODY_SHAPES = {"block", "sphere", "particle", "rod"}
_SURFACE_SHAPES = {"floor", "wall", "incline"}
_CURVE_SHAPES = {"line", "parabola", "exponential"}
_VECTOR_KINDS = {
    "force",
    "velocity",
    "acceleration",
    "electric_field",
    "magnetic_field",
}
_CONNECTOR_KINDS = {"rope", "spring", "rod"}
_TRAJECTORY_SHAPES = {"projectile", "circular", "straight", "dashed_path"}
_PLACEMENTS = {"above", "below", "left", "right", "center"}
_FORBIDDEN_COMPONENT_KEYS = {
    "svg",
    "raw_svg",
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
    "start",
    "end",
    "x",
    "y",
    "x1",
    "y1",
    "x2",
    "y2",
}
_UNSAFE_TEXT_RE = re.compile(
    r"(?:https?:|data:|javascript:|<\s*svg|<\s*path|<\s*script|foreignObject)",
    re.IGNORECASE,
)
_SVG_PATH_RE = re.compile(r"\bM\s*-?\d+(?:\.\d+)?[, ]+-?\d+", re.IGNORECASE)

_INK = "#243746"
_SURFACE_FILL = "#E5E7EB"
_BLOCK_FILL = "#8299AD"
_WEIGHT_BLUE = "#2563EB"
_NORMAL_GREEN = "#2E7D32"
_FRICTION_RED = "#C43D35"
_GRID = "#E2E8F0"


def ensure_semantic_vector_layout(layout: dict[str, Any]) -> None:
    """Validate the model-facing DSL without accepting arbitrary geometry."""

    if not isinstance(layout, dict):
        raise VectorRenderError("Layout must be an object")
    if layout.get("type") != "vector_layout":
        raise VectorRenderError("vector_layout.type must be 'vector_layout'")
    if layout.get("schema_version") != "0.1":
        raise VectorRenderError("Unsupported vector_layout.schema_version")

    canvas = layout.get("canvas")
    if not isinstance(canvas, dict):
        raise VectorRenderError("vector_layout.canvas must be an object")
    background = canvas.get("background", "white")
    if not isinstance(background, str) or background.lower() not in {
        "white",
        "#fff",
        "#ffffff",
    }:
        raise VectorRenderError("Only a white canvas background is allowed in V1")
    has_dimensions = isinstance(canvas.get("width"), (int, float)) and isinstance(
        canvas.get("height"), (int, float)
    )
    if not has_dimensions and canvas.get("aspect_ratio") != "16:9":
        raise VectorRenderError("canvas requires width/height or aspect_ratio='16:9'")
    if has_dimensions:
        width = float(canvas["width"])
        height = float(canvas["height"])
        if not (1 <= width <= 4096 and 1 <= height <= 4096):
            raise VectorRenderError("canvas dimensions must be between 1 and 4096")

    components = layout.get("components")
    if not isinstance(components, list):
        raise VectorRenderError("vector_layout.components must be an array")

    seen_ids: set[str] = set()
    for index, component in enumerate(components):
        if not isinstance(component, dict):
            raise VectorRenderError(f"components[{index}] must be an object")
        _reject_unsafe_component_value(component, f"components[{index}]")
        component_id = component.get("id")
        if not isinstance(component_id, str) or not component_id.strip():
            raise VectorRenderError(f"components[{index}].id must be a non-empty string")
        if component_id in seen_ids:
            raise VectorRenderError(f"Duplicate component id: {component_id}")
        seen_ids.add(component_id)
        if component.get("type") not in _COMPONENT_TYPES:
            raise VectorRenderError(f"Unknown component type: {component.get('type')}")


def _reject_unsafe_component_value(value: Any, path: str) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if key in _FORBIDDEN_COMPONENT_KEYS:
                raise VectorRenderError(f"Raw coordinates/SVG are not allowed: {path}.{key}")
            _reject_unsafe_component_value(child, f"{path}.{key}")
        return
    if isinstance(value, list):
        if value and all(
            isinstance(item, list)
            and len(item) >= 2
            and all(isinstance(number, (int, float)) for number in item)
            for item in value
        ):
            raise VectorRenderError(f"Point arrays are not allowed: {path}")
        for index, child in enumerate(value):
            _reject_unsafe_component_value(child, f"{path}[{index}]")
        return
    if isinstance(value, str):
        if _UNSAFE_TEXT_RE.search(value) or _SVG_PATH_RE.search(value):
            raise VectorRenderError(f"External references or raw SVG are not allowed: {path}")
        if len(value) > 1000:
            raise VectorRenderError(f"String is too long: {path}")


def tangent_point_on_wheel(point: Vec, center: Vec, radius: float) -> Vec:
    """Точка касания прямой, идущей из `point` к окружности (center, radius).

    Чистая геометрия, без рендерера — как требует AGENTS.md по геометрическим
    хелперам. Если точка внутри окружности, касательной нет: возвращаем
    ближайшую точку обода, чтобы трос всё равно вышел из обода, а не из центра.

    Из двух симметричных касательных берём ту, что лежит с той же стороны от
    оси колеса, что и сама точка. Это НЕ косметика: груз висит ровно под ободом,
    и только «своя» касательная даёт вертикальный участок троса — а значит
    вертикальное натяжение. Противоположная касательная уводила трос по
    диагонали через колесо, и сила T получалась физически неверной.
    """
    delta = point - center
    span = math.hypot(delta.x, delta.y)
    if span <= radius:
        unit = delta.unit() if span > 1e-9 else Vec(0, -1)
        return center + unit * radius

    # Угол между линией «центр→точка» и касательной: cos(alpha) = r / span.
    alpha = math.acos(max(-1.0, min(1.0, radius / span)))
    base = math.atan2(delta.y, delta.x)
    candidates = [
        center + Vec(math.cos(base + alpha) * radius, math.sin(base + alpha) * radius),
        center + Vec(math.cos(base - alpha) * radius, math.sin(base - alpha) * radius),
    ]
    # Ближайшая по горизонтали к точке: для груза под левым ободом это ровно
    # rim_left, и участок троса выходит строго вертикальным.
    return min(candidates, key=lambda candidate: abs(candidate.x - point.x))


def rope_over_wheel(
    start: Vec,
    end: Vec,
    center: Vec,
    radius: float,
) -> tuple[str, list[Vec]]:
    """SVG-path троса, перекинутого через колесо, + точки касания.

    Трос идёт прямым участком от `start` до обода, огибает колесо по дуге и
    уходит прямым участком к `end`. Дуга рисуется по «внешней» стороне — той,
    что дальше от хорды между точками касания, иначе трос прошёл бы сквозь ось.

    Возвращает `(path, [tangent_start, tangent_end])`. Детерминировано:
    ни случайности, ни зависимости от порядка вызовов.
    """
    t_start = tangent_point_on_wheel(start, center, radius)
    t_end = tangent_point_on_wheel(end, center, radius)

    # sweep_flag определяем по знаку векторного произведения: дуга должна идти
    # «поверх» колеса, а не срезать его насквозь.
    cross = (t_start - center).x * (t_end - center).y - (t_start - center).y * (t_end - center).x
    sweep = 1 if cross > 0 else 0

    path = (
        f"M {start.x:.1f},{start.y:.1f} "
        f"L {t_start.x:.1f},{t_start.y:.1f} "
        f"A {radius:.1f},{radius:.1f} 0 0 {sweep} {t_end.x:.1f},{t_end.y:.1f} "
        f"L {end.x:.1f},{end.y:.1f}"
    )
    return path, [t_start, t_end]


class VectorRenderer:
    """Compile a validated semantic layout into deterministic SVG."""

    _STRUCTURE_ROLES = {
        "incline",
        "floor",
        "wall",
        "body",
        # Шкив и его крепление — физическая структура сцены: именно её
        # стилизует image-модель. Трос остаётся в overlay, потому что его
        # геометрию (касательные + дуга) бэкенд считает точно, а модель — нет.
        "pulley",
        "pulley-axle",
        "pulley-mount",
    }
    _OVERLAY_ROLES = {
        "axis",
        "curve",
        "force-vector",
        "vector",
        "angle-arc",
        "dimension-line",
        "connector",
        "trajectory",
    }
    _PRIORITY = {
        "axis": 10,
        "surface": 20,
        # Шкив рисуется ДО тела: тело может висеть на нём (`hangs_from`), а для
        # этого его якоря должны быть уже зарегистрированы.
        "pulley": 25,
        "body": 30,
        "curve": 40,
        "connector": 50,
        "trajectory": 55,
        "vector": 60,
        "angle_arc": 70,
        "dimension_line": 75,
        "label": 80,
        "math_label": 80,
    }

    def __init__(self, *, emit_text: bool = True) -> None:
        # emit_text=False → «geometry-only»: SVG рисуется без единого <text>,
        # а подписи возвращаются структурой через render_with_labels(). Нужно
        # для доски: текст там живёт отдельным DOM-слоем, который можно
        # перетаскивать, поэтому впечатывать его в растр нельзя.
        self.emit_text = emit_text
        self.width = 1024
        self.height = 576
        self.elements: list[str] = []
        self.anchors: dict[str, Vec] = {}
        self.surfaces: dict[str, SurfaceGeometry] = {}
        # id шкива → (центр, радиус). Нужен тросу (`over`) и телу (`hangs_from`).
        self.pulleys: dict[str, tuple[Vec, float]] = {}
        # id троса → (начало, конец) фактических участков, для along_connector.
        self.connector_segments: dict[str, tuple[Vec, Vec]] = {}
        self.axes: dict[str, dict[str, Any]] = {}
        self.vector_segments: list[tuple[Vec, Vec]] = []
        self.label_boxes: list[Box] = []
        self.collected_labels: list[dict[str, Any]] = []

    def render(self, layout: dict[str, Any]) -> str:
        return self._render_svg(layout)

    def render_with_labels(
        self, layout: dict[str, Any]
    ) -> tuple[str, list[dict[str, Any]]]:
        """SVG + подписи структурой, в процентах холста (контракт фронтенда).

        Позиции текста считает тот же коллизионный солвер, что и при обычном
        рендере, поэтому подписи приезжают на доску уже разложенными «как надо»,
        а пользователь двигает их только если хочет.
        """
        svg = self._render_svg(layout)
        return svg, self._labels_as_percent()

    def render_layers_with_labels(
        self, layout: dict[str, Any]
    ) -> tuple[str, str, str, list[dict[str, Any]]]:
        """Return full, structure and transparent-overlay SVG layers.

        The structure layer is the only reference sent to an optional image
        stylist.  Arrows, angle arcs and other exact scientific marks stay in
        the transparent overlay and are composed by the backend afterwards.
        """
        full_svg = self._render_svg(layout)
        structure = [
            element
            for element in self.elements
            if self._element_role(element) in self._STRUCTURE_ROLES
        ]
        structure_outlines = [
            self._as_transparent_outline(element)
            for element in structure
        ]
        overlay = structure_outlines + [
            element
            for element in self.elements
            if self._element_role(element) in self._OVERLAY_ROLES
        ]
        return (
            full_svg,
            self._svg_document(structure, background=True),
            self._svg_document(overlay, background=False),
            self._labels_as_percent(),
        )

    def _render_svg(self, layout: dict[str, Any]) -> str:
        ensure_semantic_vector_layout(layout)
        self._reset(layout["canvas"])

        indexed_components = list(enumerate(layout["components"]))
        ordered = sorted(
            indexed_components,
            key=lambda item: (self._PRIORITY[item[1]["type"]], item[0]),
        )
        for _, component in ordered:
            self._render_component(component)

        return self._svg_document(self.elements, background=True)

    def _svg_document(self, elements: Iterable[str], *, background: bool) -> str:
        body = "\n  ".join(elements)
        background_rect = (
            '  <rect width="100%" height="100%" fill="white"/>\n'
            if background
            else ""
        )
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.width}" '
            f'height="{self.height}" viewBox="0 0 {self.width} {self.height}" '
            'role="img" aria-label="deterministic scientific diagram">\n'
            "  <defs>\n"
            f"{self._marker('arrow-dark', _INK)}\n"
            f"{self._marker('arrow-weight', _WEIGHT_BLUE)}\n"
            f"{self._marker('arrow-normal', _NORMAL_GREEN)}\n"
            f"{self._marker('arrow-friction', _FRICTION_RED)}\n"
            "  </defs>\n"
            f"{background_rect}"
            f"  {body}\n"
            "</svg>"
        )

    @staticmethod
    def _element_role(element: str) -> str | None:
        match = re.search(r'\bdata-role="([^"]+)"', element)
        return match.group(1) if match else None

    @staticmethod
    def _as_transparent_outline(element: str) -> str:
        """Keep exact structure contours without covering Seedream styling."""
        if re.search(r'\bfill="[^"]*"', element):
            return re.sub(r'\bfill="[^"]*"', 'fill="none"', element, count=1)
        return element

    def _reset(self, canvas: dict[str, Any]) -> None:
        if isinstance(canvas.get("width"), (int, float)) and isinstance(
            canvas.get("height"), (int, float)
        ):
            self.width = int(round(float(canvas["width"])))
            self.height = int(round(float(canvas["height"])))
        else:
            self.width = 1024
            self.height = 576
        self.elements = []
        self.anchors = {}
        self.surfaces = {}
        self.axes = {}
        self.vector_segments = []
        self.label_boxes = []
        self.collected_labels = []

    @staticmethod
    def _marker(marker_id: str, color: str) -> str:
        return (
            f'    <marker id="{marker_id}" markerWidth="10" markerHeight="10" '
            'refX="8.6" refY="5" orient="auto" markerUnits="userSpaceOnUse">\n'
            f'      <path d="M0,0 L10,5 L0,10 Z" fill="{color}"/>\n'
            "    </marker>"
        )

    def _render_component(self, component: dict[str, Any]) -> None:
        renderer = {
            "axis": self._render_axis,
            "curve": self._render_curve,
            "label": self._render_label,
            "math_label": self._render_label,
            "surface": self._render_surface,
            "pulley": self._render_pulley,
            "body": self._render_body,
            "vector": self._render_vector,
            "angle_arc": self._render_angle_arc,
            "dimension_line": self._render_dimension_line,
            "connector": self._render_connector,
            "trajectory": self._render_trajectory,
        }[component["type"]]
        renderer(component)

    def _render_surface(self, component: dict[str, Any]) -> None:
        component_id = self._id(component)
        shape = component.get("shape")
        if shape not in _SURFACE_SHAPES:
            raise VectorRenderError(f"Unsupported surface shape: {shape}")

        if shape == "incline":
            angle_deg = float(component.get("angle_deg", 30))
            if not 5 <= angle_deg <= 75:
                raise VectorRenderError("incline.angle_deg must be between 5 and 75")
            foot = Vec(self.width * 0.14, self.height * 0.78)
            angle = math.radians(angle_deg)
            desired_run = self.width * 0.62
            max_run = (foot.y - self.height * 0.14) / max(math.tan(angle), 1e-6)
            run = max(self.width * 0.32, min(desired_run, max_run))
            slope_top = Vec(foot.x + run, foot.y - math.tan(angle) * run)
            base_right = Vec(slope_top.x, foot.y)
            tangent = (slope_top - foot).unit()
            normal = Vec(tangent.y, -tangent.x).unit()
            geometry = SurfaceGeometry(
                shape=shape,
                left=foot,
                right=slope_top,
                tangent=tangent,
                normal=normal,
                angle_deg=angle_deg,
            )
            self.surfaces[component_id] = geometry
            self._register(
                component_id,
                {
                    "left": foot,
                    "right": slope_top,
                    "center": geometry.center,
                    "bottom_right": base_right,
                },
            )
            points = " ".join(
                f"{point.x:.1f},{point.y:.1f}"
                for point in (foot, base_right, slope_top)
            )
            self.elements.append(
                f'<polygon data-component-id="{escape(component_id)}" data-role="incline" '
                f'points="{points}" fill="{_SURFACE_FILL}" stroke="#64748B" '
                'stroke-width="3" stroke-linejoin="round"/>'
            )
            if component.get("label"):
                self._text(
                    component["label"],
                    geometry.center + geometry.normal * 32,
                    size=20,
                    data_role="surface-label",
                    data_for=component_id,
                )
            return

        if shape == "floor":
            left = Vec(self.width * 0.16, self.height * 0.72)
            right = Vec(self.width * 0.84, self.height * 0.72)
        else:
            left = Vec(self.width * 0.18, self.height * 0.72)
            right = Vec(self.width * 0.18, self.height * 0.27)
        tangent = (right - left).unit()
        normal = Vec(tangent.y, -tangent.x).unit()
        if shape == "wall" and normal.x < 0:
            normal = normal * -1
        geometry = SurfaceGeometry(
            shape=shape,
            left=left,
            right=right,
            tangent=tangent,
            normal=normal,
            angle_deg=0,
        )
        self.surfaces[component_id] = geometry
        center = geometry.center
        anchors = {"left": left, "right": center if shape == "wall" else right, "center": center}
        self._register(component_id, anchors)
        self.elements.append(
            self._line(
                left,
                right,
                color=_INK,
                width=4,
                data_role=shape,
                data_component_id=component_id,
            )
        )

    def _render_pulley(self, component: dict[str, Any]) -> None:
        """Неподвижный блок: обод, ось и кронштейн крепления к потолку.

        Позиция семантическая, а не пиксельная: `mount` = "ceiling" | "wall".
        Модель называет отношение, координаты считает бэкенд.
        """
        component_id = self._id(component)
        size_name = str(component.get("size", "medium"))
        size_scale = {"small": 0.09, "medium": 0.12, "large": 0.155}.get(size_name)
        if size_scale is None:
            raise VectorRenderError(f"Unsupported pulley size: {size_name}")
        radius = min(self.width, self.height) * size_scale

        mount = str(component.get("mount", "ceiling"))
        if mount not in {"ceiling", "wall"}:
            raise VectorRenderError(f"Unsupported pulley mount: {mount}")

        # Шкив висит в верхней части кадра, по центру: ниже должно остаться
        # место под груз и под вертикальную стрелку mg.
        center = Vec(self.width * 0.5, self.height * 0.26)
        bracket_top = Vec(center.x, self.height * 0.09)

        # Кронштейн и опорная планка.
        self.elements.append(
            self._line(
                Vec(bracket_top.x - self.width * 0.11, bracket_top.y),
                Vec(bracket_top.x + self.width * 0.11, bracket_top.y),
                color=_INK,
                width=6,
                data_role="pulley-mount",
                data_component_id=component_id,
            )
        )
        self.elements.append(
            self._line(
                bracket_top,
                Vec(center.x, center.y - radius),
                color=_INK,
                width=4,
                data_role="pulley-mount",
                data_component_id=component_id,
            )
        )
        # Обод + ось.
        self.elements.append(
            f'<circle data-component-id="{escape(component_id)}" data-role="pulley" '
            f'cx="{center.x:.1f}" cy="{center.y:.1f}" r="{radius:.1f}" '
            f'fill="{_BLOCK_FILL}" stroke="{_INK}" stroke-width="4"/>'
        )
        self.elements.append(
            f'<circle data-component-id="{escape(component_id)}" data-role="pulley-axle" '
            f'cx="{center.x:.1f}" cy="{center.y:.1f}" r="{radius * 0.16:.1f}" '
            f'fill="{_INK}" stroke="none"/>'
        )

        self.pulleys[component_id] = (center, radius)
        self._register(
            component_id,
            {
                "center": center,
                "top": center + Vec(0, -radius),
                "bottom": center + Vec(0, radius),
                "rim_left": center + Vec(-radius, 0),
                "rim_right": center + Vec(radius, 0),
                "mount": bracket_top,
            },
        )
        if component.get("label"):
            self._text(
                component["label"],
                center + Vec(-radius * 1.25, -radius * 0.9),
                size=20,
                data_role="body-label",
                data_for=component_id,
            )

    def _render_body(self, component: dict[str, Any]) -> None:
        component_id = self._id(component)
        shape = component.get("shape")
        if shape not in _BODY_SHAPES:
            raise VectorRenderError(f"Unsupported body shape: {shape}")

        size_name = str(component.get("size", "medium"))
        size_scale = {"small": 0.105, "medium": 0.145, "large": 0.19}.get(size_name)
        if size_scale is None:
            raise VectorRenderError(f"Unsupported body size: {size_name}")
        size = min(self.width, self.height) * size_scale

        tangent = Vec(1, 0)
        normal = Vec(0, -1)
        center = Vec(self.width * 0.5, self.height * 0.5)
        surface_id = component.get("on")
        surface = self.surfaces.get(surface_id) if isinstance(surface_id, str) else None
        if surface_id and not surface:
            raise VectorRenderError(f"Missing surface: {surface_id}")
        if surface:
            tangent = surface.tangent
            normal = surface.normal

        # Тело, подвешенное на шкиве. Отношение семантическое (`hangs_from` +
        # `side`), позицию считает бэкенд: под соответствующей точкой обода, на
        # фиксированной доле высоты кадра — так под ним остаётся место под mg.
        hangs_from = component.get("hangs_from")
        if isinstance(hangs_from, str):
            pulley = self.pulleys.get(hangs_from)
            if pulley is None:
                raise VectorRenderError(f"Missing pulley: {hangs_from}")
            pulley_center, pulley_radius = pulley
            side = str(component.get("side", "left"))
            if side not in {"left", "right"}:
                raise VectorRenderError(f"Unsupported hang side: {side}")
            offset = -pulley_radius if side == "left" else pulley_radius
            center = Vec(pulley_center.x + offset, self.height * 0.68)

        if shape == "block":
            half_width = size * 0.76
            half_height = size * 0.43
            if surface:
                center = surface.point_at(0.50) + normal * half_height
            corners = [
                center - tangent * half_width - normal * half_height,
                center + tangent * half_width - normal * half_height,
                center + tangent * half_width + normal * half_height,
                center - tangent * half_width + normal * half_height,
            ]
            points = " ".join(f"{point.x:.1f},{point.y:.1f}" for point in corners)
            self.elements.append(
                f'<polygon data-component-id="{escape(component_id)}" data-role="body" '
                f'points="{points}" fill="{_BLOCK_FILL}" stroke="{_INK}" '
                'stroke-width="4" stroke-linejoin="round"/>'
            )
            anchors = {
                "center": center,
                "top": center + normal * half_height,
                "bottom": center - normal * half_height,
                "left": center - tangent * half_width,
                "right": center + tangent * half_width,
            }
            if component.get("label"):
                label_point = center - tangent * (half_width * 0.42) + normal * (half_height * 0.20)
                self._text(
                    component["label"],
                    label_point,
                    size=20,
                    data_role="body-label",
                    data_for=component_id,
                )
        elif shape in {"sphere", "particle"}:
            radius = size * (0.46 if shape == "sphere" else 0.23)
            if surface:
                center = surface.center + normal * radius
            self.elements.append(
                f'<circle data-component-id="{escape(component_id)}" data-role="body" '
                f'cx="{center.x:.1f}" cy="{center.y:.1f}" r="{radius:.1f}" '
                f'fill="{_BLOCK_FILL}" stroke="{_INK}" stroke-width="4"/>'
            )
            anchors = {
                "center": center,
                "top": center + Vec(0, -radius),
                "bottom": center + Vec(0, radius),
                "left": center + Vec(-radius, 0),
                "right": center + Vec(radius, 0),
            }
        else:
            half_length = size * 0.72
            if surface:
                center = surface.center + normal * 10
            left = center - tangent * half_length
            right = center + tangent * half_length
            self.elements.append(
                self._line(
                    left,
                    right,
                    color=_INK,
                    width=6,
                    data_role="body",
                    data_component_id=component_id,
                )
            )
            anchors = {
                "center": center,
                "left": left,
                "right": right,
                "top": center + normal * 10,
                "bottom": center - normal * 10,
            }
        self._register(component_id, anchors)

    def _render_vector(self, component: dict[str, Any]) -> None:
        component_id = self._id(component)
        kind = component.get("kind")
        if kind not in _VECTOR_KINDS:
            raise VectorRenderError(f"Unsupported vector kind: {kind}")
        start = self._anchor(component.get("target"))
        direction = self._vector_direction(component)
        length_name = str(component.get("length", "medium"))
        length_factor = {"short": 0.16, "medium": 0.21, "long": 0.27}.get(length_name)
        if length_factor is None:
            raise VectorRenderError(f"Unsupported vector length: {length_name}")
        length = min(self.width, self.height) * length_factor
        end = start + direction * length
        subtype = self._vector_subtype(component)
        color, marker_id = {
            "weight": (_WEIGHT_BLUE, "arrow-weight"),
            "normal": (_NORMAL_GREEN, "arrow-normal"),
            "friction": (_FRICTION_RED, "arrow-friction"),
        }.get(subtype, (_INK, "arrow-dark"))
        role = "force-vector" if kind == "force" else "vector"
        self.elements.append(
            self._line(
                start,
                end,
                color=color,
                width=5,
                marker_id=marker_id,
                data_role=role,
                data_component_id=component_id,
                extra_attrs={"data-vector-subtype": subtype},
            )
        )
        self.vector_segments.append((start, end))
        self._register(component_id, {"start": start, "mid": start + (end - start) * 0.5, "end": end})
        if component.get("label"):
            self._render_vector_label(
                component_id=component_id,
                text=str(component["label"]),
                subtype=subtype,
                start=start,
                end=end,
                direction=direction,
                color=color,
                component=component,
            )

    def _vector_direction(self, component: dict[str, Any]) -> Vec:
        spec = component.get("direction")
        if isinstance(spec, str) and spec in {"up", "down", "left", "right"}:
            return {
                "up": Vec(0, -1),
                "down": Vec(0, 1),
                "left": Vec(-1, 0),
                "right": Vec(1, 0),
            }[spec]

        relation = spec if isinstance(spec, dict) else component
        perpendicular_to = relation.get("perpendicular_to")
        if isinstance(perpendicular_to, str):
            surface = self.surfaces.get(perpendicular_to)
            if not surface:
                raise VectorRenderError(f"Missing surface for perpendicular vector: {perpendicular_to}")
            return surface.normal if relation.get("side", "outward") == "outward" else surface.normal * -1

        parallel_to = relation.get("parallel_to")
        if isinstance(parallel_to, str):
            surface = self.surfaces.get(parallel_to)
            if not surface:
                raise VectorRenderError(f"Missing surface for parallel vector: {parallel_to}")
            return surface.tangent if relation.get("sense", "up_slope") == "up_slope" else surface.tangent * -1

        # Натяжение направлено вдоль троса. Все формы выше требуют `surface`,
        # поэтому без этой ветки силу T в DSL выразить было нельзя.
        along_connector = relation.get("along_connector")
        if isinstance(along_connector, str):
            segment = self.connector_segments.get(along_connector)
            if segment is None:
                raise VectorRenderError(
                    f"Missing connector for along_connector vector: {along_connector}"
                )
            body_end, far_end = segment
            unit = (far_end - body_end).unit()
            # away_from_body — физически верный смысл натяжения: трос ТЯНЕТ тело
            # к точке подвеса, то есть от тела вдоль троса.
            sense = relation.get("sense", "away_from_body")
            if sense not in {"away_from_body", "toward_body"}:
                raise VectorRenderError(f"Unsupported along_connector sense: {sense}")
            return unit if sense == "away_from_body" else unit * -1

        raise VectorRenderError(f"Unsupported vector direction: {spec}")

    @staticmethod
    def _vector_subtype(component: dict[str, Any]) -> str:
        explicit = str(component.get("subtype", "")).strip().lower()
        if explicit in {"weight", "normal", "friction"}:
            return explicit
        label = str(component.get("label", "")).strip().lower()
        component_id = str(component.get("id", "")).strip().lower()
        combined = f"{component_id} {label}"
        if re.search(r"(?:weight|gravity|тяжест|\bmg\b)", combined):
            return "weight"
        if re.search(r"(?:normal|нормал|реакц|\bn\b)", combined):
            return "normal"
        if re.search(r"(?:friction|трени|тр\b|^f$)", combined):
            return "friction"
        return "generic"

    def _render_vector_label(
        self,
        *,
        component_id: str,
        text: str,
        subtype: str,
        start: Vec,
        end: Vec,
        direction: Vec,
        color: str,
        component: dict[str, Any],
    ) -> None:
        size = max(18, min(23, round(self.width / 47)))
        text_width = self._estimate_text_width(text, size)
        text_height = size * 1.25
        midpoint = start + (end - start) * 0.55
        perpendicular = Vec(-direction.y, direction.x)
        rotation = 0.0

        if subtype == "weight":
            candidates = [
                midpoint + Vec(text_width / 2 + 18, 2),
                midpoint + Vec(-(text_width / 2 + 18), 2),
                end + Vec(text_width / 2 + 18, 0),
            ]
        elif subtype == "friction":
            surface = self._surface_for_relation(component, "parallel_to")
            outward = surface.normal if surface else perpendicular
            rotation = -surface.angle_deg if surface else math.degrees(math.atan2(direction.y, direction.x))
            gap = self._rotated_height(text_width, text_height, rotation) / 2 + 12
            candidates = [
                midpoint + outward * gap,
                end + direction * (text_width / 2 + 34),
                midpoint - outward * gap,
            ]
        elif subtype == "normal":
            candidates = [
                end + direction * (text_height / 2 + 18),
                midpoint + perpendicular * (text_height / 2 + 18),
                midpoint - perpendicular * (text_height / 2 + 18),
            ]
        else:
            gap = text_height / 2 + 16
            candidates = [
                midpoint + perpendicular * gap,
                midpoint - perpendicular * gap,
                end + direction * (text_height / 2 + 16),
            ]

        point, box = self._choose_label_position(
            candidates,
            text_width=text_width,
            text_height=text_height,
            rotation=rotation,
        )
        self.label_boxes.append(box)
        self._text(
            text,
            point,
            size=size,
            color=color,
            rotation=rotation,
            data_role="vector-label",
            data_for=component_id,
            known_box=box,
        )

    def _surface_for_relation(
        self,
        component: dict[str, Any],
        relation_name: str,
    ) -> SurfaceGeometry | None:
        spec = component.get("direction")
        relation = spec if isinstance(spec, dict) else component
        ref = relation.get(relation_name)
        return self.surfaces.get(ref) if isinstance(ref, str) else None

    def _choose_label_position(
        self,
        candidates: Iterable[Vec],
        *,
        text_width: float,
        text_height: float,
        rotation: float,
    ) -> tuple[Vec, Box]:
        candidate_list = list(candidates)
        if not candidate_list:
            candidate_list = [Vec(self.width / 2, self.height / 2)]
        for point in candidate_list:
            box = self._text_box(point, text_width, text_height, rotation)
            if not self._box_within_canvas(box, margin=12):
                continue
            if any(box.expanded(7).overlaps(other) for other in self.label_boxes):
                continue
            if any(self._segment_intersects_box(a, b, box.expanded(7)) for a, b in self.vector_segments):
                continue
            return point, box

        # Deterministic fallback search: move the first semantic candidate
        # outwards until neither text nor a vector occupies its real bbox.
        origin = candidate_list[0]
        for radius in (24, 40, 56, 72, 88):
            for dx, dy in ((radius, 0), (-radius, 0), (0, -radius), (0, radius)):
                point = Vec(origin.x + dx, origin.y + dy)
                box = self._text_box(point, text_width, text_height, rotation)
                if not self._box_within_canvas(box, margin=12):
                    continue
                if any(box.expanded(7).overlaps(other) for other in self.label_boxes):
                    continue
                if any(self._segment_intersects_box(a, b, box.expanded(7)) for a, b in self.vector_segments):
                    continue
                return point, box

        point = Vec(
            min(self.width - text_width / 2 - 12, max(text_width / 2 + 12, origin.x)),
            min(self.height - text_height / 2 - 12, max(text_height / 2 + 12, origin.y)),
        )
        return point, self._text_box(point, text_width, text_height, rotation)

    def _render_angle_arc(self, component: dict[str, Any]) -> None:
        between = component.get("between")
        if not (
            isinstance(between, list)
            and len(between) == 2
            and between[1] == "horizontal"
            and isinstance(between[0], str)
        ):
            raise VectorRenderError("V1 angle_arc supports [surface, 'horizontal']")
        surface = self.surfaces.get(between[0])
        if not surface or surface.shape != "incline":
            raise VectorRenderError(f"Missing incline for angle_arc: {between[0]}")

        center = surface.left
        radius = max(28.0, min(36.0, min(self.width, self.height) * 0.055))
        horizontal = center + Vec(radius, 0)
        slope = center + surface.tangent * radius
        path = (
            f"M{horizontal.x:.1f},{horizontal.y:.1f} "
            f"A{radius:.1f},{radius:.1f} 0 0 0 {slope.x:.1f},{slope.y:.1f}"
        )
        component_id = self._id(component)
        self.elements.append(
            f'<path data-component-id="{escape(component_id)}" data-role="angle-arc" '
            f'data-radius="{radius:.1f}" data-center-x="{center.x:.1f}" '
            f'data-center-y="{center.y:.1f}" data-angle-deg="{surface.angle_deg:.1f}" '
            f'd="{path}" fill="none" stroke="#111827" '
            'stroke-width="2.5" stroke-linecap="round"/>'
        )
        mid_angle = math.radians(surface.angle_deg / 2)
        # Середина дуги — семантическая цель подписи угла: именно на неё
        # смотрит выноска на доске, когда подпись увели в сторону.
        self._register(
            component_id,
            {
                "vertex": center,
                "mid": center
                + Vec(math.cos(mid_angle) * radius, -math.sin(mid_angle) * radius),
            },
        )
        label_point = center + Vec(
            math.cos(mid_angle) * (radius + 27),
            -math.sin(mid_angle) * (radius + 27),
        )
        label = component.get("label") or f"{surface.angle_deg:g}°"
        self._text(
            label,
            label_point,
            size=20,
            color="#111827",
            data_role="angle-label",
            data_for=component_id,
        )

    def _render_axis(self, component: dict[str, Any]) -> None:
        if component.get("origin", "center") != "center":
            raise VectorRenderError("V1 axis supports only origin='center'")
        component_id = self._id(component)
        origin = Vec(self.width / 2, self.height / 2)
        x_scale = self.width / 8
        y_scale = self.height / 20
        self.axes[component_id] = {
            "origin": origin,
            "x_scale": x_scale,
            "y_scale": y_scale,
        }
        self._register(component_id, {"center": origin, "origin": origin})
        if component.get("show_grid"):
            for index in range(-3, 4):
                x = origin.x + index * x_scale
                y = origin.y + index * y_scale
                self.elements.append(self._line(Vec(x, 40), Vec(x, self.height - 40), color=_GRID, width=1))
                self.elements.append(self._line(Vec(40, y), Vec(self.width - 40, y), color=_GRID, width=1))
        self.elements.append(
            self._line(
                Vec(40, origin.y),
                Vec(self.width - 50, origin.y),
                color=_INK,
                width=3,
                marker_id="arrow-dark",
                data_role="axis",
                data_component_id=component_id,
            )
        )
        self.elements.append(
            self._line(
                Vec(origin.x, self.height - 40),
                Vec(origin.x, 50),
                color=_INK,
                width=3,
                marker_id="arrow-dark",
                data_role="axis",
                data_component_id=component_id,
            )
        )
        self._text(component.get("x_label", "x"), Vec(self.width - 36, origin.y + 26), size=22)
        self._text(component.get("y_label", "y"), Vec(origin.x + 26, 56), size=22)

    def _render_curve(self, component: dict[str, Any]) -> None:
        shape = component.get("shape")
        if shape not in _CURVE_SHAPES:
            raise VectorRenderError(f"Unsupported curve shape: {shape}")
        axis = self.axes.get(component.get("coordinate_system"))
        if not axis:
            raise VectorRenderError(f"Missing coordinate system: {component.get('coordinate_system')}")
        domain = component.get("domain")
        if not (
            isinstance(domain, list)
            and len(domain) == 2
            and all(isinstance(value, (int, float)) for value in domain)
        ):
            raise VectorRenderError("curve.domain must be [min, max]")
        start_x, end_x = float(domain[0]), float(domain[1])
        if start_x >= end_x:
            raise VectorRenderError("curve.domain must be increasing")
        parameters = component.get("parameters") or {}
        if not isinstance(parameters, dict):
            raise VectorRenderError("curve.parameters must be an object")

        segments: list[str] = []
        for index in range(121):
            x = start_x + (end_x - start_x) * index / 120
            y = self._curve_y(shape, x, parameters)
            point = self._math_to_svg(axis, x, y)
            segments.append(("M" if index == 0 else "L") + f"{point.x:.2f},{point.y:.2f}")
        component_id = self._id(component)
        self.elements.append(
            f'<path data-component-id="{escape(component_id)}" data-role="curve" '
            f'd="{" ".join(segments)}" fill="none" stroke="#2563EB" '
            'stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
        )
        if component.get("label"):
            label_x = start_x + (end_x - start_x) * 0.78
            label_y = self._curve_y(shape, label_x, parameters)
            self._text(
                component["label"],
                self._math_to_svg(axis, label_x, label_y) + Vec(20, -18),
                size=22,
                data_role="curve-label",
                data_for=component_id,
            )

    @staticmethod
    def _curve_y(shape: str, x: float, parameters: dict[str, Any]) -> float:
        if shape == "line":
            return float(parameters.get("m", 1)) * x + float(parameters.get("b", 0))
        if shape == "parabola":
            a = float(parameters.get("a", 1))
            h = float(parameters.get("h", 0))
            k = float(parameters.get("k", 0))
            return a * (x - h) ** 2 + k
        a = float(parameters.get("a", 1))
        b = float(parameters.get("b", 1))
        h = float(parameters.get("h", 0))
        k = float(parameters.get("k", 0))
        return max(-8.0, min(8.0, a * math.exp(b * (x - h)) + k))

    @staticmethod
    def _math_to_svg(axis: dict[str, Any], x: float, y: float) -> Vec:
        origin = axis["origin"]
        return Vec(
            origin.x + x * axis["x_scale"],
            origin.y - y * axis["y_scale"],
        )

    def _render_label(self, component: dict[str, Any]) -> None:
        reference = component.get("attach_to") or component.get("target")
        point = self._anchor(reference)
        placement = component.get("placement", "center")
        if placement not in _PLACEMENTS:
            raise VectorRenderError(f"Unsupported label placement: {placement}")
        offset = {
            "above": Vec(0, -34),
            "below": Vec(0, 38),
            "left": Vec(-48, 0),
            "right": Vec(48, 0),
            "center": Vec(0, 0),
        }[placement]
        self._text(
            component.get("text") or component.get("label") or "",
            point + offset,
            size=22,
            data_role="label",
            data_for=self._id(component),
        )

    def _render_dimension_line(self, component: dict[str, Any]) -> None:
        start = self._anchor(component.get("from"))
        end = self._anchor(component.get("to"))
        component_id = self._id(component)
        self.elements.append(
            self._line(
                start,
                end,
                color=_INK,
                width=2.5,
                data_role="dimension-line",
                data_component_id=component_id,
            )
        )
        direction = (end - start).unit()
        normal = Vec(-direction.y, direction.x)
        tick = 8
        self.elements.append(self._line(start - normal * tick, start + normal * tick, color=_INK, width=2.5))
        self.elements.append(self._line(end - normal * tick, end + normal * tick, color=_INK, width=2.5))
        if component.get("label"):
            self._text(
                component["label"],
                start + (end - start) * 0.5 + normal * 18,
                size=20,
                data_role="dimension-label",
                data_for=component_id,
            )

    def _render_connector(self, component: dict[str, Any]) -> None:
        kind = component.get("kind")
        if kind not in _CONNECTOR_KINDS:
            raise VectorRenderError(f"Unsupported connector kind: {kind}")
        start = self._anchor(component.get("from"))
        end = self._anchor(component.get("to"))
        component_id = self._id(component)

        # Трос через шкив: два прямых участка по касательным плюс дуга по ободу.
        # Без этого трос шёл бы ПРЯМОЙ сквозь колесо и ось.
        over_id = component.get("over")
        if isinstance(over_id, str):
            pulley = self.pulleys.get(over_id)
            if pulley is None:
                raise VectorRenderError(f"Missing pulley: {over_id}")
            if kind == "spring":
                raise VectorRenderError("A spring cannot be routed over a pulley")
            center, radius = pulley
            path, tangents = rope_over_wheel(start, end, center, radius)
            self.elements.append(
                f'<path data-component-id="{escape(component_id)}" data-role="connector" '
                f'd="{path}" fill="none" stroke="{_INK}" stroke-width="4" '
                'stroke-linejoin="round" stroke-linecap="round"/>'
            )
            # Якоря и «участок» троса — от тела до первой точки касания: именно
            # вдоль него направлено натяжение, приложенное к телу.
            self.connector_segments[component_id] = (start, tangents[0])
            self._register(
                component_id,
                {
                    "start": start,
                    "mid": start + (tangents[0] - start) * 0.5,
                    "end": end,
                    "tangent_start": tangents[0],
                    "tangent_end": tangents[1],
                },
            )
            self._render_connector_label(component, component_id, start, tangents[0])
            return

        if kind == "spring":
            path = self._spring_path(start, end)
            self.elements.append(
                f'<path data-component-id="{escape(component_id)}" data-role="connector" '
                f'd="{path}" fill="none" stroke="{_INK}" stroke-width="4" '
                'stroke-linejoin="round" stroke-linecap="round"/>'
            )
        else:
            self.elements.append(
                self._line(
                    start,
                    end,
                    color=_INK,
                    width=4,
                    data_role="connector",
                    data_component_id=component_id,
                )
            )
        # Якоря троса/пружины. Раньше `_register` здесь не вызывался вовсе,
        # поэтому к соединению нельзя было прицепить ни вектор, ни подпись —
        # именно из-за этого натяжение было невыразимо в DSL.
        self.connector_segments[component_id] = (start, end)
        self._register(
            component_id,
            {
                "start": start,
                "mid": start + (end - start) * 0.5,
                "end": end,
            },
        )
        self._render_connector_label(component, component_id, start, end)

    def _render_connector_label(
        self,
        component: dict[str, Any],
        component_id: str,
        start: Vec,
        end: Vec,
    ) -> None:
        if not component.get("label"):
            return
        self._text(
            component["label"],
            start + (end - start) * 0.5 + Vec(0, -24),
            size=22,
            data_role="connector-label",
            data_for=component_id,
        )

    @staticmethod
    def _spring_path(start: Vec, end: Vec) -> str:
        delta = end - start
        tangent = delta.unit()
        normal = Vec(-tangent.y, tangent.x)
        total_length = math.hypot(delta.x, delta.y)
        lead = min(18.0, total_length * 0.16)
        usable = max(0.0, total_length - lead * 2)
        points = [start, start + tangent * lead]
        for index in range(1, 9):
            base = start + tangent * (lead + usable * index / 9)
            points.append(base + normal * (12 if index % 2 else -12))
        points.extend([end - tangent * lead, end])
        return " ".join(
            ("M" if index == 0 else "L") + f"{point.x:.1f},{point.y:.1f}"
            for index, point in enumerate(points)
        )

    def _render_trajectory(self, component: dict[str, Any]) -> None:
        shape = component.get("shape")
        if shape not in _TRAJECTORY_SHAPES:
            raise VectorRenderError(f"Unsupported trajectory shape: {shape}")
        start = self._anchor(component.get("from"))
        direction = str(component.get("direction", "up_right"))
        component_id = self._id(component)
        if shape == "projectile":
            dx = self.width * (0.22 if direction.endswith("right") else -0.22)
            end = start + Vec(dx, self.height * 0.08)
            control = start + Vec(dx * 0.48, -self.height * 0.23)
            path = (
                f"M{start.x:.1f},{start.y:.1f} "
                f"Q{control.x:.1f},{control.y:.1f} {end.x:.1f},{end.y:.1f}"
            )
        elif shape == "circular":
            radius = min(self.width, self.height) * 0.13
            path = (
                f"M{start.x:.1f},{start.y:.1f} "
                f"A{radius:.1f},{radius:.1f} 0 1 1 {start.x + 0.1:.1f},{start.y:.1f}"
            )
        else:
            end = start + Vec(self.width * 0.18, -self.height * 0.10 if shape == "straight" else 0)
            path = f"M{start.x:.1f},{start.y:.1f} L{end.x:.1f},{end.y:.1f}"
        self.elements.append(
            f'<path data-component-id="{escape(component_id)}" data-role="trajectory" '
            f'd="{path}" fill="none" stroke="{_INK}" stroke-width="3" '
            'stroke-dasharray="10 8" marker-end="url(#arrow-dark)"/>'
        )
        if component.get("label"):
            self._text(
                component["label"],
                start + Vec(self.width * 0.10, -self.height * 0.15),
                size=20,
                data_role="trajectory-label",
                data_for=component_id,
            )

    def _register(self, component_id: str, anchors: dict[str, Vec]) -> None:
        for name, point in anchors.items():
            self.anchors[f"{component_id}.{name}"] = point

    def _anchor(self, reference: Any) -> Vec:
        if not isinstance(reference, str) or reference not in self.anchors:
            raise VectorRenderError(f"Missing anchor: {reference}")
        return self.anchors[reference]

    # ──────────────────────────────────────────────────────────────
    # Подписи наружу: пиксели холста → проценты картинки
    # ──────────────────────────────────────────────────────────────
    # Фронтенд (IllustrationRenderer) держит подписи отдельным DOM-слоем и
    # ждёт проценты 0–100 плюс `arrow_to` — семантическую цель, к которой
    # подпись остаётся привязана, куда бы её ни утащили мышью.

    # data_role из _text → target_kind фронтенда; остальное — "region".
    _LABEL_TARGET_KINDS = {
        "vector-label": "vector",
        "angle-label": "angle",
        "body-label": "object",
        "surface-label": "object",
    }

    # Какой anchor считать целью подписи. Для вектора это СЕРЕДИНА ДРЕВКА, а не
    # центр тела и не наконечник: выноска в центр тела читается как ещё одна
    # сила, а в наконечник — как продолжение стрелки.
    _LABEL_ANCHOR_NAMES = {"vector": "mid", "angle": "mid", "object": "center"}

    def _labels_as_percent(self) -> list[dict[str, Any]]:
        labels: list[dict[str, Any]] = []
        for collected in self.collected_labels:
            kind = self._LABEL_TARGET_KINDS.get(collected["role"], "region")
            point: Vec = collected["point"]
            anchor = self._label_anchor(collected["component_id"], kind) or point
            labels.append(
                {
                    "content": collected["text"],
                    "target_kind": kind,
                    "x": self._to_percent(point.x, self.width),
                    "y": self._to_percent(point.y, self.height),
                    "arrow_to": {
                        "x": self._to_percent(anchor.x, self.width),
                        "y": self._to_percent(anchor.y, self.height),
                    },
                }
            )
        return labels

    def _label_anchor(self, component_id: str | None, kind: str) -> Vec | None:
        anchor_name = self._LABEL_ANCHOR_NAMES.get(kind)
        if not component_id or not anchor_name:
            return None
        return self.anchors.get(f"{component_id}.{anchor_name}")

    @staticmethod
    def _to_percent(value: float, extent: float) -> float:
        if extent <= 0:
            return 0.0
        return round(max(0.0, min(100.0, value / extent * 100)), 1)

    @staticmethod
    def _id(component: dict[str, Any]) -> str:
        component_id = component.get("id")
        if not isinstance(component_id, str) or not component_id:
            raise VectorRenderError("Every component must have an id")
        return component_id

    @staticmethod
    def _line(
        start: Vec,
        end: Vec,
        *,
        color: str,
        width: float,
        marker_id: str | None = None,
        data_role: str | None = None,
        data_component_id: str | None = None,
        extra_attrs: dict[str, str] | None = None,
    ) -> str:
        # Keep coordinate attributes first for backward-compatible consumers
        # that parse this safe SVG subset without a full XML DOM.
        attrs: list[str] = [
            f'x1="{start.x:.1f}"',
            f'y1="{start.y:.1f}"',
            f'x2="{end.x:.1f}"',
            f'y2="{end.y:.1f}"',
        ]
        if data_component_id:
            attrs.append(f'data-component-id="{escape(data_component_id)}"')
        if data_role:
            attrs.append(f'data-role="{escape(data_role)}"')
        if extra_attrs:
            attrs.extend(f'{escape(key)}="{escape(value)}"' for key, value in extra_attrs.items())
        attrs.extend(
            [
                f'stroke="{color}"',
                f'stroke-width="{width:g}"',
                'stroke-linecap="round"',
            ]
        )
        if marker_id:
            attrs.append(f'marker-end="url(#{marker_id})"')
        return f'<line {" ".join(attrs)}/>'

    def _text(
        self,
        text: Any,
        point: Vec,
        *,
        size: int = 20,
        color: str = "#111827",
        rotation: float = 0,
        data_role: str | None = None,
        data_for: str | None = None,
        known_box: Box | None = None,
    ) -> None:
        value = str(text)
        width = self._estimate_text_width(value, size)
        box = known_box or self._text_box(point, width, size * 1.25, rotation)

        # Единственная точка, через которую проходит ВЕСЬ текст рендерера,
        # поэтому и перехват тут один. Копим всегда: в geometry-only режиме это
        # единственный выход подписей наружу, а в обычном — не мешает.
        self.collected_labels.append(
            {
                "text": value,
                "point": point,
                "box": box,
                "role": data_role or "label",
                "component_id": data_for,
                "color": color,
            }
        )
        if not self.emit_text:
            return

        attrs = [
            f'x="{point.x:.1f}"',
            f'y="{point.y:.1f}"',
            'font-family="Inter, Arial, sans-serif"',
            f'font-size="{size}"',
            'font-weight="500"',
            'text-anchor="middle"',
            'dominant-baseline="middle"',
            f'fill="{color}"',
            f'data-bbox="{box.left:.1f},{box.top:.1f},{box.right:.1f},{box.bottom:.1f}"',
        ]
        if data_role:
            attrs.append(f'data-role="{escape(data_role)}"')
        if data_for:
            attrs.append(f'data-for="{escape(data_for)}"')
        if abs(rotation) > 0.01:
            attrs.append(f'transform="rotate({rotation:.1f} {point.x:.1f} {point.y:.1f})"')
        self.elements.append(f'<text {" ".join(attrs)}>{escape(value)}</text>')

    @staticmethod
    def _estimate_text_width(text: str, size: float) -> float:
        visible = re.sub(r"\\[A-Za-z]+", "mm", text.replace("$", ""))
        return max(size * 1.4, min(size * 18, len(visible) * size * 0.56))

    @staticmethod
    def _rotated_height(width: float, height: float, angle_deg: float) -> float:
        angle = math.radians(angle_deg)
        return abs(width * math.sin(angle)) + abs(height * math.cos(angle))

    @staticmethod
    def _text_box(center: Vec, width: float, height: float, angle_deg: float) -> Box:
        angle = math.radians(angle_deg)
        rotated_width = abs(width * math.cos(angle)) + abs(height * math.sin(angle))
        rotated_height = abs(width * math.sin(angle)) + abs(height * math.cos(angle))
        return Box(
            center.x - rotated_width / 2,
            center.y - rotated_height / 2,
            center.x + rotated_width / 2,
            center.y + rotated_height / 2,
        )

    def _box_within_canvas(self, box: Box, margin: float) -> bool:
        return (
            box.left >= margin
            and box.top >= margin
            and box.right <= self.width - margin
            and box.bottom <= self.height - margin
        )

    @staticmethod
    def _segment_intersects_box(start: Vec, end: Vec, box: Box) -> bool:
        # Liang-Barsky clipping: a non-empty clipped interval means the segment
        # reaches the rectangle occupied by the rendered text.
        dx = end.x - start.x
        dy = end.y - start.y
        p = (-dx, dx, -dy, dy)
        q = (
            start.x - box.left,
            box.right - start.x,
            start.y - box.top,
            box.bottom - start.y,
        )
        lower, upper = 0.0, 1.0
        for pi, qi in zip(p, q):
            if abs(pi) <= 1e-9:
                if qi < 0:
                    return False
                continue
            ratio = qi / pi
            if pi < 0:
                lower = max(lower, ratio)
            else:
                upper = min(upper, ratio)
            if lower > upper:
                return False
        return True


def svg_to_png_bytes(svg: str) -> bytes:
    """
    Convert generated SVG to PNG behind a small replaceable boundary.

    CairoSVG is preferred when the project adds it later.  The current repo
    already depends on OpenCV, so a deterministic safe-subset fallback keeps
    the prototype testable without another native dependency.
    """

    try:
        import cairosvg  # type: ignore[import-not-found]

        return cairosvg.svg2png(bytestring=svg.encode("utf-8"))
    except Exception:
        # Не только ImportError: cairosvg — обёртка над НАТИВНОЙ libcairo, и
        # пакет ставится отдельно от неё. На машине без libcairo импорт падает
        # с OSError («no library called "cairo-2" was found»), а на битом SVG —
        # чем угодно ещё. Любой отказ должен ронять нас в OpenCV-fallback, а не
        # в 500: детерминированный PNG и есть источник истины.
        return _svg_to_png_with_opencv(svg)


def _svg_to_png_with_opencv(svg: str) -> bytes:
    import cv2
    import numpy as np

    root = ET.fromstring(svg)
    width = int(float(root.attrib.get("width", "1024")))
    height = int(float(root.attrib.get("height", "576")))
    image = np.full((height, width, 3), 255, dtype=np.uint8)

    def bgr(color: str | None) -> tuple[int, int, int]:
        palette = {
            _INK.lower(): (70, 55, 36),
            _SURFACE_FILL.lower(): (235, 231, 229),
            _BLOCK_FILL.lower(): (173, 153, 130),
            _WEIGHT_BLUE.lower(): (235, 99, 37),
            _NORMAL_GREEN.lower(): (50, 125, 46),
            _FRICTION_RED.lower(): (53, 61, 196),
            "#111827": (39, 24, 17),
            "#64748b": (139, 116, 100),
            "black": (0, 0, 0),
            "white": (255, 255, 255),
        }
        return palette.get((color or _INK).lower(), (70, 55, 36))

    for element in root.iter():
        tag = element.tag.rsplit("}", 1)[-1]
        if tag == "polygon":
            pairs = [pair.split(",") for pair in element.attrib.get("points", "").split()]
            points = np.array(
                [[int(round(float(x))), int(round(float(y)))] for x, y in pairs],
                dtype=np.int32,
            )
            if len(points) >= 3:
                cv2.fillPoly(image, [points], bgr(element.attrib.get("fill")), cv2.LINE_AA)
                cv2.polylines(
                    image,
                    [points],
                    True,
                    bgr(element.attrib.get("stroke")),
                    max(1, int(float(element.attrib.get("stroke-width", "1")))),
                    cv2.LINE_AA,
                )
        elif tag == "circle":
            center = (
                int(round(float(element.attrib["cx"]))),
                int(round(float(element.attrib["cy"]))),
            )
            radius = int(round(float(element.attrib["r"])))
            cv2.circle(image, center, radius, bgr(element.attrib.get("fill")), -1, cv2.LINE_AA)
            cv2.circle(
                image,
                center,
                radius,
                bgr(element.attrib.get("stroke")),
                max(1, int(float(element.attrib.get("stroke-width", "1")))),
                cv2.LINE_AA,
            )
        elif tag == "line":
            start = (
                int(round(float(element.attrib["x1"]))),
                int(round(float(element.attrib["y1"]))),
            )
            end = (
                int(round(float(element.attrib["x2"]))),
                int(round(float(element.attrib["y2"]))),
            )
            color = bgr(element.attrib.get("stroke"))
            stroke_width = max(1, int(float(element.attrib.get("stroke-width", "1"))))
            cv2.line(image, start, end, color, stroke_width, cv2.LINE_AA)
            if "marker-end" in element.attrib:
                dx, dy = end[0] - start[0], end[1] - start[1]
                length = math.hypot(dx, dy) or 1
                ux, uy = dx / length, dy / length
                nx, ny = -uy, ux
                arrow = np.array(
                    [
                        end,
                        (
                            int(round(end[0] - ux * 13 + nx * 6)),
                            int(round(end[1] - uy * 13 + ny * 6)),
                        ),
                        (
                            int(round(end[0] - ux * 13 - nx * 6)),
                            int(round(end[1] - uy * 13 - ny * 6)),
                        ),
                    ],
                    dtype=np.int32,
                )
                cv2.fillPoly(image, [arrow], color, cv2.LINE_AA)
        elif tag == "path" and element.attrib.get("data-role") == "angle-arc":
            center = (
                int(round(float(element.attrib["data-center-x"]))),
                int(round(float(element.attrib["data-center-y"]))),
            )
            radius = int(round(float(element.attrib["data-radius"])))
            angle = float(element.attrib["data-angle-deg"])
            cv2.ellipse(
                image,
                center,
                (radius, radius),
                0,
                360 - angle,
                360,
                bgr(element.attrib.get("stroke")),
                max(1, int(float(element.attrib.get("stroke-width", "2")))),
                cv2.LINE_AA,
            )
        elif tag == "path" and element.attrib.get("data-role") not in {None, ""}:
            points = _path_points(element.attrib.get("d", ""))
            if len(points) >= 2:
                cv2.polylines(
                    image,
                    [np.array(points, dtype=np.int32)],
                    False,
                    bgr(element.attrib.get("stroke")),
                    max(1, int(float(element.attrib.get("stroke-width", "2")))),
                    cv2.LINE_AA,
                )
        elif tag == "text":
            text = "".join(element.itertext())
            if text.isascii():
                position = (
                    int(round(float(element.attrib.get("x", "0")))),
                    int(round(float(element.attrib.get("y", "0")))),
                )
                cv2.putText(
                    image,
                    text,
                    position,
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.65,
                    bgr(element.attrib.get("fill")),
                    1,
                    cv2.LINE_AA,
                )

    encoded_ok, encoded = cv2.imencode(".png", image)
    if not encoded_ok:
        raise VectorRenderError("OpenCV failed to encode deterministic PNG")
    return encoded.tobytes()


def _path_points(path_data: str) -> list[tuple[int, int]]:
    numbers = [float(number) for number in re.findall(r"-?\d+(?:\.\d+)?", path_data)]
    return [
        (int(round(numbers[index])), int(round(numbers[index + 1])))
        for index in range(0, len(numbers) - 1, 2)
    ]


def svg_to_png_data_url(svg: str) -> str:
    png = svg_to_png_bytes(svg)
    return f"data:image/png;base64,{base64.b64encode(png).decode('ascii')}"
