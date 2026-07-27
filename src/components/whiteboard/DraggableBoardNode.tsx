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
 *   • Активный узел получает тонкий тёплый контур в палитре доски.
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
  const recordElementCheckpoint = useWhiteboardStore((s) => s.recordElementCheckpoint);

  const isSelected = selectedElementId === id;

  const [mode, setMode] = useState<DragMode>(null);
  const startPointer = useRef({ x: 0, y: 0 });
  const startBox = useRef({ x: 0, y: 0, width: 0 });
  const historySnapshot = useRef<ReturnType<typeof useWhiteboardStore.getState>["elements"] | null>(null);
  const didTransform = useRef(false);

  // Global pointer move/up while dragging or resizing.
  useEffect(() => {
    if (!mode) return;

    const handleMove = (e: PointerEvent) => {
      e.preventDefault();
      // Screen delta → canvas delta (divide by zoom).
      const dx = (e.clientX - startPointer.current.x) / camera.zoom;
      const dy = (e.clientY - startPointer.current.y) / camera.zoom;

      if (mode === "drag") {
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) didTransform.current = true;
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
        if (Math.abs(dx) > 0.5) didTransform.current = true;
        executeActions([
          {
            type: "UPDATE_ELEMENT",
            payload: { id, width: Math.max(minWidth, startBox.current.width + dx) },
          },
        ]);
      }
    };

    const handleUp = () => {
      if (didTransform.current && historySnapshot.current) {
        recordElementCheckpoint(historySnapshot.current);
      }
      historySnapshot.current = null;
      didTransform.current = false;
      setMode(null);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [mode, camera.zoom, id, minWidth, executeActions, recordElementCheckpoint]);

  const captureStart = (e: React.PointerEvent) => {
    startPointer.current = { x: e.clientX, y: e.clientY };
    startBox.current = { x: position.x, y: position.y, width };
    historySnapshot.current = useWhiteboardStore.getState().elements;
    didTransform.current = false;
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
          "relative cursor-move rounded-xl transition-[box-shadow,filter] duration-200",
          isSelected
            ? "ring-1 ring-[#b7792d]/75 ring-offset-2 ring-offset-[#f7f5f1] shadow-[0_14px_42px_rgba(64,54,42,0.14)]"
            : "hover:shadow-[0_12px_36px_rgba(64,54,42,0.10)]",
        ].join(" ")}
        style={{ width, pointerEvents: "auto" }}
      >
        {children}

        {/* Resize handle — stopPropagation so it resizes instead of dragging. */}
        {isSelected && resizable && (
          <div
            onPointerDown={beginResize}
            aria-label="Изменить размер"
            className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-se-resize rounded-full border-2 border-white bg-[#b7792d] shadow-[0_3px_10px_rgba(124,80,27,0.28)] transition-transform hover:scale-125"
          />
        )}
      </div>
    </div>
  );
};

export default DraggableBoardNode;
