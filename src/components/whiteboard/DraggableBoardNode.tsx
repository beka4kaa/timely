"use client";

/**
 * DraggableBoardNode
 * ------------------------------------------------------------------
 * Универсальная обёртка-узел для бесконечной доски. Оборачивает ЛЮБОЙ
 * контент (ScientificIllustration / IllustrationRenderer, виджеты, и т.п.)
 * и делает его перемещаемым по холсту.
 *
 * Использует уже существующую в проекте механику доски — кастомный
 * drag-and-drop на pointer-событиях + zustand-стор (useWhiteboardStore),
 * та же, что у остальных элементов (см. InteractiveElement). Сторонних
 * библиотек (React Flow / react-rnd) в проекте нет — переиспользуем свою.
 *
 * Архитектура «Wrapper»:
 *   <DraggableBoardNode id position width>
 *     <IllustrationRenderer ... />   ← любой контент
 *   </DraggableBoardNode>
 *
 * Перетаскивание:
 *   • Захват за саму карточку (pointerdown по обёртке) → старт drag.
 *   • Внутренние ИНТЕРАКТИВНЫЕ элементы (кнопки, кликабельные маски-объекты,
 *     ручка ресайза) обязаны вызывать e.stopPropagation() в своём
 *     onPointerDown — тогда клик по ним НЕ запускает перетаскивание узла
 *     (см. resize-ручку ниже и маски в IllustrationRenderer).
 *   • Пассивная картинка-подложка событий не глушит → служит «ручкой»
 *     перетаскивания: тащить можно, взявшись за саму иллюстрацию.
 *
 * Выделение:
 *   • pointerdown по карточке → узел становится активным (selected).
 *   • Активный узел получает синюю обводку:
 *       ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-900
 *     (offset под тёмный фон доски).
 */

import React, { useEffect, useRef, useState } from "react";
import { useWhiteboardStore } from "@/stores/whiteboard";
import { canvasToScreen } from "./utils";

export interface DraggableBoardNodeProps {
  /** id элемента в сторе — по нему диспатчатся UPDATE_ELEMENT. */
  id: string;
  /** Позиция узла в КООРДИНАТАХ ХОЛСТА (canvas space). */
  position: { x: number; y: number };
  /** Ширина карточки в canvas-пикселях (высота — auto по контенту). */
  width: number;
  /** Показывать ли ручку ресайза при выделении (по умолчанию true). */
  resizable?: boolean;
  /** Минимальная ширина при ресайзе. */
  minWidth?: number;
  children: React.ReactNode;
}

type DragMode = null | "drag" | "resize";

export const DraggableBoardNode: React.FC<DraggableBoardNodeProps> = ({
  id,
  position,
  width,
  resizable = true,
  minWidth = 160,
  children,
}) => {
  const camera = useWhiteboardStore((s) => s.camera);
  const selectedElementId = useWhiteboardStore((s) => s.selectedElementId);
  const setSelectedElement = useWhiteboardStore((s) => s.setSelectedElement);
  const executeActions = useWhiteboardStore((s) => s.executeActions);

  const isSelected = selectedElementId === id;

  const [mode, setMode] = useState<DragMode>(null);
  const startPointer = useRef({ x: 0, y: 0 });
  const startBox = useRef({ x: 0, y: 0, width: 0 });

  // Global pointer move/up while dragging or resizing.
  useEffect(() => {
    if (!mode) return;

    const handleMove = (e: PointerEvent) => {
      e.preventDefault();
      // Screen delta → canvas delta (divide by zoom).
      const dx = (e.clientX - startPointer.current.x) / camera.zoom;
      const dy = (e.clientY - startPointer.current.y) / camera.zoom;

      if (mode === "drag") {
        executeActions([
          {
            type: "UPDATE_ELEMENT",
            payload: {
              id,
              position: {
                x: startBox.current.x + dx,
                y: startBox.current.y + dy,
              },
            },
          },
        ]);
      } else if (mode === "resize") {
        executeActions([
          {
            type: "UPDATE_ELEMENT",
            payload: { id, width: Math.max(minWidth, startBox.current.width + dx) },
          },
        ]);
      }
    };

    const handleUp = () => setMode(null);

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [mode, camera.zoom, id, minWidth, executeActions]);

  const captureStart = (e: React.PointerEvent) => {
    startPointer.current = { x: e.clientX, y: e.clientY };
    startBox.current = { x: position.x, y: position.y, width };
  };

  const beginDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // primary button only
    // Stop the board's background handler from deselecting / panning.
    e.stopPropagation();
    setSelectedElement(id);
    captureStart(e);
    setMode("drag");
  };

  const beginResize = (e: React.PointerEvent) => {
    // CRITICAL: a control inside the card must NOT bubble up into a node drag.
    e.stopPropagation();
    setSelectedElement(id);
    captureStart(e);
    setMode("resize");
  };

  const screen = canvasToScreen(position.x, position.y, camera);

  return (
    // Outer layer: positions the node in the viewport and applies camera zoom.
    // pointer-events:none so empty corners never block the canvas underneath.
    <div
      className="absolute z-10"
      style={{
        left: screen.x,
        top: screen.y,
        transform: `scale(${camera.zoom})`,
        transformOrigin: "top left",
        pointerEvents: "none",
      }}
    >
      {/* The card itself: the drag surface + selection ring. */}
      <div
        onPointerDown={beginDrag}
        className={[
          "relative cursor-move rounded-xl transition-shadow",
          isSelected
            ? "ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-900"
            : "hover:ring-1 hover:ring-blue-500/40",
        ].join(" ")}
        style={{ width, pointerEvents: "auto" }}
      >
        {children}

        {/* Resize handle — stopPropagation so it resizes instead of dragging. */}
        {isSelected && resizable && (
          <div
            onPointerDown={beginResize}
            className="absolute -bottom-2 -right-2 h-4 w-4 cursor-se-resize rounded-full border-2 border-white bg-blue-500 shadow"
          />
        )}
      </div>
    </div>
  );
};

export default DraggableBoardNode;
