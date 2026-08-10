"use client";

// Открыта ли панель вопросов.
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

const OPEN_KEY = "timely.ask.open";

interface AskRailValue {
  open: boolean;
  toggle: () => void;
  /** Узкий экран: там панель перекрывает страницу, а не сдвигает её. */
  isMobile: boolean;
}

const AskRailContext = createContext<AskRailValue>({
  open: false,
  toggle: () => {},
  isMobile: false,
});

const MOBILE_BREAKPOINT = 768;

export function AskRailProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT;
      setIsMobile(mobile);
      // На узком экране панель занимает его целиком, и раскрытой по памяти
      // она закрыла бы страницу, на которую ученик только что перешёл.
      if (mobile) setOpen(false);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
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

  const value = useMemo(() => ({ open, toggle, isMobile }), [open, toggle, isMobile]);
  return <AskRailContext.Provider value={value}>{children}</AskRailContext.Provider>;
}

export function useAskRail() {
  return useContext(AskRailContext);
}
