"use client";

// Сгиб панели вопросов: тот же `FoldResizer`, подключённый к её контексту.
//
// Отдельный файл нужен затем, чтобы панель не тащила в свою разметку шесть
// пропсов состояния, которое и так лежит в контексте.

import { useAskRail } from "@/contexts/ask-rail";
import { railBounds } from "@/lib/rail-width";
import { FoldResizer } from "./fold-resizer";

export function RailResizer() {
  const { width, dragging, setWidth, setDragging, nudgeWidth, resetWidth } =
    useAskRail();

  return (
    <FoldResizer
      width={width}
      dragging={dragging}
      setWidth={setWidth}
      setDragging={setDragging}
      nudgeWidth={nudgeWidth}
      resetWidth={resetWidth}
      bounds={railBounds}
      title="Потяните, чтобы изменить ширину. Двойной клик — вернуть четверть"
    />
  );
}
