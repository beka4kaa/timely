"use client";

// Сгиб разворота: граница страницы и панели, за которую тянут.
//
// Ответ по умолчанию для ресайза — серая полоса в четыре пикселя, синеющая при
// наведении, или щепотка точек «⋮⋮». Так делает каждая IDE, и к книге это
// отношения не имеет.
//
// Здесь граница уже нарисована — это волосяная линия панели. Ничего добавлять
// не нужно, нужно дать ей отзывчивость: при наведении она темнеет и получает
// короткую засечку (край закладки, а не рукоятка), при перетаскивании
// становится акцентной и показывает долю экрана.
//
// Состояние — снаружи. Панель вопросов держит ширину в контексте (от неё
// зависит сдвиг всей страницы), панель источников на странице «Тьютор» — в
// своём хуке. Сгиб об этом не знает и знать не должен: он умеет только
// переводить движение курсора в число.

import { useCallback, useEffect, useRef, useState } from "react";

import { RAIL_KEYBOARD_STEP, railShareLabel } from "@/lib/rail-width";

export interface FoldResizerProps {
  /** Текущая ширина панели, px. Нужна для `aria-valuenow` и подписи. */
  width: number;
  dragging: boolean;
  /**
   * Новая ширина — расстояние от курсора до правого края окна.
   *
   * Зажим в допустимые границы делает владелец состояния: границы у панели
   * вопросов и у панели источников разные, а правило одно — не пускать сгиб
   * дальше, чем позволяет экран.
   */
  setWidth: (width: number) => void;
  setDragging: (dragging: boolean) => void;
  nudgeWidth: (delta: number) => void;
  resetWidth: () => void;
  /** Границы для клавиш Home/End. */
  bounds: (viewportWidth: number) => { min: number; max: number };
  label?: string;
  title?: string;
}

export function FoldResizer({
  width,
  dragging,
  setWidth,
  setDragging,
  nudgeWidth,
  resetWidth,
  bounds,
  label = "Ширина панели",
  title = "Потяните, чтобы изменить ширину. Двойной клик — вернуть по умолчанию",
}: FoldResizerProps) {
  const [hovered, setHovered] = useState(false);
  const [share, setShare] = useState("");
  const hideLabel = useRef<number | null>(null);

  // Подпись гаснет через полсекунды после отпускания: во время тяги она нужна,
  // после — только мешает.
  useEffect(() => {
    if (dragging) {
      if (hideLabel.current) window.clearTimeout(hideLabel.current);
      return;
    }
    if (!share) return;
    hideLabel.current = window.setTimeout(() => setShare(""), 500);
    return () => {
      if (hideLabel.current) window.clearTimeout(hideLabel.current);
    };
  }, [dragging, share]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      // Захват указателя: тяга переживает уход курсора со своей полосы —
      // иначе быстрый рывок мышью сбрасывал бы перетаскивание.
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
      // Пока тянут, выделение текста только мешает.
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    },
    [setDragging],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      // Панель прижата к правому краю, поэтому её ширина — это расстояние от
      // курсора до края окна.
      const next = window.innerWidth - event.clientX;
      setWidth(next);
      setShare(railShareLabel(next, window.innerWidth));
    },
    [dragging, setWidth],
  );

  const stop = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      setDragging(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    },
    [dragging, setDragging],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const limits = bounds(window.innerWidth);
      // Панель справа: стрелка влево делает её ШИРЕ.
      if (event.key === "ArrowLeft") nudgeWidth(RAIL_KEYBOARD_STEP);
      else if (event.key === "ArrowRight") nudgeWidth(-RAIL_KEYBOARD_STEP);
      else if (event.key === "Home") setWidth(limits.min);
      else if (event.key === "End") setWidth(limits.max);
      else return;
      event.preventDefault();
      setShare(railShareLabel(width, window.innerWidth));
    },
    [bounds, nudgeWidth, setWidth, width],
  );

  const active = dragging || hovered;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={resetWidth}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // Полоса захвата в 8 px поверх линии: в один пиксель не попасть мышью, а
      // расширять саму линию значит менять вид ради удобства.
      className="group absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize outline-none"
      title={title}
    >
      {/* Сама линия. В покое неотличима от границы панели. */}
      <span
        aria-hidden
        className={`absolute left-1 top-0 h-full transition-[width,background-color] duration-150 ${
          dragging
            ? "w-[2px] bg-[#b7792d]"
            : active
              ? "w-[2px] bg-[#c5a474]"
              : "w-px bg-transparent"
        } group-focus-visible:w-[2px] group-focus-visible:bg-[#c5a474]`}
      />

      {/* Засечка — край закладки, а не рукоятка из точек. */}
      <span
        aria-hidden
        className={`absolute left-[3px] top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-full transition-opacity duration-150 ${
          active ? "bg-[#c5a474] opacity-100" : "opacity-0"
        } group-focus-visible:opacity-100`}
      />

      {share && (
        <span
          aria-hidden
          className={`absolute left-3 top-3 rounded-full border border-[#e0dcd4] bg-[#fbfaf7] px-2 py-[2px] text-[10px] tabular-nums text-[#8a827a] shadow-[0_4px_14px_rgba(67,57,45,0.10)] transition-opacity duration-300 ${
            dragging ? "opacity-100" : "opacity-0"
          }`}
        >
          {share}
        </span>
      )}
    </div>
  );
}
