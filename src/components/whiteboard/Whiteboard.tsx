import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  BarChart3,
  Check,
  Maximize2,
  Minus,
  PenLine,
  Plus,
  Scan,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { useCanvasDraw } from "../../hooks/useCanvasDraw";
import type { CropResult } from "./types";
import {
  nextWhiteboardHistorySequence,
  useWhiteboardStore,
  type WhiteboardElement,
} from "@/stores/whiteboard";
import { AUTO_INK, canvasToScreen, screenToCanvas } from "./utils";
import { TextRenderer, GraphRenderer, ImageRenderer, ShapeRenderer } from "./renderers";
import { IllustrationRenderer } from "./IllustrationRenderer";
import { IllustrationPlaceholder } from "./IllustrationPlaceholder";
import { FALLBACK_IMAGE_MODELS, imageModelLabel } from "@/lib/image-model-selection";
import { DraggableBoardNode } from "./DraggableBoardNode";
import { InteractiveElement } from "./InteractiveElement";
import { authFetch } from "@/lib/auth-fetch";

interface WhiteboardProps {
  onCrop?: (result: CropResult) => void;
}

const COLORS = [AUTO_INK, "#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];
const WIDTHS = [2, 3, 5, 8, 12];
const MIN_BOARD_ZOOM = 0.1;
const MAX_BOARD_ZOOM = 4;

type ElementBounds = { x: number; y: number; width: number; height: number };

function getElementBounds(element: WhiteboardElement): ElementBounds {
  if (element.type === "ILLUSTRATION" || element.type === "IMAGE") {
    return {
      x: element.position.x,
      y: element.position.y,
      width: element.width,
      height: element.height,
    };
  }
  if (element.type === "SHAPE") {
    return {
      x: element.position.x,
      y: element.position.y,
      width: Math.max(1, element.width),
      height: Math.max(1, element.height),
    };
  }
  if (element.type === "GRAPH") {
    return { x: element.position.x, y: element.position.y, width: 326, height: 352 };
  }

  const width = element.width ?? 300;
  const fontSize = element.fontSize ?? 20;
  const lineHeight = element.lineHeight ?? 1.42;
  const charsPerLine = Math.max(8, Math.floor(width / (fontSize * 0.54)));
  const visualLines = (element.content || " ").split("\n").reduce(
    (total, line) => total + Math.max(1, Math.ceil(line.length / charsPerLine)),
    0,
  );
  return {
    x: element.position.x,
    y: element.position.y,
    width,
    height: Math.max(fontSize * lineHeight + 12, visualLines * fontSize * lineHeight + 12),
  };
}

export default function Whiteboard({ onCrop }: WhiteboardProps) {
  const {
    elements,
    camera,
    panCamera,
    executeActions,
    elementHistoryPast,
    lastElementHistorySequence,
    undoElementAction,
  } = useWhiteboardStore();
  
  // Store latest crop base64
  const latestCropBase64 = useRef<string | null>(null);
  
  // Wrap the provided onCrop to also store the base64
  const handleCrop = useCallback((result: CropResult) => {
    latestCropBase64.current = result.base64;
    onCrop?.(result);
  }, [onCrop]);

  const {
    canvasRef,
    strokeColor,
    lineWidth,
    strokes,
    lastStrokeHistorySequence,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    attachZoomListeners,
    clearCanvas,
    setStrokeColor,
    setLineWidth,
    undo,
    getCrop,
  } = useCanvasDraw(handleCrop, true);

  // ----- Panning state -----
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const cameraSnapshot = useRef({ x: 0, y: 0 });
  const [isOCRProcessing, setIsOCRProcessing] = useState(false);
  const [inkPanelOpen, setInkPanelOpen] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingGraphId, setEditingGraphId] = useState<string | null>(null);

  const undoLatest = useCallback(() => {
    if (
      lastStrokeHistorySequence > 0
      && lastStrokeHistorySequence === lastElementHistorySequence
    ) {
      undo();
      undoElementAction();
      return;
    }
    if (lastStrokeHistorySequence > lastElementHistorySequence) {
      undo();
      return;
    }
    if (lastElementHistorySequence > 0) {
      undoElementAction();
      return;
    }
    if (lastStrokeHistorySequence > 0) {
      undo();
    }
  }, [
    lastElementHistorySequence,
    lastStrokeHistorySequence,
    undo,
    undoElementAction,
  ]);

  useEffect(() => {
    const handleUndoShortcut = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey)
        || event.shiftKey
        || event.key.toLowerCase() !== "z"
      ) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement
        && target.closest("input, textarea, [contenteditable='true']")
      ) {
        return;
      }

      event.preventDefault();
      undoLatest();
    };

    window.addEventListener("keydown", handleUndoShortcut);
    return () => window.removeEventListener("keydown", handleUndoShortcut);
  }, [undoLatest]);

  useEffect(() => {
    if (!clearArmed) return;
    const timer = window.setTimeout(() => setClearArmed(false), 4000);
    return () => window.clearTimeout(timer);
  }, [clearArmed]);

  const updateIllustrationLabelPosition = useCallback(
    (elementId: string, labelIndex: number, position: { x: number; y: number } | null) => {
      const state = useWhiteboardStore.getState();
      const element = state.elements.find((candidate) => candidate.id === elementId);
      if (!element || element.type !== "ILLUSTRATION" || !element.labels[labelIndex]) return;

      const nextLabels = element.labels.map((label, index) => {
        if (index !== labelIndex) return label;
        if (position) return { ...label, manual_position: position };
        const { manual_position: _manualPosition, ...automaticLabel } = label;
        return automaticLabel;
      });

      state.executeActions(
        [
          {
            type: "UPDATE_ELEMENT",
            payload: { id: elementId, labels: nextLabels },
          },
        ],
        { history: "record" },
      );
    },
    [],
  );

  const handleOCR = async () => {
    // Try to get synchronous fresh crop, fallback to latest debounced crop
    const dataUrl = getCrop() || latestCropBase64.current;
    
    if (!dataUrl) {
      console.warn("Нет данных для сканирования (возможно, вы ничего не нарисовали)");
      return;
    }
    try {
      setIsOCRProcessing(true);
      console.log("Ожидание результатов OCR...");
      const res = await authFetch("/api/ai/ocr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl })
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.traceback) console.error("Traceback:", data.traceback);
        throw new Error(data.error || `Ошибка сервера: ${res.status}`);
      }
      console.log("=== Результат распознавания ===");
      console.log(data.text);
      console.log("===============================");
    } catch (e) {
      console.error("Ошибка OCR:", e);
    } finally {
      setIsOCRProcessing(false);
    }
  };

  // rAF-throttled camera update refs
  const rafId = useRef<number>(0);
  const pendingCamera = useRef<{ x: number; y: number } | null>(null);

  const flushCamera = useCallback(() => {
    if (pendingCamera.current) {
      panCamera(pendingCamera.current.x, pendingCamera.current.y);
      pendingCamera.current = null;
    }
    rafId.current = 0;
  }, [panCamera]);

  /** Schedule a camera delta update, batched via requestAnimationFrame */
  const schedulePan = useCallback((dx: number, dy: number) => {
    if (pendingCamera.current) {
      pendingCamera.current.x += dx;
      pendingCamera.current.y += dy;
    } else {
      pendingCamera.current = { x: dx, y: dy };
    }

    if (!rafId.current) {
      rafId.current = requestAnimationFrame(flushCamera);
    }
  }, [flushCamera]);

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, []);

  // ----- Wheel/trackpad: panning (regular) + zoom (ctrl/meta) -----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Attach zoom listeners from the hook (Ctrl+wheel / pinch)
    const detachZoom = attachZoomListeners(container);

    // Regular wheel → pan
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return; // zoom handler handles it
      e.preventDefault();
      schedulePan(e.deltaX, e.deltaY);
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", onWheel);
      detachZoom();
    };
  }, [schedulePan, attachZoomListeners]);

  // Размером холста теперь занимается useCanvasDraw: там же живёт перерисовка,
  // а буфер обязан пересчитываться вместе с плотностью экрана. Здесь остался
  // только CSS-размер через классы — см. разметку слоя рисования ниже.

  // ----- Clipboard Paste -----
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (!file) continue;
          
          const reader = new FileReader();
          reader.onload = (event) => {
            const src = event.target?.result as string;
            if (!src) return;
            
            const img = new Image();
            img.onload = () => {
              const cameraState = useWhiteboardStore.getState().camera;
              const center = screenToCanvas(window.innerWidth / 2, window.innerHeight / 2, cameraState);
              
              let w = img.naturalWidth;
              let h = img.naturalHeight;
              const maxSize = 500;
              if (w > maxSize || h > maxSize) {
                const ratio = Math.min(maxSize / w, maxSize / h);
                w *= ratio;
                h *= ratio;
              }

              useWhiteboardStore.getState().executeActions([{
                type: 'CREATE_IMAGE',
                payload: {
                  id: Date.now().toString(),
                  position: { x: center.x - w / 2, y: center.y - h / 2 },
                  src,
                  width: w,
                  height: h,
                  rotation: 0
                }
              }]);
              useWhiteboardStore.getState().setSelectedElement(Date.now().toString());
            };
            img.src = src;
          };
          reader.readAsDataURL(file);
          e.preventDefault();
          break; // only handle one image paste at a time
        }
      }
    };
    
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  // ----- Middle-mouse / right-click panning -----
  const handlePointerDownContainer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY };
      cameraSnapshot.current = { x: camera.x, y: camera.y };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  };

  const handlePointerMoveContainer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanning) return;
    e.preventDefault();
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    const newX = cameraSnapshot.current.x - dx;
    const newY = cameraSnapshot.current.y - dy;

    pendingCamera.current = null;
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = 0;
    }
    useWhiteboardStore.getState().setCamera(newX, newY);
  };

  const handlePointerUpContainer = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isPanning) {
      setIsPanning(false);
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // Zoom percentage display
  const zoomPercent = Math.round(camera.zoom * 100);
  const hasBoardContent = strokes.length > 0 || elements.length > 0;
  const hasUndo = lastStrokeHistorySequence > 0 || elementHistoryPast.length > 0;

  const boardCenter = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    return {
      x: rect ? rect.width / 2 : window.innerWidth / 2,
      y: rect ? rect.height / 2 : window.innerHeight / 2,
    };
  };

  /**
   * Ручные текст и график получают ближайшее свободное место в видимой
   * области. Это исключает неприятный сценарий, когда второй элемент
   * создаётся ровно поверх первого и кажется, будто кнопка не сработала.
   */
  const findOpenPosition = (width: number, height: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const visibleWidth = (rect?.width ?? window.innerWidth) / camera.zoom;
    const visibleHeight = (rect?.height ?? window.innerHeight) / camera.zoom;
    const origin = screenToCanvas(0, 0, camera);
    const padding = 48 / camera.zoom;
    // У плавающей панели инструментов есть собственная визуальная колонка.
    // Новые карточки начинаем правее неё, чтобы текст/график не появлялись
    // под панелью в момент создания.
    const preferredLeftGutter = 120 / camera.zoom;
    const gap = 24 / camera.zoom;
    const rightmostStart = origin.x + visibleWidth - padding - width;
    const minX = Math.max(
      origin.x + padding,
      Math.min(origin.x + preferredLeftGutter, rightmostStart),
    );
    const maxX = Math.max(minX, origin.x + visibleWidth - padding - width);
    const minY = origin.y + padding;
    const searchBottom = minY + Math.max(visibleHeight * 3, 1800 / camera.zoom);
    const xStep = Math.max(48 / camera.zoom, (width + gap) / 2);
    const yStep = Math.max(32 / camera.zoom, Math.min(64 / camera.zoom, height / 5));
    const occupied = elements.map(getElementBounds);

    for (let y = minY; y <= searchBottom; y += yStep) {
      for (let x = minX; x <= maxX + 0.5; x += xStep) {
        const overlaps = occupied.some((box) => (
          x < box.x + box.width + gap
          && x + width + gap > box.x
          && y < box.y + box.height + gap
          && y + height + gap > box.y
        ));
        if (!overlaps) return { x, y };
      }
    }

    return { x: minX, y: searchBottom + gap };
  };

  const addText = () => {
    const position = findOpenPosition(320, 54);
    const id = `text-${Date.now()}`;
    executeActions([{
      type: "CREATE_TEXT",
      payload: {
        id,
        content: "",
        position,
        width: 320,
        fontSize: 25,
        lineHeight: 1.35,
        variant: "body",
      },
    }]);
    useWhiteboardStore.getState().setSelectedElement(id);
    setEditingTextId(id);
  };

  const addGraph = () => {
    const position = findOpenPosition(326, 352);
    const id = `graph-${Date.now()}`;
    executeActions([{
      type: "DRAW_GRAPH",
      payload: {
        id,
        function: "x^2 - 4",
        domain: [-5, 5],
        position,
      },
    }]);
    useWhiteboardStore.getState().setSelectedElement(id);
    setEditingGraphId(id);
  };

  const clearBoard = () => {
    const historySequence = nextWhiteboardHistorySequence();
    clearCanvas(historySequence);
    if (elements.length > 0) {
      executeActions(
        [{ type: "CLEAR_BOARD" }],
        { history: "record", historySequence },
      );
    }
    setClearArmed(false);
    setInkPanelOpen(false);
    setEditingTextId(null);
    setEditingGraphId(null);
  };

  const zoomAroundCenter = (requestedZoom: number) => {
    const current = useWhiteboardStore.getState().camera;
    const nextZoom = Math.min(MAX_BOARD_ZOOM, Math.max(MIN_BOARD_ZOOM, requestedZoom));
    const center = boardCenter();
    const scale = nextZoom / current.zoom;
    useWhiteboardStore.getState().setCamera(
      current.x * scale + center.x * (scale - 1),
      current.y * scale + center.y * (scale - 1),
      nextZoom,
    );
  };

  const fitBoardToView = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const include = (x: number, y: number, width = 0, height = 0) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + width);
      maxY = Math.max(maxY, y + height);
    };

    elements.forEach((element) => {
      if (element.type === "ILLUSTRATION" || element.type === "IMAGE") {
        include(element.position.x, element.position.y, element.width, element.height);
      } else if (element.type === "SHAPE") {
        include(element.position.x, element.position.y, element.width, element.height);
      } else if (element.type === "GRAPH") {
        include(element.position.x, element.position.y, 300, 300);
      } else {
        include(element.position.x, element.position.y, element.width ?? 300, 120);
      }
    });
    strokes.forEach((stroke) => {
      stroke.points.forEach((point) => include(point.x, point.y));
    });

    if (!Number.isFinite(minX)) {
      useWhiteboardStore.getState().setCamera(0, 0, 1);
      return;
    }

    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);
    const padding = Math.min(96, Math.max(48, Math.min(rect.width, rect.height) * 0.09));
    const nextZoom = Math.min(
      2,
      Math.max(
        MIN_BOARD_ZOOM,
        Math.min(
          (rect.width - padding * 2) / contentWidth,
          (rect.height - padding * 2) / contentHeight,
        ),
      ),
    );
    const horizontalInset = (rect.width - contentWidth * nextZoom) / 2;
    const verticalInset = (rect.height - contentHeight * nextZoom) / 2;
    useWhiteboardStore.getState().setCamera(
      minX * nextZoom - horizontalInset,
      minY * nextZoom - verticalInset,
      nextZoom,
    );
  };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-0 select-none overflow-hidden bg-[#f7f5f1] text-[#3c3731]"
      onPointerDown={(e) => {
        // Deselect if clicking on empty background
        useWhiteboardStore.getState().setSelectedElement(null);
        handlePointerDownContainer(e);
      }}
      onPointerMove={handlePointerMoveContainer}
      onPointerUp={handlePointerUpContainer}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_-8%,rgba(183,121,45,0.055),transparent_32%)]" />

      {/* Infinite dot-grid background synced with camera */}
      <div
        className="pointer-events-none absolute inset-0 text-[#9d978e] opacity-[0.25]"
        style={{
          backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)",
          backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px`,
          backgroundPosition: `${-camera.x}px ${-camera.y}px`,
        }}
      />

      {/* Drawing canvas layer */}
      <div className="absolute inset-0 z-0 cursor-crosshair">
        <canvas
          ref={canvasRef}
          className="block h-full w-full touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />
      </div>

      {/* Element rendering layer */}
      {elements.map((el) => {
        // ILLUSTRATION uses the generalized DraggableBoardNode wrapper:
        // it owns its own positioning/zoom/drag/select so the whole layered
        // card (image + labels + hover-masks) moves as ONE node.
        if (el.type === "ILLUSTRATION") {
          return (
            <DraggableBoardNode key={el.id} id={el.id} position={el.position} width={el.width}>
              {el.pending || el.error ? (
                // Прогрессивная выдача: место под иллюстрацию занимается сразу,
                // а растр догружается отдельным запросом. Без плейсхолдера
                // холст стоял бы пустым все ~25с генерации.
                <IllustrationPlaceholder
                  width={el.width}
                  height={el.height}
                  error={el.error}
                  modelLabel={
                    el.imageModel
                      ? imageModelLabel(el.imageModel, FALLBACK_IMAGE_MODELS)
                      : undefined
                  }
                />
              ) : (
                <IllustrationRenderer
                  id={el.id}
                  src={el.src}
                  labels={el.labels}
                  masks={el.masks}
                  alt={el.alt}
                  genStyle={el.genStyle}
                  onLabelPositionChange={(labelIndex, position) =>
                    updateIllustrationLabelPosition(el.id, labelIndex, position)
                  }
                />
              )}
            </DraggableBoardNode>
          );
        }

        // All other primitives keep the existing InteractiveElement path.
        const screenPos = canvasToScreen(el.position.x, el.position.y, camera);
        return (
          <div
            key={el.id}
            className="absolute z-10 pointer-events-none"
            style={{
              left: screenPos.x,
              top: screenPos.y,
              transform: `scale(${camera.zoom})`,
              transformOrigin: "top left",
            }}
          >
            <InteractiveElement element={el} cameraZoom={camera.zoom}>
              {el.type === "TEXT" && (
                <TextRenderer
                  id={el.id}
                  content={el.content}
                  typewriterDelay={0}
                  width={el.width}
                  fontSize={el.fontSize}
                  lineHeight={el.lineHeight}
                  color={el.color}
                  variant={el.variant}
                  autoFocus={editingTextId === el.id}
                  onContentChange={(content, options) => {
                    executeActions(
                      [{
                        type: "UPDATE_ELEMENT",
                        payload: { id: el.id, content },
                      }],
                      // Промежуточные коммиты по паузе в наборе не плодят шаги
                      // Undo: весь сеанс правки остаётся одним Ctrl+Z.
                      {
                        history:
                          options?.startsNewHistoryStep === false ? "skip" : "record",
                      },
                    );
                  }}
                  onEditingComplete={() => {
                    setEditingTextId((current) => current === el.id ? null : current);
                  }}
                />
              )}
              {el.type === "GRAPH" && (
                <GraphRenderer
                  id={el.id}
                  func={el.function}
                  domain={el.domain}
                  width={300}
                  height={300}
                  autoFocus={editingGraphId === el.id}
                  onFunctionChange={(func) => {
                    executeActions(
                      [{
                        type: "UPDATE_ELEMENT",
                        payload: { id: el.id, function: func },
                      }],
                      { history: "record" },
                    );
                  }}
                  onEditingComplete={() => {
                    setEditingGraphId((current) => current === el.id ? null : current);
                  }}
                />
              )}
              {el.type === "IMAGE" && (
                <ImageRenderer id={el.id} src={el.src} width={el.width} height={el.height} />
              )}
              {el.type === "SHAPE" && (
                <ShapeRenderer
                  id={el.id}
                  shape={el.shape}
                  width={el.width}
                  height={el.height}
                  points={el.points}
                  flip={el.flip}
                  color={el.color}
                  strokeWidth={el.strokeWidth}
                  fill={el.fill}
                  seed={el.seed}
                />
              )}
            </InteractiveElement>
          </div>
        );
      })}

      {/* Компактная панель: редкие настройки раскрываются по запросу, а не
          занимают холст семью цветами и пятью датчиками толщины постоянно. */}
      <div
        className="absolute left-5 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-2 text-[#777168]"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="relative flex flex-col items-center gap-1 rounded-full border border-[#d8d3cb] bg-[#fbfaf7]/95 p-1.5 shadow-[0_12px_34px_rgba(64,54,42,0.13)] backdrop-blur-xl">
        <button
          type="button"
          aria-label="Настройки пера"
          aria-expanded={inkPanelOpen}
          title="Перо"
          onClick={() => {
            setInkPanelOpen((open) => !open);
            setClearArmed(false);
          }}
          className={`relative grid h-9 w-9 place-items-center rounded-full transition-all ${
            inkPanelOpen
              ? "bg-[#302d2a] text-white shadow-[0_5px_14px_rgba(48,45,42,0.24)]"
              : "hover:bg-[#efede8] hover:text-[#302d2a]"
          }`}
        >
          <PenLine className="h-[17px] w-[17px]" />
          <span
            className={`absolute bottom-1 right-1 h-2 w-2 rounded-full border border-white/80 ${
              strokeColor === AUTO_INK ? "bg-[#302d2a]" : ""
            }`}
            style={strokeColor === AUTO_INK ? undefined : { backgroundColor: strokeColor }}
          />
        </button>

        <button
          type="button"
          aria-label="Добавить текст"
          title="Добавить текст"
          onClick={addText}
          className="grid h-9 w-9 place-items-center rounded-full transition-all hover:bg-[#efede8] hover:text-[#302d2a] active:scale-95"
        >
          <Type className="h-[17px] w-[17px]" />
        </button>

        <button
          type="button"
          aria-label="Добавить график"
          title="Добавить график"
          onClick={addGraph}
          className="grid h-9 w-9 place-items-center rounded-full transition-all hover:bg-[#efede8] hover:text-[#302d2a] active:scale-95"
        >
          <BarChart3 className="h-[17px] w-[17px]" />
        </button>

        <div className="my-0.5 h-px w-6 bg-[#ded9d1]" />

        <button
          type="button"
          aria-label="Отменить последнее"
          title="Отменить последнее"
          onClick={undoLatest}
          disabled={!hasUndo}
          className="grid h-9 w-9 place-items-center rounded-full transition-all hover:bg-[#efede8] hover:text-[#302d2a] active:scale-95 disabled:pointer-events-none disabled:opacity-25"
        >
          <Undo2 className="h-[17px] w-[17px]" />
        </button>

        <button
          type="button"
          aria-label={isOCRProcessing ? "Распознаю рисунок" : "Распознать рисунок"}
          title={isOCRProcessing ? "Распознаю…" : "Распознать рисунок"}
          onClick={handleOCR}
          disabled={isOCRProcessing || strokes.length === 0}
          className="grid h-9 w-9 place-items-center rounded-full text-[#a66d28] transition-all hover:bg-[#f5eadb] active:scale-95 disabled:pointer-events-none disabled:opacity-25"
        >
          <Scan className={`h-[17px] w-[17px] ${isOCRProcessing ? "animate-pulse" : ""}`} />
        </button>

        <button
          type="button"
          aria-label="Очистить доску"
          title="Очистить доску"
          onClick={() => {
            setClearArmed(true);
            setInkPanelOpen(false);
          }}
          disabled={!hasBoardContent}
          className={`grid h-9 w-9 place-items-center rounded-full transition-all active:scale-95 disabled:pointer-events-none disabled:opacity-25 ${
            clearArmed
              ? "bg-rose-500 text-white shadow-md shadow-rose-500/20"
              : "text-[#a85f56] hover:bg-[#f5e7e5]"
          }`}
        >
          <Trash2 className="h-[17px] w-[17px]" />
        </button>

        {inkPanelOpen && (
          <div className="absolute left-[calc(100%+10px)] top-0 w-[196px] rounded-2xl border border-[#d8d3cb] bg-[#fbfaf7]/95 p-3 shadow-[0_18px_55px_rgba(64,54,42,0.16)] backdrop-blur-xl">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9b958c]">
                Чернила
              </span>
              <span className="text-[11px] tabular-nums text-[#9b958c]">
                {lineWidth}px
              </span>
            </div>
            <div className="flex items-center justify-between gap-1">
              {COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={color === AUTO_INK ? "Автоматический цвет" : `Цвет ${color}`}
                  onClick={() => setStrokeColor(color)}
                  className={`h-5 w-5 rounded-full border transition-transform hover:scale-110 ${
                    color === AUTO_INK
                      ? "border-black/15 bg-[#302d2a]"
                      : "border-white/70"
                  } ${
                    strokeColor === color
                      ? "ring-2 ring-[#bd7d30] ring-offset-2 ring-offset-[#fbfaf7]"
                      : ""
                  }`}
                  style={color === AUTO_INK ? undefined : { backgroundColor: color }}
                />
              ))}
            </div>
            <div className="my-3 h-px bg-[#e1ddd6]" />
            <div className="flex items-center justify-between gap-1">
              {WIDTHS.map((width) => (
                <button
                  key={width}
                  type="button"
                  aria-label={`Толщина ${width}px`}
                  onClick={() => setLineWidth(width)}
                  className={`grid h-7 flex-1 place-items-center rounded-lg transition-colors ${
                    lineWidth === width
                      ? "bg-[#f3e6d4] text-[#9a6425]"
                      : "hover:bg-[#efede8]"
                  }`}
                >
                  <span
                    className="rounded-full bg-current"
                    style={{ width: Math.min(13, width + 2), height: Math.min(13, width + 2) }}
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {clearArmed && (
          <div className="absolute bottom-0 left-[calc(100%+10px)] flex w-[210px] items-center gap-2 rounded-2xl border border-[#dfbbb6] bg-[#fbfaf7]/95 p-2.5 shadow-[0_18px_55px_rgba(64,54,42,0.18)] backdrop-blur-xl">
            <span className="min-w-0 flex-1 pl-1 text-xs font-medium text-[#5d554c]">
              Очистить всю доску?
            </span>
            <button
              type="button"
              aria-label="Отмена"
              onClick={() => setClearArmed(false)}
              className="grid h-8 w-8 place-items-center rounded-lg text-[#938c82] transition-colors hover:bg-[#efede8] hover:text-[#4d463e]"
            >
              <X className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Подтвердить очистку"
              onClick={clearBoard}
              className="grid h-8 w-8 place-items-center rounded-lg bg-rose-500 text-white shadow-sm transition-transform hover:scale-105 active:scale-95"
            >
              <Check className="h-4 w-4" />
            </button>
          </div>
        )}
        </div>

        {/* Масштаб — отдельная вертикальная капсула под инструментами. */}
        <div className="flex flex-col items-center gap-0.5 rounded-full border border-[#d8d3cb] bg-[#fbfaf7]/95 p-1 text-[#827b72] shadow-[0_10px_30px_rgba(64,54,42,0.12)] backdrop-blur-xl">
          <button
            type="button"
            aria-label="Увеличить масштаб"
            title="Увеличить масштаб"
            onClick={() => zoomAroundCenter(camera.zoom * 1.2)}
            className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-[#efede8] hover:text-[#302d2a]"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Сбросить масштаб до 100%"
            title="Сбросить масштаб до 100%"
            onClick={() => zoomAroundCenter(1)}
            className="grid h-9 w-9 place-items-center rounded-full text-[10px] font-medium tabular-nums transition-colors hover:bg-[#efede8] hover:text-[#302d2a]"
          >
            {zoomPercent}%
          </button>
          <button
            type="button"
            aria-label="Уменьшить масштаб"
            title="Уменьшить масштаб"
            onClick={() => zoomAroundCenter(camera.zoom / 1.2)}
            className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-[#efede8] hover:text-[#302d2a]"
          >
            <Minus className="h-4 w-4" />
          </button>
          <div className="my-0.5 h-px w-6 bg-[#ded9d1]" />
          <button
            type="button"
            aria-label="Показать всю доску"
            title="Показать всю доску"
            onClick={fitBoardToView}
            className="grid h-8 w-8 place-items-center rounded-full transition-colors hover:bg-[#efede8] hover:text-[#302d2a]"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
