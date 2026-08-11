"use client";

// Какое расписание правит помощник.
//
// Панель справа живёт в layout'е и висит на всех страницах дашборда, а
// расписание есть только на «Плане». Поэтому страница сообщает сюда, какое
// расписание сейчас на экране и что делать после подтверждения изменения, —
// ровно тем же приёмом, каким `active-subject.tsx` сообщает предмет.
//
// Почему колбэки, а не одни только идентификаторы: применённая ревизия должна
// перерисовать календарь, а перезагрузка живёт в хуке страницы (`use-schedule`).
// Тянуть её в панель значило бы завести второй источник данных о расписании.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ParsedCommitment } from "@/lib/studyplan-chat";

export interface PageSchedule {
  /**
   * Расписание, которое правим.
   *
   * `""` — расписаний у ученика нет вовсе; бэкенд в этом случае сам возьмёт
   * последнее неархивное. `null` — расписаний несколько, а занятие не выбрано:
   * помощнику непонятно, чью программу двигать, и он просит выбрать.
   */
  scheduleId: string | null;
  timeZone: string;
  /** Ревизия применена — перерисовать календарь. */
  onApplied: () => void;
  /** Записать разобранную помощником занятость. */
  onCommitments: (items: ParsedCommitment[]) => Promise<void>;
}

interface ActiveScheduleValue {
  scheduleId: string | null;
  timeZone: string;
  /** Стабильные обёртки: их можно класть в зависимости хуков без перерисовок. */
  notifyApplied: () => void;
  saveCommitments: (items: ParsedCommitment[]) => Promise<void>;
  setPageSchedule: (value: PageSchedule | null) => void;
}

/** Часовой пояс, пока страница не сказала свой. */
const FALLBACK_TIME_ZONE = "Europe/Moscow";

const ActiveScheduleContext = createContext<ActiveScheduleValue>({
  scheduleId: null,
  timeZone: FALLBACK_TIME_ZONE,
  notifyApplied: () => {},
  saveCommitments: async () => {},
  setPageSchedule: () => {},
});

export function ActiveScheduleProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // В состоянии — только примитивы: по ним панель перерисовывается. Колбэки
  // страницы пересоздаются на каждый её рендер, и держи мы их здесь же, панель
  // перерисовывалась бы вместе с календарём на каждое движение мыши.
  const [ids, setIds] = useState({
    scheduleId: null as string | null,
    timeZone: FALLBACK_TIME_ZONE,
  });
  const handlersRef = useRef<PageSchedule | null>(null);

  const setPageSchedule = useCallback((value: PageSchedule | null) => {
    handlersRef.current = value;
    const next = {
      scheduleId: value?.scheduleId ?? null,
      timeZone: value?.timeZone || FALLBACK_TIME_ZONE,
    };
    // Сравнение обязательно: `setPageSchedule` зовётся каждый рендер страницы,
    // и без него обновление состояния уходило бы в бесконечный цикл.
    setIds((current) =>
      current.scheduleId === next.scheduleId && current.timeZone === next.timeZone
        ? current
        : next,
    );
  }, []);

  const notifyApplied = useCallback(() => {
    handlersRef.current?.onApplied();
  }, []);

  const saveCommitments = useCallback(async (items: ParsedCommitment[]) => {
    const handler = handlersRef.current?.onCommitments;
    if (handler) await handler(items);
  }, []);

  const value = useMemo(
    () => ({
      scheduleId: ids.scheduleId,
      timeZone: ids.timeZone,
      notifyApplied,
      saveCommitments,
      setPageSchedule,
    }),
    [ids, notifyApplied, saveCommitments, setPageSchedule],
  );

  return (
    <ActiveScheduleContext.Provider value={value}>
      {children}
    </ActiveScheduleContext.Provider>
  );
}

export function useActiveSchedule() {
  return useContext(ActiveScheduleContext);
}

/**
 * Объявляет расписание текущей страницы.
 *
 * Синхронизация идёт БЕЗ массива зависимостей: колбэки страницы — новые ссылки
 * на каждый рендер, сравнивать их бессмысленно. Лишних перерисовок это не
 * создаёт, потому что провайдер обновляет состояние только когда сменились
 * идентификатор или часовой пояс.
 */
export function usePageSchedule(value: PageSchedule | null) {
  const { setPageSchedule } = useActiveSchedule();

  useEffect(() => {
    setPageSchedule(value);
  });

  // При уходе со страницы — сбросить, иначе панель на дневнике продолжала бы
  // считать, что правит расписание, которого на экране нет.
  useEffect(() => () => setPageSchedule(null), [setPageSchedule]);
}
