"""
Local image-based portion completeness estimation for food photos.

Gemini identifies the food class and nutrition per 100 g. This module uses
OpenCV to estimate how much of a whole item is visible, then adjusts the
catalog/default weight without calling another paid model.
"""

from __future__ import annotations

from dataclasses import dataclass
import math
import re

import cv2
import numpy as np


@dataclass(frozen=True)
class FoodBaseline:
    identified_class: str
    default_grams: int
    shape: str
    expected_fill_ratio: float


@dataclass(frozen=True)
class PortionEstimate:
    identified_class: str
    default_catalog_weight: int
    completeness_ratio: float
    final_weight: int
    pixel_area: int
    baseline_area: int
    bbox: tuple[int, int, int, int] | None
    confidence: float
    source: str


_BASELINES: list[tuple[tuple[str, ...], FoodBaseline]] = [
    (("bagel", "sesame bagel", "бейгл", "бублик", "публик"), FoodBaseline("bagel", 90, "ring", 0.52)),
    (("donut", "doughnut", "пончик"), FoodBaseline("donut", 65, "ring", 0.54)),
    (("banana", "банан"), FoodBaseline("banana", 120, "elongated", 0.55)),
    (("apple", "яблоко"), FoodBaseline("apple", 180, "round", 0.74)),
    (("orange", "апельсин", "мандарин"), FoodBaseline("citrus", 160, "round", 0.74)),
    (("cookie", "печенье"), FoodBaseline("cookie", 30, "round", 0.72)),
    (("egg", "яйцо"), FoodBaseline("egg", 50, "oval", 0.72)),
    (("bread slice", "toast", "тост", "ломтик хлеба", "кусок хлеба"), FoodBaseline("bread_slice", 35, "rect", 0.78)),
    (("croissant", "круассан"), FoodBaseline("croissant", 70, "crescent", 0.50)),
    (("pizza slice", "кусок пиццы"), FoodBaseline("pizza_slice", 125, "triangle", 0.52)),
    (("pizza", "пицца"), FoodBaseline("pizza", 420, "round", 0.70)),
    (("burger", "бургер"), FoodBaseline("burger", 220, "rect", 0.76)),
    (("sandwich", "сэндвич", "бутерброд"), FoodBaseline("sandwich", 160, "rect", 0.74)),
]


def _normalize_text(value: str) -> str:
    text = (value or "").lower().replace("ё", "е")
    return re.sub(r"[^a-zа-я0-9]+", " ", text).strip()


def resolve_baseline(name: str, identified_class: str = "", model_default_grams: float = 0) -> FoodBaseline:
    """Return a known whole-item baseline, falling back to the model/catalog grams."""

    haystack = f"{_normalize_text(identified_class)} {_normalize_text(name)}"
    for needles, baseline in _BASELINES:
        if any(_normalize_text(needle) in haystack for needle in needles):
            return baseline

    grams = int(round(model_default_grams)) if model_default_grams and model_default_grams > 0 else 100
    safe_class = _normalize_text(identified_class or name).replace(" ", "_") or "food"
    return FoodBaseline(safe_class[:48], max(10, grams), "irregular", 0.62)


def estimate_food_portion(
    image_bytes: bytes,
    *,
    name: str,
    identified_class: str = "",
    model_default_grams: float = 0,
) -> PortionEstimate:
    """
    Estimate visible completeness and final grams for a recognized food item.

    The core signal is actual foreground pixel area divided by the expected
    baseline area for a whole instance of the same class. For round/ring foods
    the expected box is square, so half-visible bagels/cookies/apples are
    penalized even when their observed bounding box is narrow.
    """

    baseline = resolve_baseline(name, identified_class, model_default_grams)
    default_weight = baseline.default_grams

    image = _decode_image(image_bytes)
    if image is None:
        return _fallback_estimate(baseline, "decode_failed")

    resized, scale = _resize_for_analysis(image)
    mask = _foreground_mask(resized)
    measurement = _measure_mask(mask, baseline)
    if measurement is None:
        return _fallback_estimate(baseline, "no_food_mask")

    actual_area, baseline_area, bbox, confidence = measurement
    raw_ratio = actual_area / max(1.0, baseline_area)
    ratio = _clamp(raw_ratio, 0.18, 1.0)
    ratio *= _crop_penalty(bbox, resized.shape[1], resized.shape[0])
    ratio = _clamp(ratio, 0.18, 1.0)

    # Undo the resize for diagnostics exposed to the UI/API.
    scaled_bbox = tuple(int(round(v / scale)) for v in bbox) if scale > 0 else bbox
    pixel_area = int(round(actual_area / (scale * scale))) if scale > 0 else int(actual_area)
    scaled_baseline_area = int(round(baseline_area / (scale * scale))) if scale > 0 else int(baseline_area)

    return PortionEstimate(
        identified_class=baseline.identified_class,
        default_catalog_weight=default_weight,
        completeness_ratio=round(ratio, 2),
        final_weight=_round_grams(default_weight * ratio),
        pixel_area=pixel_area,
        baseline_area=max(1, scaled_baseline_area),
        bbox=scaled_bbox,
        confidence=round(confidence, 2),
        source="opencv_contour",
    )


