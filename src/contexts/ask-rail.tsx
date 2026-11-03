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
  useRef,
  useState,
} from "react";
import { isRailFreeRoute } from "@/config/rail-free-routes";
import { useDashboardPath } from "@/lib/use-dashboard-path";
import {
  RAIL_KEYBOARD_STEP,
  clampRailWidth,
  defaultRailWidth,
  restoreRailWidth,
} from "@/lib/rail-width";

const OPEN_KEY = "timely.ask.open";
const WIDTH_KEY = "timely.ask.width";

/**
 * Просьба открыть панель с готовым контекстом.
 *
 * Так другие части дашборда передают в панель вопрос, не зная, как устроен
 * разговор внутри: карточка «Сейчас» просит помочь с блоком, тьютор на
 * главной — продолжить вчерашний чат. Панель забирает просьбу, когда готова
 * её выполнить, и отмечает выполненной через `consumePrompt`.
 */
export interface AskPrompt {
  id: number;
  /** Какая панель должна ответить: по книге (по умолчанию) или по расписанию. */
  target: "book" | "schedule";
  /** Предмет разговора. `undefined` — оставить выбранный в панели. */
  goalId?: string | null;
  /** Расписание, к которому относится просьба помощнику по расписанию. */
  scheduleId?: string;
  /** Открыть сохранённый разговор вместо нового. */
  chatId?: string;
  /** Текст вопроса. */
  text?: string;
  /** `true` — отправить сразу, иначе только подставить в поле. */
  send?: boolean;
}

export interface FocusRequest {
  id: number;
  /** Какой панели отдать фокус. `any` — той, что откроется на этой странице. */
  target: "book" | "schedule" | "any";
}

interface AskRailValue {
  open: boolean;
  toggle: () => void;
  /** Открыть, не переключая: повторный вызов не закрывает панель. */
  openRail: () => void;
  /** Открыть панель и передать ей вопрос или разговор. */
  prompt: (request: Omit<AskPrompt, "id">) => void;
  /** Ещё не выполненная просьба. */
  pending: AskPrompt | null;
  consumePrompt: (id: number) => void;
  /**
   * Просьба перевести фокус в поле панели — когда её открыли извне: из рейла,
   * нижней панели, с главной. Иначе с клавиатуры до панели пришлось бы идти
   * через всю страницу. Просьба одноразовая и адресная: её забирает панель
   * нужного вида (`consumeFocus`), и обычный переход между страницами,
   * пересоздающий панель, фокус больше не крадёт.
   */
  focusRequest: FocusRequest | null;
  consumeFocus: (id: number) => void;
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
  openRail: () => {},
  prompt: () => {},
  pending: null,
  consumePrompt: () => {},
  focusRequest: null,
  consumeFocus: () => {},
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
  const [pending, setPending] = useState<AskPrompt | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  /** Откуда открыли: закрыв панель, фокус возвращается туда. */
  const openerRef = useRef<HTMLElement | null>(null);

  // Выбор ученика запоминается, но на странице «Тьютор» не действует: уйдя с
  // неё, он найдёт панель в том же состоянии, в каком оставил.
  //
  // Путь берётся канонический: на app-хосте в адресной строке `/chat`, и
  // сравнение с `/dashboard/chat` там не срабатывало вовсе.
  const hidden = isRailFreeRoute(useDashboardPath());
  const open = remembered && !hidden;

  useEffect(() => {
    let wasMobile: boolean | null = null;
    const check = () => {
      const mobile = window.innerWidth < MOBILE_BREAKPOINT;
      setIsMobile(mobile);
      // На узком экране панель занимает его целиком, и раскрытой по памяти
      // она закрыла бы страницу, на которую ученик только что перешёл. Только
      // при переходе в узкий экран, а не на каждый resize: на Android его шлёт
      // и выехавшая клавиатура, и панель закрывалась бы под пальцем.
      if (mobile && wasMobile !== true) setOpen(false);
      wasMobile = mobile;
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

  const openFor = useCallback((target: FocusRequest["target"]) => {
    window.localStorage.setItem(OPEN_KEY, "1");
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setOpen(true);
    setFocusRequest({ id: Date.now(), target });
  }, []);

  // Без аргументов: её же вешают прямо на onClick, и событие клика не должно
  // превращаться в адресата.
  const openRail = useCallback(() => openFor("any"), [openFor]);

  const consumeFocus = useCallback((id: number) => {
    setFocusRequest((current) => (current?.id === id ? null : current));
  }, []);

  const closeRail = useCallback(() => {
    window.localStorage.setItem(OPEN_KEY, "0");
    setOpen(false);
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener?.isConnected) window.requestAnimationFrame(() => opener.focus());
  }, []);

  const openNow = useRef(open);
  openNow.current = open;
  const toggle = useCallback(() => {
    if (openNow.current) closeRail();
    else openRail();
  }, [closeRail, openRail]);

  const prompt = useCallback(
    (request: Omit<AskPrompt, "id">) => {
      setPending({ ...request, id: Date.now() });
      openFor(request.target);
    },
    [openFor],
  );

  const consumePrompt = useCallback((id: number) => {
    setPending((current) => (current?.id === id ? null : current));
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
      openRail,
      prompt,
      pending,
      consumePrompt,
      focusRequest,
      consumeFocus,
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
      openRail,
      prompt,
      pending,
      consumePrompt,
      focusRequest,
      consumeFocus,
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
