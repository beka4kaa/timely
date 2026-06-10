import React, { useEffect, useRef, useState, useCallback } from "react";
import { Undo2, Trash2, Scan } from "lucide-react";
import { useCanvasDraw } from "../../hooks/useCanvasDraw";
import type { CropResult } from "./types";
import { useWhiteboardStore } from "@/stores/whiteboard";
import { canvasToScreen, screenToCanvas } from "./utils";
import { TextRenderer, GraphRenderer, ImageRenderer, ShapeRenderer } from "./renderers";
import { IllustrationRenderer } from "./IllustrationRenderer";
import { DraggableBoardNode } from "./DraggableBoardNode";
import { InteractiveElement } from "./InteractiveElement";

interface WhiteboardProps {
  onCrop?: (result: CropResult) => void;
}

const COLORS = ["#ffffff", "#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];
const WIDTHS = [2, 3, 5, 8, 12];

export default function Whiteboard({ onCrop }: WhiteboardProps) {
  const { elements, camera, panCamera, executeActions } = useWhiteboardStore();
  
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
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    attachZoomListeners,
    clearCanvas,
    setStrokeColor,
    setLineWidth,
    undo,
    getCrop,
  } = useCanvasDraw(handleCrop);

  // ----- Panning state -----
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const cameraSnapshot = useRef({ x: 0, y: 0 });
  const [isOCRProcessing, setIsOCRProcessing] = useState(false);

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
      const res = await fetch("/api/ai/ocr", {
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

  // ----- Canvas resize -----
  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, [canvasRef]);

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

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-0 overflow-hidden bg-zinc-950 text-zinc-100 select-none"
      onPointerDown={(e) => {
        // Deselect if clicking on empty background
        useWhiteboardStore.getState().setSelectedElement(null);
        handlePointerDownContainer(e);
      }}
      onPointerMove={handlePointerMoveContainer}
      onPointerUp={handlePointerUpContainer}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Infinite dot-grid background synced with camera */}
      <div
        className="pointer-events-none absolute inset-0 opacity-10"
        style={{
          backgroundImage: "radial-gradient(circle, #ffffff 1px, transparent 1px)",
          backgroundSize: `${24 * camera.zoom}px ${24 * camera.zoom}px`,
          backgroundPosition: `${-camera.x}px ${-camera.y}px`,
        }}
      />

      {/* Drawing canvas layer */}
      <div className="absolute inset-0 z-0 cursor-crosshair">
        <canvas
          ref={canvasRef}
          className="block touch-none"
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
              <IllustrationRenderer
                id={el.id}
                src={el.src}
                labels={el.labels}
                masks={el.masks}
                alt={el.alt}
              />
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
                <TextRenderer id={el.id} content={el.content} typewriterDelay={30} />
              )}
              {el.type === "GRAPH" && (
                <GraphRenderer id={el.id} func={el.function} domain={el.domain} width={300} height={300} />
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

      {/* Floating Toolbar */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-2 rounded-full bg-zinc-900/90 backdrop-blur-md border border-zinc-800 shadow-xl">
        <div className="flex items-center gap-1">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setStrokeColor(c)}
              className={`w-5 h-5 rounded-full transition-transform hover:scale-110 ${
                strokeColor === c ? "ring-2 ring-white ring-offset-2 ring-offset-zinc-900 scale-110" : ""
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>

        <div className="w-px h-5 bg-zinc-800 mx-1.5" />

        <div className="flex items-center gap-1">
          {WIDTHS.map((w) => (
            <button
              key={w}
              onClick={() => setLineWidth(w)}
              className={`flex items-center justify-center w-6 h-6 rounded-full transition-colors hover:bg-zinc-800 ${
                lineWidth === w ? "bg-zinc-800" : ""
              }`}
            >
              <span className="rounded-full bg-white" style={{ width: w + 1, height: w + 1 }} />
            </button>
          ))}
        </div>

        <div className="w-px h-5 bg-zinc-800 mx-1.5" />

        {/* Element spawn buttons */}
        <button
          onClick={() => {
            const center = screenToCanvas(window.innerWidth / 2 - 100, window.innerHeight / 2 - 50, camera);
            executeActions([{
              type: "CREATE_TEXT",
              payload: {
                id: Date.now().toString(),
                content: "Привет! Это текст с LaTeX: $\\frac{1}{2}x^2$",
                position: center
              }
            }]);
          }}
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm font-medium text-blue-400 hover:bg-blue-500/20 transition-colors"
        >
          +Text
        </button>

        <button
          onClick={() => {
            const center = screenToCanvas(window.innerWidth / 2 - 150, window.innerHeight / 2 - 150, camera);
            executeActions([{
              type: "DRAW_GRAPH",
              payload: {
                id: Date.now().toString(),
                function: "x^2 - 4",
                domain: [-5, 5],
                position: center
              }
            }]);
          }}
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-sm font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
        >
          +Graph
        </button>

        <div className="w-px h-6 bg-zinc-700/50 mx-1" />

        <button
          onClick={undo}
          disabled={strokes.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium text-zinc-300 hover:bg-zinc-800 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        >
          <Undo2 className="w-4 h-4" />
          <span className="hidden sm:inline">Undo</span>
        </button>

        <button
          onClick={clearCanvas}
          disabled={strokes.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium text-red-400 hover:bg-red-500/20 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          <span className="hidden sm:inline">Clear</span>
        </button>

        <button
          onClick={handleOCR}
          disabled={isOCRProcessing || strokes.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium text-purple-400 hover:bg-purple-500/20 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        >
          <Scan className={`w-4 h-4 ${isOCRProcessing ? "animate-pulse" : ""}`} />
          <span className="hidden sm:inline">{isOCRProcessing ? "Scanning..." : "Scan"}</span>
        </button>

        <div className="w-px h-6 bg-zinc-700/50 mx-1" />

        {/* Zoom indicator */}
        <span className="text-xs font-mono text-zinc-400 min-w-[3rem] text-center">
          {zoomPercent}%
        </span>
      </div>

      {/* Bottom left logo / button */}
      <div className="absolute bottom-6 left-6 z-20">
        <button className="flex items-center justify-center w-10 h-10 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors shadow-lg">
          <svg viewBox="0 0 180 180" width="16" height="16" fill="currentColor">
            <path fillRule="evenodd" clipRule="evenodd" d="M89.3094 0C39.9806 0 0 39.9806 0 89.3094C0 138.638 39.9806 178.619 89.3094 178.619C138.638 178.619 178.619 138.638 178.619 89.3094C178.619 39.9806 138.638 0 89.3094 0ZM133.565 142.062L133.456 141.916L60.0336 43.1256H41.834V135.493H57.8863V62.4288L121.325 147.781C111.968 155.666 99.8787 160.36 86.6667 160.36C45.9818 160.36 12.9999 127.378 12.9999 86.6934C12.9999 46.0084 45.9818 13.0265 86.6667 13.0265C127.352 13.0265 160.334 46.0084 160.334 86.6934C160.334 108.971 150.457 128.948 133.565 142.062ZM138.406 135.493V43.1256H122.353V114.184L138.406 135.493Z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
