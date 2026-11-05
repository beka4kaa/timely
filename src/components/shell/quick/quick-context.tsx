"use client";

// Что общего у мини-окна на всех страницах: урок, указанный курсором, и голос.
//
// Поле ввода своё у каждого режима окна (вопрос по книге, помощник по плану), а эти
// две вещи работают одинаково и переживают смену режима.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { mascot } from "@/components/shell/mascot/mascot";

/** Что можно указать на странице. Страницы помечают своё атрибутом `data-attach`. */
const PICK = ".blk, .row, .now, .td, .tps li, .tp, .book:not(.mini), [data-attach]";

export interface Attached {
  el: HTMLElement;
  label: string;
}

interface Heard {
  id: number;
  text: string;
  final: boolean;
}

interface QuickValue {
  picking: boolean;
  startPick: () => void;
  stopPick: () => void;
  attached: Attached[];
  attach: (el: HTMLElement) => void;
  detach: (el: HTMLElement) => void;
  clearAttached: () => void;
  /** На странице есть что указать. Пересчитывается при каждом открытии окна. */
  pickableCount: () => number;
  voiceSupported: boolean;
  listening: boolean;
  listen: () => void;
  stopListening: () => void;
  heard: Heard | null;
  /** Куда окно ставит подсказки над собой. */
  suggestSlot: HTMLElement | null;
  setSuggestSlot: (element: HTMLElement | null) => void;
}

const QuickContext = createContext<QuickValue | null>(null);

function labelOf(el: HTMLElement): string {
  if (el.dataset.attach) return el.dataset.attach;
  const text = el.querySelector("span:not(.n):not(.ring):not(.ring-arc):not(.ring-head)");
  return (text ?? el).textContent?.trim().slice(0, 120) ?? "";
}

function candidates(): HTMLElement[] {
  const main = document.querySelector(".main");
  if (!main) return [];
  return Array.from(main.querySelectorAll<HTMLElement>(PICK)).filter((el) => el.offsetParent !== null);
}

function pickTarget(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  const el = node.closest<HTMLElement>(PICK);
  return el && el.closest(".main") ? el : null;
}

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function recognitionCtor(): (new () => RecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as {
    SpeechRecognition?: new () => RecognitionLike;
    webkitSpeechRecognition?: new () => RecognitionLike;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

export function QuickProvider({ children }: { children: React.ReactNode }) {
  const [picking, setPicking] = useState(false);
  const [attached, setAttached] = useState<Attached[]>([]);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState<Heard | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [suggestSlot, setSuggestSlot] = useState<HTMLElement | null>(null);
  const recognition = useRef<RecognitionLike | null>(null);

  useEffect(() => {
    setVoiceSupported(Boolean(recognitionCtor()));
  }, []);

  const attach = useCallback((el: HTMLElement) => {
    el.classList.add("pick-on");
    setAttached((list) => (list.some((row) => row.el === el) ? list : [...list, { el, label: labelOf(el) }]));
  }, []);

  const detach = useCallback((el: HTMLElement) => {
    el.classList.remove("pick-on");
    setAttached((list) => list.filter((row) => row.el !== el));
  }, []);

  const clearAttached = useCallback(() => {
    setAttached((list) => {
      for (const row of list) row.el.classList.remove("pick-on");
      return [];
    });
  }, []);

  const stopPick = useCallback(() => setPicking(false), []);
  const startPick = useCallback(() => setPicking(true), []);

  // Режим указания: курсор-прицел, подсветка под мышью, ярлык у курсора.
  useEffect(() => {
    if (!picking) return;
    const root = document.documentElement;
    const tag = document.createElement("span");
    tag.className = "pick-tag is-off";
    tag.setAttribute("aria-hidden", "true");
    tag.textContent = "Прикрепить";
    document.body.appendChild(tag);
    root.classList.add("picking");
    const list = candidates();
    for (const el of list) el.classList.add("pickable");
    let hot: HTMLElement | null = null;

    const onMove = (event: PointerEvent) => {
      const el = pickTarget(event.target);
      if (el !== hot) {
        hot?.classList.remove("pick-hot");
        hot = el;
        hot?.classList.add("pick-hot");
      }
      tag.classList.toggle("is-off", !hot);
      tag.style.transform = `translate(${event.clientX + 14}px, ${event.clientY + 16}px)`;
    };
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(".q-pickbar")) return;
      event.preventDefault();
      event.stopPropagation();
      const el = pickTarget(event.target);
      if (!el) return;
      attach(el);
      setPicking(false);
      mascot.hop(0.42, "quiet");
    };
    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("click", onClick, true);
      root.classList.remove("picking");
      for (const el of list) el.classList.remove("pickable");
      hot?.classList.remove("pick-hot");
      tag.remove();
    };
  }, [picking, attach]);

  const stopListening = useCallback(() => {
    recognition.current?.stop();
  }, []);

  const listen = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || recognition.current) return;
    const rec = new Ctor();
    rec.lang = "ru-RU";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (event) => {
      const results = Array.from(event.results);
      const text = results.map((result) => result[0]?.transcript ?? "").join(" ").trim();
      const final = results.every((result) => result.isFinal);
      setHeard({ id: Date.now(), text, final });
    };
    rec.onend = () => {
      recognition.current = null;
      setListening(false);
    };
    rec.onerror = () => {
      recognition.current = null;
      setListening(false);
    };
    recognition.current = rec;
    setHeard(null);
    setListening(true);
    rec.start();
  }, []);

  useEffect(() => () => recognition.current?.stop(), []);

  const value = useMemo<QuickValue>(
    () => ({
      picking,
      startPick,
      stopPick,
      attached,
      attach,
      detach,
      clearAttached,
      pickableCount: () => candidates().length,
      voiceSupported,
      listening,
      listen,
      stopListening,
      heard,
      suggestSlot,
      setSuggestSlot,
    }),
    [
      picking,
      startPick,
      stopPick,
      attached,
      attach,
      detach,
      clearAttached,
      voiceSupported,
      listening,
      listen,
      stopListening,
      heard,
      suggestSlot,
    ],
  );

  return <QuickContext.Provider value={value}>{children}</QuickContext.Provider>;
}

export function useQuick(): QuickValue {
  const value = useContext(QuickContext);
  if (!value) throw new Error("useQuick вне QuickProvider");
  return value;
}

/** Текст запроса с тем, что указано курсором: модель читает это как контекст. */
export function withAttached(text: string, attached: Attached[]): string {
  if (!attached.length) return text;
  const labels = attached.map((row) => `«${row.label}»`).join(", ");
  return text ? `${labels}: ${text}` : labels;
}