def _fallback_estimate(baseline: FoodBaseline, source: str) -> PortionEstimate:
    return PortionEstimate(
        identified_class=baseline.identified_class,
        default_catalog_weight=baseline.default_grams,
        completeness_ratio=1.0,
        final_weight=baseline.default_grams,
        pixel_area=0,
        baseline_area=0,
        bbox=None,
        confidence=0.0,
        source=source,
    )


def _decode_image(image_bytes: bytes) -> np.ndarray | None:
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return img if img is not None and img.size else None


def _resize_for_analysis(img: np.ndarray, max_side: int = 768) -> tuple[np.ndarray, float]:
    h, w = img.shape[:2]
    side = max(h, w)
    if side <= max_side:
        return img, 1.0
    scale = max_side / side
    resized = cv2.resize(img, (int(round(w * scale)), int(round(h * scale))), interpolation=cv2.INTER_AREA)
    return resized, scale


def _foreground_mask(img: np.ndarray) -> np.ndarray:
    """Build a food foreground mask using local color/edge cues plus morphology."""

    blurred = cv2.GaussianBlur(img, (5, 5), 0)
    hsv = cv2.cvtColor(blurred, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(blurred, cv2.COLOR_BGR2GRAY)
    saturation = hsv[:, :, 1]

    # Works well for common food-on-table photos and synthetic white backgrounds:
    # food is usually less white and/or more saturated than the plate/background.
    mask = np.zeros(gray.shape, dtype=np.uint8)
    mask[((gray < 238) & (saturation > 18)) | (gray < 205) | (saturation > 48)] = 255

    # Remove tiny camera noise, close sesame/crumb holes, keep object silhouette.
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)

    if _mask_is_plausible(mask):
        return mask

    grabcut = _grabcut_mask(img)
    if grabcut is not None and _mask_is_plausible(grabcut):
        return grabcut

    return mask


def _mask_is_plausible(mask: np.ndarray) -> bool:
    area = cv2.countNonZero(mask)
    total = mask.shape[0] * mask.shape[1]
    return total > 0 and 0.008 <= area / total <= 0.78


def _grabcut_mask(img: np.ndarray) -> np.ndarray | None:
    h, w = img.shape[:2]
    if h < 24 or w < 24:
        return None
    rect = (max(1, int(w * 0.05)), max(1, int(h * 0.05)), max(2, int(w * 0.90)), max(2, int(h * 0.90)))
    mask = np.zeros((h, w), np.uint8)
    bgd = np.zeros((1, 65), np.float64)
    fgd = np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(img, mask, rect, bgd, fgd, 3, cv2.GC_INIT_WITH_RECT)
    except cv2.error:
        return None
    out = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype("uint8")
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    return cv2.morphologyEx(out, cv2.MORPH_CLOSE, kernel, iterations=1)


def _measure_mask(mask: np.ndarray, baseline: FoodBaseline) -> tuple[float, float, tuple[int, int, int, int], float] | None:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contours = [c for c in contours if cv2.contourArea(c) >= mask.shape[0] * mask.shape[1] * 0.003]
    if not contours:
        return None

    largest = max(contours, key=cv2.contourArea)
    x, y, w, h = cv2.boundingRect(largest)
    if w <= 2 or h <= 2:
        return None

    roi = mask[y : y + h, x : x + w]
    actual_area = float(cv2.countNonZero(roi))
    if actual_area <= 0:
        return None

    expected_bbox_area = _expected_bbox_area(w, h, baseline.shape)
    baseline_area = expected_bbox_area * baseline.expected_fill_ratio
    observed_bbox_area = max(1, w * h)
    observed_fill = actual_area / observed_bbox_area
    confidence = _clamp(0.45 + observed_fill * 0.6, 0.0, 1.0)
    return actual_area, max(1.0, baseline_area), (x, y, w, h), confidence


def _expected_bbox_area(width: int, height: int, shape: str) -> float:
    if shape in {"round", "ring"}:
        side = max(width, height)
        return float(side * side)
    if shape == "oval":
        return float(width * height)
    if shape == "triangle":
        return float(width * height)
    if shape == "crescent":
        side = max(width, height)
        return float(side * side)
    return float(width * height)


def _crop_penalty(bbox: tuple[int, int, int, int], img_w: int, img_h: int) -> float:
    x, y, w, h = bbox
    margin = 2
    touches = int(x <= margin) + int(y <= margin) + int(x + w >= img_w - margin) + int(y + h >= img_h - margin)
    if touches <= 0:
        return 1.0
    return max(0.72, 1.0 - touches * 0.08)


def _round_grams(value: float) -> int:
    if not math.isfinite(value) or value <= 0:
        return 1
    if value < 20:
        return max(1, int(round(value)))
    return max(5, int(round(value / 5) * 5))


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))
