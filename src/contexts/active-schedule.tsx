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
import type { ScheduleTargetOption } from "@/components/studyplan/schedule-targets";

export interface PageSchedule {
  /**
   * Расписание, которое правим.
   *
   * `""` — расписаний у ученика нет вовсе. `null` — страница ещё грузится или
   * уже размонтирована; запросы помощника в этом состоянии не отправляются.
   */
  scheduleId: string | null;
  /** Несхлопнутые живые версии, доступные как target чата и /plan. */
  scheduleOptions: ScheduleTargetOption[];
  timeZone: string;
  /** Явно выбрать, к какому расписанию относится следующий запрос. */
  onSelectSchedule: (scheduleId: string) => void;
  /** Перерисовать календарь и, если передан id, выбрать созданный вариант. */
  onApplied: (preferredScheduleId?: string) => boolean | Promise<boolean>;
  /** Записать разобранную помощником занятость. */
  onCommitments: (items: ParsedCommitment[]) => Promise<void>;
}

interface ActiveScheduleValue {
  scheduleId: string | null;
  scheduleOptions: ScheduleTargetOption[];
  timeZone: string;
  /** Стабильные обёртки: их можно класть в зависимости хуков без перерисовок. */
  notifyApplied: (preferredScheduleId?: string) => Promise<boolean>;
  saveCommitments: (items: ParsedCommitment[]) => Promise<void>;
  selectSchedule: (scheduleId: string) => void;
  setPageSchedule: (value: PageSchedule | null) => void;
}

/** Часовой пояс, пока страница не сказала свой. */
const FALLBACK_TIME_ZONE = "Europe/Moscow";

const ActiveScheduleContext = createContext<ActiveScheduleValue>({
  scheduleId: null,
  scheduleOptions: [],
  timeZone: FALLBACK_TIME_ZONE,
  notifyApplied: async () => false,
  saveCommitments: async () => {},
  selectSchedule: () => {},
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
    scheduleOptions: [] as ScheduleTargetOption[],
    timeZone: FALLBACK_TIME_ZONE,
  });
  const handlersRef = useRef<PageSchedule | null>(null);

  const setPageSchedule = useCallback((value: PageSchedule | null) => {
    handlersRef.current = value;
    const next = {
      scheduleId: value?.scheduleId ?? null,
      scheduleOptions: value?.scheduleOptions ?? [],
      timeZone: value?.timeZone || FALLBACK_TIME_ZONE,
    };
    // Сравнение обязательно: `setPageSchedule` зовётся каждый рендер страницы,
    // и без него обновление состояния уходило бы в бесконечный цикл.
    setIds((current) =>
      current.scheduleId === next.scheduleId &&
      sameScheduleOptions(current.scheduleOptions, next.scheduleOptions) &&
      current.timeZone === next.timeZone
        ? current
        : next,
    );
  }, []);

  const notifyApplied = useCallback(async (preferredScheduleId?: string) => {
    const handler = handlersRef.current?.onApplied;
    return handler ? await handler(preferredScheduleId) : false;
  }, []);

  const saveCommitments = useCallback(async (items: ParsedCommitment[]) => {
    const handler = handlersRef.current?.onCommitments;
    if (handler) await handler(items);
  }, []);

  const selectSchedule = useCallback((scheduleId: string) => {
    handlersRef.current?.onSelectSchedule(scheduleId);
  }, []);

  const value = useMemo(
    () => ({
      scheduleId: ids.scheduleId,
      scheduleOptions: ids.scheduleOptions,
      timeZone: ids.timeZone,
      notifyApplied,
      saveCommitments,
      selectSchedule,
      setPageSchedule,
    }),
    [ids, notifyApplied, saveCommitments, selectSchedule, setPageSchedule],
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
 * идентификатор, варианты выбора или часовой пояс.
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

function sameScheduleOptions(
  left: readonly ScheduleTargetOption[],
  right: readonly ScheduleTargetOption[],
): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((item, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      item.id === other.id &&
      item.title === other.title &&
      item.detail === other.detail &&
      item.status === other.status &&
      item.version === other.version &&
      item.createdAt === other.createdAt &&
      item.timeZone === other.timeZone
    );
  });
}
