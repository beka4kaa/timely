"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

// Инерционная прокрутка только для лендинга: колесо мыши ведёт страницу
// плавно, а сцены из scroll-fx двигаются вслед за ней. Тач и клавиатура
// остаются нативными; при prefers-reduced-motion Lenis не включается вовсе.

let instance: Lenis | null = null;

/** Плавно прокрутить к позиции — через Lenis, если он запущен. */
export function scrollToY(y: number) {
  if (instance) instance.scrollTo(y, { duration: 1.1 });
  else window.scrollTo({ top: y, behavior: "smooth" });
}

export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const lenis = new Lenis({ lerp: 0.09 });
    instance = lenis;

    let raf = requestAnimationFrame(function loop(time) {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    });

    // Якоря в шапке. Встроенный `anchors` у Lenis не отменяет нативный прыжок,
    // и на кадр страница дёргается к цели, — поэтому перехватываем сами.
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest('a[href^="#"]');
      const id = link?.getAttribute("href")?.slice(1);
      const target = id ? document.getElementById(id) : null;
      if (!target) return;
      event.preventDefault();
      // Поправка на липкую шапку.
      lenis.scrollTo(target, { offset: -84 });
    };
    document.addEventListener("click", onClick);

    return () => {
      document.removeEventListener("click", onClick);
      cancelAnimationFrame(raf);
      lenis.destroy();
      instance = null;
    };
  }, []);

  return null;
}
