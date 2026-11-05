"use client";

// Открыто ли мини-окно и что ему передали со страницы.
//
// Состояние вынесено из самого окна, потому что его открывают отовсюду: «Нужна помощь»
// на карточке, «Спросить» у слайма, блок плана. На телефоне страница под окном остаётся,
// поэтому при уходе на узкий экран оно закрывается само.

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

/**
 * Просьба открыть окно с готовым контекстом.
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
  /** На этой странице окна нет вовсе: на странице чата своё поле. */
  hidden: boolean;
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
});

const MOBILE_BREAKPOINT = 768;

export function AskRailProvider({ children }: { children: React.ReactNode }) {
  const [remembered, setOpen] = useState(false);
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
      // Только при переходе в узкий экран, а не на каждый resize: на Android размер меняет
      // и выехавшая клавиатура, и окно закрывалось бы прямо под пальцами.
      if (mobile && wasMobile !== true) setOpen(false);
      wasMobile = mobile;
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const openFor = useCallback((target: FocusRequest["target"]) => {
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
    ],
  );
  return <AskRailContext.Provider value={value}>{children}</AskRailContext.Provider>;
}

export function useAskRail() {
  return useContext(AskRailContext);
}
