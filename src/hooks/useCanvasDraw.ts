import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import type {
  Stroke,
  Point,
  BoundingBox,
  CropResult,
} from "../components/whiteboard/types";
import {
  AUTO_INK,
  drawStroke,
  resolveInk,
  screenToCanvas,
  uid,
} from "../components/whiteboard/utils";
import {
  nextWhiteboardHistorySequence,
  useWhiteboardStore,
} from "@/stores/whiteboard";

// ─── Constants ──────────────────────────────────────────
const DEBOUNCE_MS = 1500;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

// ─── Helpers ────────────────────────────────────────────

/** Compute axis-aligned bounding box for strokes (canvas-space) */
function computeBoundingBox(strokes: Stroke[]): BoundingBox | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const s of strokes) {
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  if (!isFinite(minX)) return null;

  const pad = 16;
  return {
    x: Math.floor(minX - pad),
    y: Math.floor(minY - pad),
    width: Math.ceil(maxX - minX + pad * 2),
    height: Math.ceil(maxY - minY + pad * 2),
  };
}

/** Render strokes to offscreen canvas → base64 PNG */
function renderStrokesToBase64(strokes: Stroke[], box: BoundingBox): string {
  const offscreen = document.createElement("canvas");
  offscreen.width = box.width;
  offscreen.height = box.height;
  const ctx = offscreen.getContext("2d");
  if (!ctx) return "";
  
  // Fill white background for optimal OCR contrast
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, box.width, box.height);
  
  ctx.translate(-box.x, -box.y);
  for (const s of strokes) {
    // Force stroke color to black for OCR, and make lines thicker so OCR can read them better
    // Often 3px lines on a 500px image are too thin for the text detector
    drawStroke(ctx, { ...s, color: "#000000", lineWidth: Math.max(8, s.lineWidth * 3) });
  }
  return offscreen.toDataURL("image/png");
}

// ─── Hook ───────────────────────────────────────────────

export interface UseCanvasDrawReturn {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  strokes: Stroke[];
  strokeColor: string;
  lineWidth: number;
  lastStrokeHistorySequence: number;
  handlePointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  handlePointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  handlePointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  attachZoomListeners: (container: HTMLElement) => () => void;
  clearCanvas: (historySequence?: number) => void;
  undo: () => void;
  setStrokeColor: (color: string) => void;
  setLineWidth: (width: number) => void;
  getCrop: () => string | null;
}

