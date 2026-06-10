import type { Stroke, BoundingBox, Point } from "./types";
import type { Camera } from "@/stores/whiteboard";

// ----- Coordinate Transform Helpers -----

/**
 * Convert screen-space pixel coordinates to absolute canvas-space coordinates.
 * Used when recording pointer input (strokes) — stores position independent of camera.
 */
export function screenToCanvas(screenX: number, screenY: number, camera: Camera) {
  return {
    x: (screenX + camera.x) / camera.zoom,
    y: (screenY + camera.y) / camera.zoom,
  };
}

/**
 * Convert absolute canvas-space coordinates to screen-space pixel coordinates.
 * Used when rendering elements — maps stored positions back to viewport.
 */
export function canvasToScreen(canvasX: number, canvasY: number, camera: Camera) {
  return {
    x: canvasX * camera.zoom - camera.x,
    y: canvasY * camera.zoom - camera.y,
  };
}

// ----- Geometry Utilities -----

/**
 * Compute the minimal axis-aligned bounding box that encloses all given strokes.
 * Returns null when strokes contain no points.
 */
export function computeBoundingBox(strokes: Stroke[]): BoundingBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of strokes) {
    for (const p of stroke.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  if (!isFinite(minX)) return null;

  // Add a small padding so strokes aren't clipped at the boundary
  const pad = 10;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX += pad;
  maxY += pad;

  return {
    x: Math.floor(minX),
    y: Math.floor(minY),
    width: Math.ceil(maxX - minX),
    height: Math.ceil(maxY - minY),
  };
}

/**
 * Crop a rectangular region from a canvas and return a Base64 PNG string.
 */
export function cropCanvasToBase64(
  canvas: HTMLCanvasElement,
  box: BoundingBox
): string {
  const offscreen = document.createElement("canvas");
  offscreen.width = box.width;
  offscreen.height = box.height;

  const ctx = offscreen.getContext("2d");
  if (!ctx) return "";

  ctx.drawImage(
    canvas,
    box.x,
    box.y,
    box.width,
    box.height,
    0,
    0,
    box.width,
    box.height
  );

  return offscreen.toDataURL("image/png");
}

/**
 * Render a single stroke onto a 2D canvas context using quadratic Bézier
 * curves for smooth interpolation.
 */
export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const { points, color, lineWidth } = stroke;
  if (points.length === 0) return;

  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();

  if (points.length === 1) {
    // Single dot
    ctx.arc(points[0].x, points[0].y, lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    return;
  }

  if (points.length === 2) {
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    ctx.stroke();
    return;
  }

  // Smooth path via midpoint quadratic Bézier curves
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
  }

  // Connect the last two points
  const last = points[points.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

/**
 * Pressure-aware line width multiplier.
 * Maps [0..1] pressure to [0.4..1.6] range for natural stylus feel.
 */
export function pressureWidth(base: number, pressure: number): number {
  const normalized = Math.max(0.1, Math.min(1, pressure));
  return base * (0.4 + normalized * 1.2);
}

/** Generate a simple unique ID for strokes */
export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
