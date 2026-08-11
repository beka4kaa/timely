"use client";

// Сгиб разворота: граница страницы и панели, за которую тянут.
//
// Ответ по умолчанию для ресайза — серая полоса в четыре пикселя, синеющая при
// наведении, или щепотка точек «⋮⋮». Так делает каждая IDE, и к книге это
// отношения не имеет.
//
// Здесь граница уже нарисована — это волосяная линия панели. Ничего добавлять
// не нужно, нужно дать ей отзывчивость: короткая засечка (край закладки, а не
// рукоятка из точек) при наведении вырастает и теплеет, при перетаскивании
// становится акцентной и показывает долю экрана.
//
// Засечка видна В ПОКОЕ. Прозрачной её не оставить: ровно так и вышло, что
// панель никто не тянул, — тянули соседнюю доску, где такая же ручка видна
// всегда (`whiteboard/page.tsx`). Цвета и размеры взяты оттуда же: две панели
// должны ощущаться одним механизмом, а не двумя похожими.
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
  // Идентификатор тянущего указателя. В рефе, а не в состоянии: движение
  // читает его на каждый кадр, а перерисовок между кадрами может не быть
  // вовсе — ширина панели вопросов живёт в контексте всего дашборда.
  const dragRef = useRef<number | null>(null);

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

  // Тяга слушает ОКНО, а не свою полосу в двенадцать пикселей.
  //
  // Полоса — цель только для нажатия. Дальше курсор уходит куда угодно: на
  // соседнюю страницу, на её полосу прокрутки, за край окна, — и всюду тяга
  // должна продолжаться. `setPointerCapture` это в теории и обещает, но
  // держится на том, что события доедут до самого элемента; слушатель на окне
  // не зависит ни от этого, ни от перерисовок дерева между кадрами.
  useEffect(() => {
    if (!dragging) return;

    const move = (event: PointerEvent) => {
      if (dragRef.current !== null && event.pointerId !== dragRef.current) return;
      // Панель прижата к правому краю, поэтому её ширина — это расстояние от
      // курсора до края окна.
      const next = window.innerWidth - event.clientX;
      setWidth(next);
      setShare(railShareLabel(next, window.innerWidth));
    };

    const stop = () => {
      dragRef.current = null;
      setDragging(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    // Курсор мог уйти за пределы окна и отпуститься там.
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
      // Размонтировали посреди тяги — курсор и выделение вернуть обязаны.
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, [dragging, setWidth, setDragging]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Только основная кнопка: правой кнопкой панель не тянут.
      if (event.button !== 0) return;
      event.preventDefault();
      dragRef.current = event.pointerId;
      setDragging(true);
      // Пока тянут, выделение текста только мешает.
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    },
    [setDragging],
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
      onDoubleClick={resetWidth}
      onKeyDown={onKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // Полоса захвата в 12 px и ЦЕЛИКОМ внутри панели. Раньше она торчала на
      // четыре пикселя наружу и там ложилась на прокручиваемый `<main>` — то
      // есть половина цели приходилась на чужую полосу прокрутки.
      //
      // `touch-none` обязателен: без него тяга пальцем уходит в прокрутку.
      className="group absolute left-0 top-0 z-10 h-full w-3 cursor-col-resize touch-none outline-none"
      title={title}
    >
      {/* Линия. В покое неотличима от границы панели. */}
      <span
        aria-hidden
        className={`absolute left-0 top-0 h-full transition-[width,background-color] duration-150 ${
          dragging
            ? "w-[2px] bg-[#b7792d]"
            : active
              ? "w-[2px] bg-[#c5a474]"
              : "w-px bg-transparent"
        } group-focus-visible:w-[2px] group-focus-visible:bg-[#c5a474]`}
      />

      {/* Засечка — край закладки, а не рукоятка из точек. Видна всегда: за
          невидимую кромку никто не тянет. */}
      <span
        aria-hidden
        className={`absolute left-[3px] top-1/2 w-[3px] -translate-y-1/2 rounded-full transition-[height,background-color,box-shadow] duration-150 ${
          dragging
            ? "h-20 bg-[#a9773b] shadow-[0_0_0_4px_rgba(185,133,70,0.12)]"
            : hovered
              ? "h-20 bg-[#aa7a42]"
              : "h-14 bg-[#d4cec4]"
        } group-focus-visible:h-20 group-focus-visible:bg-[#aa7a42] group-focus-visible:shadow-[0_0_0_4px_rgba(185,133,70,0.12)]`}
      />

      {share && (
        <span
          aria-hidden
          className={`absolute left-4 top-3 rounded-full border border-[#e0dcd4] bg-[#fbfaf7] px-2 py-[2px] text-[10px] tabular-nums text-[#8a827a] shadow-[0_4px_14px_rgba(67,57,45,0.10)] transition-opacity duration-300 ${
            dragging ? "opacity-100" : "opacity-0"
          }`}
        >
          {share}
        </span>
      )}
    </div>
  );
}
