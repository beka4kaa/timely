import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Stroke,
  Point,
  WhiteboardState,
  WhiteboardActions,
  CropResult,
} from "../components/whiteboard/types";
import {
  computeBoundingBox,
  cropCanvasToBase64,
  drawStroke,
  screenToCanvas,
  uid,
} from "../components/whiteboard/utils";
import { useWhiteboardStore } from "@/stores/whiteboard";

const DEBOUNCE_MS = 1500;

export interface UseWhiteboardReturn extends WhiteboardState, WhiteboardActions {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  handlePointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  handlePointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  handlePointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => void;
}

export function useWhiteboard(
  onCrop?: (result: CropResult) => void
): UseWhiteboardReturn {
  const canvasRef = useRef<HTMLCanvasElement>(null!);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStrokes = useRef<Stroke[]>([]);

  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [strokeColor, setStrokeColor] = useState("#ffffff");
  const [lineWidth, setLineWidth] = useState(3);

  // Получаем камеру из Zustand-стора
  const camera = useWhiteboardStore((s) => s.camera);

  // ---- Canvas rendering ----
  const redraw = useCallback(
    (allStrokes: Stroke[], active: Stroke | null) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();

      // Применяем трансформацию камеры (смещение и зум)
      ctx.translate(-camera.x, -camera.y);
      ctx.scale(camera.zoom, camera.zoom);

      for (const s of allStrokes) drawStroke(ctx, s);
      if (active) drawStroke(ctx, active);

      ctx.restore();
    },
    [camera]
  );

  // Перерисовываем при изменении штрихов или камеры
  useEffect(() => {
    redraw(strokes, currentStroke);
  }, [strokes, currentStroke, camera, redraw]);

  // ---- Debounced crop ----
  const scheduleCrop = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    debounceTimer.current = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas || pendingStrokes.current.length === 0) return;

      const box = computeBoundingBox(pendingStrokes.current);
      if (!box) return;

      const base64 = cropCanvasToBase64(canvas, box);

      console.log("🖼️ Whiteboard crop result", {
        boundingBox: box,
        base64: base64.slice(0, 120) + "…",
      });
      console.log("Full Base64:", base64);

      onCrop?.({ boundingBox: box, base64 });

      // Reset pending strokes for next batch
      pendingStrokes.current = [];
    }, DEBOUNCE_MS);
  }, [onCrop]);

  // ---- Pointer handlers ----
  const getPoint = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): Point => {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      // Экранные координаты с учетом CSS-масштабирования canvas
      const screenX = (e.clientX - rect.left) * scaleX;
      const screenY = (e.clientY - rect.top) * scaleY;

      // Трансформация в абсолютные координаты холста
      const canvasPos = screenToCanvas(screenX, screenY, camera);

      return {
        x: canvasPos.x,
        y: canvasPos.y,
        pressure: e.pressure || 0.5,
      };
    },
    [camera]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      // Рисуем только левой кнопкой мыши (или касанием)
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

      setStrokes((prev) => {
        const next = [...prev, currentStroke];
        pendingStrokes.current.push(currentStroke);
        return next;
      });

      setCurrentStroke(null);
      setIsDrawing(false);
      scheduleCrop();
    },
    [currentStroke, scheduleCrop]
  );

  // ---- Actions ----
  const clearCanvas = useCallback(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    pendingStrokes.current = [];
    setStrokes([]);
    setCurrentStroke(null);
    setIsDrawing(false);
  }, []);

  const undo = useCallback(() => {
    setStrokes((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      return next;
    });
  }, []);

  return {
    canvasRef,
    strokes,
    currentStroke,
    isDrawing,
    strokeColor,
    lineWidth,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    clearCanvas,
    setStrokeColor,
    setLineWidth,
    undo,
  };
}
