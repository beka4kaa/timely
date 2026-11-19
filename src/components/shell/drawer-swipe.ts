"use client";

// Жест для выезжающего меню на телефоне: свайп вправо открывает, влево закрывает.
//
// Свайп от самого левого края на телефоне занят системой: в Safari и на Android он
// значит «назад». Поэтому открывает только свайп, начатый не у самого края, и не над
// тем, что само тянется вбок: прокрутка (неделя, год в помодоро), ползунок, слайм.
// Пока открыто окно поверх страницы (настройки), жесты меню не работают.

import { useEffect, useRef } from "react";

export interface SwipeGesture {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  ms: number;
}

const EDGE = 20;
const OPEN_MIN = 70;
const CLOSE_MIN = 60;
const MAX_MS = 600;

export function isOpenSwipe(g: SwipeGesture): boolean {
  const dx = g.x1 - g.x0;
  return g.x0 >= EDGE && dx >= OPEN_MIN && Math.abs(g.y1 - g.y0) <= dx / 2 && g.ms <= MAX_MS;
}

export function isCloseSwipe(g: SwipeGesture): boolean {
  const dx = g.x0 - g.x1;
  return dx >= CLOSE_MIN && Math.abs(g.y1 - g.y0) <= dx / 2 && g.ms <= MAX_MS;
}

export interface SwipeNodeInfo {
  overflowX: string;
  touchAction: string;
  /** Есть ли что прокручивать вбок. */
  scrollable: boolean;
  role: string | null;
  /** `data-no-swipe`: место просит не открывать меню. */
  noSwipe: boolean;
}

/** Забирает ли этот элемент жест вбок себе. */
export function nodeBlocksOpenSwipe(node: SwipeNodeInfo): boolean {
  if (node.noSwipe || node.role === "slider") return true;
  const action = node.touchAction.split(" ");
  // none: элемент ведёт палец сам (слайм); pan-y без pan-x: жест вбок он обрабатывает сам.
  if (action.includes("none") || (action.includes("pan-y") && !action.includes("pan-x"))) return true;
  return (node.overflowX === "auto" || node.overflowX === "scroll") && node.scrollable;
}

/** Нажатие на ссылку в меню закрывает его: на текущей странице адрес не меняется, и само
 * меню не закрылось бы. «Тьютор» в чате открывает в меню список чатов, его не закрывает. */
export function linkClosesDrawer(href: string | null, view: string | null): boolean {
  if (!href) return false;
  return !(view === "chat" && href === "/dashboard/chat");
}

/** Начат ли жест внутри места, которое само тянется вбок. */
function startsInOwnGesture(target: Element | null): boolean {
  for (let node = target; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    const info = {
      overflowX: style.overflowX,
      touchAction: style.touchAction,
      scrollable: node.scrollWidth > node.clientWidth + 1,
      role: node.getAttribute("role"),
      noSwipe: node.hasAttribute("data-no-swipe"),
    };
    if (nodeBlocksOpenSwipe(info)) return true;
  }
  return false;
}

function startsInField(target: Element | null): boolean {
  return Boolean(target?.closest("input, textarea, select, [contenteditable='true'], .ti-host"));
}

/** Слушает жесты на телефоне (до 640 px). На компьютере ничего не делает. */
export function useDrawerSwipe(open: boolean, setOpen: (open: boolean) => void): void {
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    const phone = window.matchMedia("(max-width: 640px)");
    let start: { x: number; y: number; t: number; skip: boolean } | null = null;

    const onStart = (event: TouchEvent) => {
      if (!phone.matches || event.touches.length !== 1 || document.querySelector("dialog[open]")) {
        start = null;
        return;
      }
      const touch = event.touches[0];
      const target = event.target as Element | null;
      start = {
        x: touch.clientX,
        y: touch.clientY,
        t: performance.now(),
        // Открывать не мешает только «чистое» место; закрывать можно откуда угодно.
        skip: !openRef.current && (startsInOwnGesture(target) || startsInField(target)),
      };
    };

    const onEnd = (event: TouchEvent) => {
      if (!start || start.skip) {
        start = null;
        return;
      }
      const touch = event.changedTouches[0];
      const gesture = { x0: start.x, y0: start.y, x1: touch.clientX, y1: touch.clientY, ms: performance.now() - start.t };
      start = null;
      if (!openRef.current && isOpenSwipe(gesture)) setOpen(true);
      else if (openRef.current && isCloseSwipe(gesture)) setOpen(false);
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
    };
  }, [setOpen]);
}
