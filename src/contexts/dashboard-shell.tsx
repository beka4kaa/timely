"use client";

// Состояние каркаса дашборда, которое делят между собой несколько его частей.
//
// Закреплённый рейл сдвигает и шапку, и страницу — значит, о нём должны знать
// обе. Место в шапке под полосу недели нужно странице «Сейчас»: она рисует
// туда свой компонент порталом, а шапка остаётся общей для всех разделов.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const PINNED_KEY = "timely.nav.pinned";

/**
 * С какой ширины рейл можно закрепить. Закреплённый занимает 248 px, и на
 * планшете странице остаётся полоса: колонка чата сжималась до 29 px.
 */
const PIN_QUERY = "(min-width: 1280px)";

interface DashboardShellValue {
  /** Рейл закреплён раскрытым: он не перекрывает страницу, а сдвигает её. */
  pinned: boolean;
  /** Экран достаточно широк, чтобы закреплять. */
  canPin: boolean;
  /**
   * Сохранённое состояние уже применено. До этого каркас не анимирует сдвиги:
   * иначе закреплённый рейл и открытая панель тьютора на каждом заходе
   * выезжали бы из свёрнутого положения.
   */
  ready: boolean;
  togglePinned: () => void;
  /** Середина шапки. `null`, пока шапка не смонтирована или её нет вовсе. */
  headerSlot: HTMLElement | null;
  setHeaderSlot: (element: HTMLElement | null) => void;
}

const DashboardShellContext = createContext<DashboardShellValue>({
  pinned: false,
  canPin: false,
  ready: false,
  togglePinned: () => {},
  headerSlot: null,
  setHeaderSlot: () => {},
});

export function DashboardShellProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [stored, setStored] = useState(false);
  const [canPin, setCanPin] = useState(false);
  const [ready, setReady] = useState(false);
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

  // Читается после монтирования: на сервере localStorage нет, и разметка
  // разошлась бы с первой отрисовкой в браузере.
  useEffect(() => {
    try {
      setStored(window.localStorage.getItem(PINNED_KEY) === "1");
    } catch {
      // Приватный режим без хранилища — рейл просто не запоминается.
    }
    const query = window.matchMedia(PIN_QUERY);
    const sync = () => setCanPin(query.matches);
    sync();
    query.addEventListener("change", sync);
    // Два кадра: первый отрисует восстановленное положение, второй включит
    // анимации для всего, что ученик сделает дальше.
    let second = 0;
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => setReady(true));
    });
    return () => {
      query.removeEventListener("change", sync);
      window.cancelAnimationFrame(first);
      window.cancelAnimationFrame(second);
    };
  }, []);

  const togglePinned = useCallback(() => {
    setStored((current) => {
      try {
        window.localStorage.setItem(PINNED_KEY, current ? "0" : "1");
      } catch {
        // См. выше.
      }
      return !current;
    });
  }, []);

  // Выбор помнится и на узком окне, но действует только на широком: сузил
  // окно — рейл свернулся, расширил — вернулся закреплённым.
  const pinned = stored && canPin;

  const value = useMemo(
    () => ({ pinned, canPin, ready, togglePinned, headerSlot, setHeaderSlot }),
    [pinned, canPin, ready, togglePinned, headerSlot],
  );

  return (
    <DashboardShellContext.Provider value={value}>
      {children}
    </DashboardShellContext.Provider>
  );
}

export function useDashboardShell() {
  return useContext(DashboardShellContext);
}
