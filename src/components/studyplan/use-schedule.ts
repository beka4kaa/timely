// Данные страницы «План»: расписание, блоки недели, изменения.
//
// Свой хук, а не общий стор: страница читает ровно одно расписание и живёт
// неделей, которую сейчас смотрит ученик. Класть это в Zustand с `persist`
// значило бы хранить чужой календарь между сессиями и однажды показать
// расписание другой программы по сохранённому идентификатору.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { listPlans, type CoursePlanSummary } from "@/lib/curriculum-api";
import {
  StudyplanApiError,
  type LearningBlock,
  type ScheduleRevision,
  type StudySchedule,
  confirmSchedule,
  generateSchedule,
  getSchedule,
  listBlocks,
  listSchedules,
  moveBlock,
  undoRevision,
} from "@/lib/studyplan-api";
import { shiftDateKey, weekDays, zonedDateKey } from "@/lib/studyplan-calendar";

export type ScheduleState =
  | { state: "loading" }
  | { state: "empty"; plans: CoursePlanSummary[] }
  | { state: "error"; message: string }
  | {
      state: "ready";
      schedule: StudySchedule;
      blocks: LearningBlock[];
      plans: CoursePlanSummary[];
    };

/** Зона браузера. Её же предлагаем бэкенду при первой генерации. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Активное расписание среди всех: сначала идущее, потом предложенное. */
function pickSchedule(schedules: StudySchedule[]): StudySchedule | null {
  const byPriority = ["active", "confirmed", "proposed", "draft"];
  for (const status of byPriority) {
    const found = schedules.find((item) => item.status === status);
    if (found) return found;
  }
  return schedules[0] ?? null;
}

export function useSchedule() {
  const [data, setData] = useState<ScheduleState>({ state: "loading" });
  const [anchor, setAnchor] = useState<string>(() =>
    zonedDateKey(new Date(), browserTimeZone()),
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastRevision, setLastRevision] = useState<ScheduleRevision | null>(null);

  // Гонка вкладок и быстрых переключений недели: ответ устаревшего запроса не
  // должен затирать более свежий.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++requestId.current;
    try {
      const [schedules, plans] = await Promise.all([listSchedules(), listPlans()]);
      const schedule = pickSchedule(schedules);
      if (ticket !== requestId.current) return;

      if (!schedule) {
        setData({ state: "empty", plans });
        return;
      }
      const blocks = await listBlocks(schedule.id);
      if (ticket !== requestId.current) return;
      setData({ state: "ready", schedule, blocks, plans });
    } catch (error) {
      if (ticket !== requestId.current) return;
      setData({
        state: "error",
        message:
          error instanceof Error ? error.message : "Не удалось загрузить расписание.",
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const timeZone =
    data.state === "ready" ? data.schedule.timezone : browserTimeZone();
  const days = useMemo(() => weekDays(anchor), [anchor]);

  const goToWeek = useCallback((direction: -1 | 0 | 1) => {
    if (direction === 0) {
      setAnchor(zonedDateKey(new Date(), browserTimeZone()));
      return;
    }
    setAnchor((current) => shiftDateKey(current, direction * 7));
  }, []);

  /** Перечитать только блоки: после переноса неделя могла измениться. */
  const reloadBlocks = useCallback(async (schedule: StudySchedule) => {
    const fresh = await getSchedule(schedule.id);
    const blocks = await listBlocks(schedule.id);
    setData((current) =>
      current.state === "ready"
        ? { ...current, schedule: fresh, blocks }
        : current,
    );
  }, []);

  const move = useCallback(
    async (blockId: string, startAt: Date, durationMinutes?: number) => {
      if (data.state !== "ready") return;
      setBusy(true);
      setNotice(null);
      try {
        const result = await moveBlock(blockId, {
          startAt: startAt.toISOString(),
          durationMinutes,
          baseVersion: data.schedule.version,
        });
        setLastRevision(result.revision);
        await reloadBlocks(data.schedule);
      } catch (error) {
        if (error instanceof StudyplanApiError && error.isStale) {
          setNotice("Расписание изменилось в другом месте — обновляю календарь.");
          await load();
        } else {
          setNotice(
            error instanceof Error ? error.message : "Перенести не получилось.",
          );
        }
      } finally {
        setBusy(false);
      }
    },
    [data, load, reloadBlocks],
  );

  const undoLast = useCallback(async () => {
    if (!lastRevision || data.state !== "ready") return;
    setBusy(true);
    try {
      await undoRevision(lastRevision.id);
      setLastRevision(null);
      setNotice(null);
      await reloadBlocks(data.schedule);
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Отменить уже нельзя.",
      );
    } finally {
      setBusy(false);
    }
  }, [data, lastRevision, reloadBlocks]);

  const confirm = useCallback(async () => {
    if (data.state !== "ready") return;
    setBusy(true);
    try {
      const schedule = await confirmSchedule(data.schedule.id);
      setData((current) =>
        current.state === "ready" ? { ...current, schedule } : current,
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Подтвердить не получилось.",
      );
    } finally {
      setBusy(false);
    }
  }, [data]);

  const build = useCallback(
    async (coursePlanId: string) => {
      setBusy(true);
      setNotice(null);
      try {
        await generateSchedule({
          coursePlanId,
          startDate: zonedDateKey(new Date(), browserTimeZone()),
          timezone: browserTimeZone(),
        });
        await load();
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : "Построить календарь не вышло.",
        );
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  return {
    data,
    days,
    timeZone,
    anchor,
    busy,
    notice,
    lastRevision,
    goToWeek,
    move,
    undoLast,
    confirm,
    build,
    reload: load,
    dismissNotice: () => setNotice(null),
  };
}