export function useCanvasDraw(
  onCrop?: (result: CropResult) => void,
  forceLightCanvas = false,
): UseCanvasDrawReturn {
  const canvasRef = useRef<HTMLCanvasElement>(null!);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStrokes = useRef<Stroke[]>([]);

  // Use useState (exactly like old working hook)
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [strokeHistory, setStrokeHistory] = useState<
    Array<{ strokes: Stroke[]; sequence: number }>
  >([]);
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  // Дефолт — «авточернила»: тёмные на светлой теме, светлые на тёмной.
  // Раньше был жёсткий #ffffff, и на светлом холсте штрихи были невидимы.
  const [strokeColor, setStrokeColor] = useState(AUTO_INK);
  const [lineWidth, setLineWidth] = useState(3);

  // Camera from Zustand store
  const camera = useWhiteboardStore((s) => s.camera);

  // Тема нужна для резолва AUTO_INK в момент отрисовки; смена темы
  // перерисовывает холст (ink в зависимостях redraw).
  const { resolvedTheme } = useTheme();
  const ink = resolveInk(forceLightCanvas ? false : resolvedTheme === "dark");

  // ── Canvas rendering ──
  const redraw = useCallback(
    (allStrokes: Stroke[], active: Stroke | null) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();

      // Apply camera transform (pan + zoom)
      ctx.translate(-camera.x, -camera.y);
      ctx.scale(camera.zoom, camera.zoom);

      for (const s of allStrokes) drawStroke(ctx, s, ink);
      if (active) drawStroke(ctx, active, ink);

      ctx.restore();
    },
    [camera, ink]
  );

  // Redraw when strokes or camera change
  useEffect(() => {
    redraw(strokes, currentStroke);
  }, [strokes, currentStroke, camera, redraw]);

  const strokesRef = useRef<Stroke[]>([]);
  const strokeHistoryRef = useRef<Array<{ strokes: Stroke[]; sequence: number }>>([]);
  useEffect(() => {
    strokesRef.current = strokes;
  }, [strokes]);

  // ── Debounced crop ──
  const scheduleCrop = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    debounceTimer.current = setTimeout(() => {
      const currentAllStrokes = strokesRef.current;
      if (currentAllStrokes.length === 0) return;

      const box = computeBoundingBox(currentAllStrokes);
      if (!box) return;

      // Render ALL strokes to offscreen canvas
      const base64 = renderStrokesToBase64(currentAllStrokes, box);

      console.log("🖼️ Whiteboard crop result", {
        boundingBox: box,
        base64: base64.slice(0, 120) + "…",
      });

      onCrop?.({ boundingBox: box, base64 });
      
      // We don't need pendingStrokes anymore for cropping, but keep it if needed elsewhere
      pendingStrokes.current = [];
    }, DEBOUNCE_MS);
  }, [onCrop]);

  // Synchronous crop getter for manual trigger
  const getCrop = useCallback((): string | null => {
    const currentAllStrokes = strokesRef.current;
    if (currentAllStrokes.length === 0) return null;
    const box = computeBoundingBox(currentAllStrokes);
    if (!box) return null;
    return renderStrokesToBase64(currentAllStrokes, box);
  }, []);

  // ── Point extraction ──
  const getPoint = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): Point => {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      const sx = (e.clientX - rect.left) * scaleX;
      const sy = (e.clientY - rect.top) * scaleY;

      const canvasPos = screenToCanvas(sx, sy, camera);

      return {
        x: canvasPos.x,
        y: canvasPos.y,
        pressure: e.pressure || 0.5,
      };
    },
    [camera]
  );

  // ── Pointer handlers ──
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      // Only left button / touch
      if (e.button !== 0) return;

      e.preventDefault();
      (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);

      if (debounceTimer.current) clearTimeout(debounceTimer.current);

      const point = getPoint(e);
      const stroke: Stroke = {
        id: uid(),
        points: [point],
        color: strokeColor,
        lineWidth,
      };

      setCurrentStroke(stroke);
      setIsDrawing(true);
    },
    [getPoint, strokeColor, lineWidth]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isDrawing || !currentStroke) return;
      e.preventDefault();

      const point = getPoint(e);
      const updated: Stroke = {
        ...currentStroke,
        points: [...currentStroke.points, point],
      };

      setCurrentStroke(updated);
    },
    [isDrawing, currentStroke, getPoint]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!currentStroke) return;
      e.preventDefault();

      const previousStrokes = strokesRef.current;
      const nextStrokes = [...previousStrokes, currentStroke];
      const nextHistory = [
        ...strokeHistoryRef.current,
        {
          strokes: previousStrokes,
          sequence: nextWhiteboardHistorySequence(),
        },
      ].slice(-80);

      strokesRef.current = nextStrokes;
      strokeHistoryRef.current = nextHistory;
      pendingStrokes.current.push(currentStroke);
      setStrokes(nextStrokes);
      setStrokeHistory(nextHistory);

      setCurrentStroke(null);
      setIsDrawing(false);
      scheduleCrop();
    },
    [currentStroke, scheduleCrop]
  );

  // ── Zoom (Ctrl+wheel / pinch-to-zoom) ──
  const attachZoomListeners = useCallback(
    (container: HTMLElement) => {
      const onWheel = (e: WheelEvent) => {
        // Only handle Ctrl+wheel or trackpad pinch (ctrlKey is set by pinch)
        if (!e.ctrlKey && !e.metaKey) return;

        e.preventDefault();

        const cam = useWhiteboardStore.getState().camera;
        const rect = container.getBoundingClientRect();

        // Cursor position relative to container
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;

        // Zoom factor
        const delta = -e.deltaY;
        const factor = 1 + delta * 0.005;
        const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor));
        const scale = newZoom / cam.zoom;

        // Zoom toward cursor: adjust camera so cursor position stays fixed
        const newCamX = cursorX * (scale - 1) + cam.x * scale;
        const newCamY = cursorY * (scale - 1) + cam.y * scale;

        useWhiteboardStore.getState().setCamera(newCamX, newCamY, newZoom);
      };

      container.addEventListener("wheel", onWheel, { passive: false });
      return () => {
        container.removeEventListener("wheel", onWheel);
      };
    },
    []
  );

  // ── Actions ──
  const clearCanvas = useCallback((historySequence?: number) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    pendingStrokes.current = [];
    const previousStrokes = strokesRef.current;
    if (previousStrokes.length > 0) {
      const nextHistory = [
        ...strokeHistoryRef.current,
        {
          strokes: previousStrokes,
          sequence: historySequence ?? nextWhiteboardHistorySequence(),
        },
      ].slice(-80);
      strokeHistoryRef.current = nextHistory;
      setStrokeHistory(nextHistory);
    }
    strokesRef.current = [];
    setStrokes([]);
    setCurrentStroke(null);
    setIsDrawing(false);
  }, []);

  const undo = useCallback(() => {
    const entry = strokeHistoryRef.current.at(-1);
    if (!entry) return;
    const nextHistory = strokeHistoryRef.current.slice(0, -1);
    strokeHistoryRef.current = nextHistory;
    strokesRef.current = entry.strokes;
    setStrokeHistory(nextHistory);
    setStrokes(entry.strokes);
  }, []);

  return {
    canvasRef,
    strokes,
    strokeColor,
    lineWidth,
    lastStrokeHistorySequence: strokeHistory.at(-1)?.sequence ?? 0,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    attachZoomListeners,
    clearCanvas,
    setStrokeColor,
    setLineWidth,
    undo,
    getCrop,
  };
}
