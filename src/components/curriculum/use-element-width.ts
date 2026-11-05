// Ширина элемента в пикселях: полке и пути важно знать, сколько на них помещается.

"use client";

import { type RefObject, useLayoutEffect, useState } from "react";

export function useElementWidth<T extends HTMLElement>(
  ref: RefObject<T | null>,
  fallback: number,
): number {
  const [width, setWidth] = useState(fallback);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
