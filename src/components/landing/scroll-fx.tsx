"use client";

import {
  createElement,
  useEffect,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";

// Сцены, привязанные к прокрутке.
//
// Один общий rAF на всю страницу: на каждое событие прокрутки читаем
// положение всех зарегистрированных элементов, потом одним проходом пишем
// каждому его прогресс в CSS-переменную `--p` (0…1). Сами движения описаны
// в CSS через var(--p) — так их легко крутить и легко отключить для
// prefers-reduced-motion.

export type ScrollMode =
  /** 0 — верх элемента у нижнего края экрана, 1 — низ ушёл за верхний. */
  | "through"
  /** 0 — верх у нижнего края экрана, 1 — верх поднялся до `end` высоты экрана. */
  | "enter"
  /** 0 — верх элемента у верха экрана, 1 — элемент целиком ушёл вверх. */
  | "exit"
  /** Для липких сцен: 0…1 по длине прокрутки, пока сцена приклеена. */
  | "stage";

type Entry = {
  mode: ScrollMode;
  end: number;
  last: number;
  onProgress?: (p: number) => void;
};

const entries = new Map<HTMLElement, Entry>();
let frame = 0;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function measure(entry: Entry, rect: DOMRect, vh: number) {
  switch (entry.mode) {
    case "through":
      return (vh - rect.top) / (vh + rect.height);
    case "enter":
      return (vh - rect.top) / (vh * (1 - entry.end));
    case "exit":
      return -rect.top / rect.height;
    case "stage":
      return -rect.top / Math.max(rect.height - vh, 1);
  }
}

function update() {
  frame = 0;
  const vh = window.innerHeight;
  const next: Array<[HTMLElement, Entry, number]> = [];
  entries.forEach((entry, el) => {
    next.push([el, entry, clamp01(measure(entry, el.getBoundingClientRect(), vh))]);
  });
  for (const [el, entry, p] of next) {
    if (Math.abs(p - entry.last) < 0.0005) continue;
    entry.last = p;
    el.style.setProperty("--p", p.toFixed(4));
    entry.onProgress?.(p);
  }
}

function request() {
  if (!frame) frame = requestAnimationFrame(update);
}

/** Следить за элементом; возвращает функцию отписки. */
export function watchScroll(
  el: HTMLElement,
  mode: ScrollMode,
  options: { end?: number; onProgress?: (p: number) => void } = {},
) {
  if (entries.size === 0) {
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request);
  }
  entries.set(el, { mode, end: options.end ?? 0.3, last: -1, onProgress: options.onProgress });
  request();

  return () => {
    entries.delete(el);
    if (entries.size > 0) return;
    window.removeEventListener("scroll", request);
    window.removeEventListener("resize", request);
    cancelAnimationFrame(frame);
    frame = 0;
  };
}

export function ScrollFx({
  mode,
  end,
  as = "div",
  className,
  style,
  children,
}: {
  mode: ScrollMode;
  end?: number;
  as?: "div" | "section";
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return watchScroll(el, mode, { end });
  }, [mode, end]);

  return createElement(as, { ref, className, style }, children);
}
