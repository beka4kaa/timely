"use client";

// Ширина сворачиваемой колонки, которую тянут за сгиб.
//
// Панель вопросов держит своё такое же состояние в контексте: от неё зависит
// сдвиг всей страницы, и знать о ней должен и контент. Панели источников
// сдвигать нечего — она внутри страницы, — поэтому состояние местное. Общее у
// них только правило зажима, и оно здесь.

import { useCallback, useEffect, useMemo, useState } from "react";

export interface FoldWidthOptions {
  /** Ключ в localStorage. Ширина принадлежит экрану, а не профилю. */
  storageKey: string;
  initial: number;
  min: number;
  /** Потолок в пикселях: шире панель источников бесполезна. */
  max: number;
  /** И потолок долей окна: на ноутбуке 520 px — это половина экрана. */
  maxShare: number;
}

export interface FoldWidth {
  width: number;
  dragging: boolean;
  setWidth: (width: number) => void;
  setDragging: (dragging: boolean) => void;
  nudgeWidth: (delta: number) => void;
  resetWidth: () => void;
  bounds: (viewportWidth: number) => { min: number; max: number };
}

export function useFoldWidth(options: FoldWidthOptions): FoldWidth {
  const { storageKey, initial, min, max, maxShare } = options;
  const [width, setWidthState] = useState(initial);
  const [dragging, setDragging] = useState(false);

  const bounds = useCallback(
    (viewportWidth: number) => {
      const ceiling = Math.round(Math.min(max, viewportWidth * maxShare));
      // На узком окне потолок может оказаться ниже пола: тогда колонка просто
      // занимает свою долю, а не выдавливает чтение.
      return { min: Math.min(min, ceiling), max: ceiling };
    },
    [min, max, maxShare],
  );

  const clamp = useCallback(
    (value: number) => {
      const limits = bounds(window.innerWidth);
      if (!Number.isFinite(value)) return limits.max;
      return Math.round(Math.min(limits.max, Math.max(limits.min, value)));
    },
    [bounds],
  );

  useEffect(() => {
    const stored = Number.parseInt(
      window.localStorage.getItem(storageKey) ?? "",
      10,
    );
    setWidthState(clamp(Number.isFinite(stored) && stored > 0 ? stored : initial));
    // Окно могло уменьшиться с прошлого раза — пересчитываем при изменении.
    const onResize = () => setWidthState((current) => clamp(current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [storageKey, initial, clamp]);

  const setWidth = useCallback(
    (next: number) => {
      const clamped = clamp(next);
      setWidthState(clamped);
      window.localStorage.setItem(storageKey, String(clamped));
    },
    [clamp, storageKey],
  );

  const nudgeWidth = useCallback(
    (delta: number) => setWidth(width + delta),
    [setWidth, width],
  );

  const resetWidth = useCallback(() => setWidth(initial), [setWidth, initial]);

  return useMemo(
    () => ({
      width,
      dragging,
      setWidth,
      setDragging,
      nudgeWidth,
      resetWidth,
      bounds,
    }),
    [width, dragging, setWidth, nudgeWidth, resetWidth, bounds],
  );
}
