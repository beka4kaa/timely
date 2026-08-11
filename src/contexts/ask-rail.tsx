"use client";

// Открыта ли панель вопросов и какой она ширины.
//
// Состояние вынесено из самой панели, потому что от него зависит ширина
// `<main>`: панель не перекрывает страницу, а сдвигает её — так же, как чат
// доски сдвигает холст. Значит, о ней должен знать и контент.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";

import { isRailFreeRoute } from "@/config/rail-free-routes";
import {
  RAIL_KEYBOARD_STEP,
  clampRailWidth,
  defaultRailWidth,
  restoreRailWidth,
} from "@/lib/rail-width";

const OPEN_KEY = "timely.ask.open";
const WIDTH_KEY = "timely.ask.width";

interface AskRailValue {
  open: boolean;
  toggle: () => void;
  /**
   * Панели на этой странице нет вовсе.
   *
   * Читается и самой панелью (ранний `return null`), и здесь: `open` при этом
   * принудительно `false`, иначе `DashboardMain` сдвинул бы контент вправо под
   * панель, которой не существует.
   */
  hidden: boolean;
  /** Узкий экран: там панель перекрывает страницу, а не сдвигает её. */
  isMobile: boolean;
  /** Текущая ширина в пикселях. Ноль до первого замера окна. */
  width: number;
  /** Идёт перетаскивание: анимацию на это время снимают. */
  dragging: boolean;
  setWidth: (width: number) => void;
  setDragging: (dragging: boolean) => void;
  nudgeWidth: (delta: number) => void;
  resetWidth: () => void;
}

const AskRailContext = createContext<AskRailValue>({
  open: false,
  toggle: () => {},
  hidden: false,
  isMobile: false,
  width: 0,
  dragging: false,
  setWidth: () => {},
  setDragging: () => {},
  nudgeWidth: () => {},
  resetWidth: () => {},
});

const MOBILE_BREAKPOINT = 768;

export function AskRailProvider({ children }: { children: React.ReactNode }) {
  const [remembered, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [width, setWidthState] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Выбор ученика запоминается, но на странице «Тьютор» не действует: уйдя с
  // неё, он найдёт панель в том же состоянии, в каком оставил.
  const hidden = isRailFreeRoute(usePathname() ?? "");
  const open = remembered && !hidden;

  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT;
      setIsMobile(mobile);
      // На узком экране панель занимает его целиком, и раскрытой по памяти
      // она закрыла бы страницу, на которую ученик только что перешёл.
      if (mobile) setOpen(false);
      // Окно могло уменьшиться: прежняя ширина оставила бы от страницы полосу.
      setWidthState((current) =>
        current ? clampRailWidth(current, window.innerWidth) : current,
      );
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    setWidthState(
      restoreRailWidth(window.localStorage.getItem(WIDTH_KEY), window.innerWidth),
    );
    if (window.innerWidth >= MOBILE_BREAKPOINT) {
      setOpen(window.localStorage.getItem(OPEN_KEY) === "1");
    }
  }, []);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      window.localStorage.setItem(OPEN_KEY, prev ? "0" : "1");
      return !prev;
    });
  }, []);

  const setWidth = useCallback((next: number) => {
    const clamped = clampRailWidth(next, window.innerWidth);
    setWidthState(clamped);
    // Ширина принадлежит экрану, а не ученику: на ноутбуке и на мониторе
    // удобны разные, поэтому localStorage, а не профиль на сервере.
    window.localStorage.setItem(WIDTH_KEY, String(clamped));
  }, []);

  const nudgeWidth = useCallback(
    (delta: number) => setWidth((width || defaultRailWidth(window.innerWidth)) + delta),
    [setWidth, width],
  );

  const resetWidth = useCallback(
    () => setWidth(defaultRailWidth(window.innerWidth)),
    [setWidth],
  );

  const value = useMemo(
    () => ({
      open,
      toggle,
      hidden,
      isMobile,
      width,
      dragging,
      setWidth,
      setDragging,
      nudgeWidth,
      resetWidth,
    }),
    [
      open,
      toggle,
      hidden,
      isMobile,
      width,
      dragging,
      setWidth,
      nudgeWidth,
      resetWidth,
    ],
  );
  return <AskRailContext.Provider value={value}>{children}</AskRailContext.Provider>;
}

export function useAskRail() {
  return useContext(AskRailContext);
}

export { RAIL_KEYBOARD_STEP };
