// Данные общего календаря: все программы и занятое время одной недели.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { listPlans, type CoursePlanSummary } from "@/lib/curriculum-api";
import {
  type CommitmentCalendarEntry,
  type LearningCalendarEntryFields,
  type StudyCalendarEntry,
  calendarTimeZone,
  compareCalendarSchedules,
  expandCommitments,
  selectVisibleSchedules,
} from "@/lib/studyplan-calendar-entries";
import {
  StudyplanApiError,
  cancelBlocks,
  createCommitment,
  deleteCommitment,
  pinBlocks,
  type CalendarLearningBlock,
  type FixedCommitment,
  type ScheduleRevision,
  type StudySchedule,
  confirmSchedule,
  generateSchedule,
  listCalendarBlocks,
  listCommitments,
  listSchedules,
  moveBlock,
  undoRevision,
} from "@/lib/studyplan-api";
import { shiftDateKey, weekDays, zonedDateKey } from "@/lib/studyplan-calendar";

export type LearningCalendarEntry = CalendarLearningBlock &
  LearningCalendarEntryFields;
export type CalendarEntry = StudyCalendarEntry<CalendarLearningBlock>;

/**
 * Чего в календаре не видно совсем.
 *
 * Отменённое — потому что «удалил» должно означать «исчезло»; перенесённое —
 * потому что это след старого места блока, который уже стоит в новом.
 */
const HIDDEN_STATUSES = new Set(["cancelled", "rescheduled"]);

export type ScheduleState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | {
      state: "ready";
      schedules: StudySchedule[];
      proposals: StudySchedule[];
      blocks: LearningCalendarEntry[];
      commitments: CommitmentCalendarEntry[];
      /**
       * Исходные записи занятости, до разворота в блоки недели.
       *
       * Нужны, чтобы вернуть удалённое: повторяющаяся занятость — одна строка,
       * и восстановить её можно только по её собственным полям, а не по
       * блоку, в который календарь её развернул.
       */
      commitmentSources: FixedCommitment[];
      plans: CoursePlanSummary[];
      timeZone: string;
    };

/** Зона браузера — запасной вариант до появления хотя бы одного расписания. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function useSchedule() {
  const fallbackTimeZone = useMemo(browserTimeZone, []);
  const [data, setData] = useState<ScheduleState>({ state: "loading" });
  const [anchor, setAnchor] = useState<string>(() =>
    zonedDateKey(new Date(), fallbackTimeZone),
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastRevision, setLastRevision] = useState<ScheduleRevision | null>(null);

  const requestId = useRef(0);
  const initialZoneResolved = useRef(false);
  const days = useMemo(() => weekDays(anchor), [anchor]);

  // Программы и занятость меняются редко, а расписание — на каждое движение
  // мышью. Держим их между перезагрузками: иначе один перенос блока стоил
  // четырёх запросов в две волны, из которых три возвращали то же самое.
  const staticRef = useRef<{
    plans: CoursePlanSummary[];
    commitments: FixedCommitment[];
  } | null>(null);

  const load = useCallback(async (options?: { calendarOnly?: boolean }) => {
    const ticket = ++requestId.current;
    const cached = options?.calendarOnly ? staticRef.current : null;
    try {
      const [allSchedules, plans, fixedCommitments] = cached
        ? [await listSchedules(), cached.plans, cached.commitments]
        : await Promise.all([listSchedules(), listPlans(), listCommitments()]);
      if (ticket !== requestId.current) return;
      staticRef.current = { plans, commitments: fixedCommitments };

      const visible = selectVisibleSchedules(allSchedules);
      const timeZone = calendarTimeZone(visible, fallbackTimeZone);
      if (!initialZoneResolved.current) {
        initialZoneResolved.current = true;
        const now = new Date();
        const canonicalToday = zonedDateKey(now, timeZone);
        if (canonicalToday !== zonedDateKey(now, fallbackTimeZone)) {
          setAnchor(canonicalToday);
          return;
        }
      }
      const shownDays = weekDays(anchor);
      const rawBlocks = await listCalendarBlocks({
        from: shownDays[0],
        to: shiftDateKey(shownDays[shownDays.length - 1], 1),
        timezone: timeZone,
      });
      if (ticket !== requestId.current) return;

      const scheduleById = new Map(visible.map((schedule) => [schedule.id, schedule]));
      const planById = new Map(plans.map((plan) => [plan.id, plan]));
      const visibleByPlan = new Map(
        visible.map((schedule) => [schedule.course_plan, schedule]),
      );
      // Отменённое и перенесённое в календаре не показываем вовсе. Раньше они
      // оставались серым перечёркнутым следом: занятие «удалено», а место в
      // сетке занимает, и неделя после нескольких отмен выглядела грязнее, чем
      // до них. Вернуть отменённое можно по Ctrl+Z — данные на сервере целы.
      const blocks: LearningCalendarEntry[] = rawBlocks
        .filter((block) => !HIDDEN_STATUSES.has(block.status))
        .map((block) => {
          const owner = scheduleById.get(block.schedule);
          return {
            ...block,
            calendar_entry: "learning_block",
            schedule_version:
              block.schedule_version ?? owner?.version ?? block.version,
            schedule_status: block.schedule_status ?? owner?.status ?? "active",
            schedule_timezone:
              block.schedule_timezone ?? owner?.timezone ?? timeZone,
            course_plan_title:
              block.course_plan_title ??
              planById.get(block.course_plan)?.title ??
              "Учебная программа",
          };
        });

      setData({
        state: "ready",
        schedules: visible,
        proposals: newestProposalPerCourse(
          allSchedules.filter((schedule) => {
            if (schedule.status !== "proposed" && schedule.status !== "draft") {
              return false;
            }
            const current = visibleByPlan.get(schedule.course_plan);
            // Legacy proposal older than an already-confirmed replacement is
            // history, not an action the current calendar should surface.
            return (
              !current ||
              current.id === schedule.id ||
              compareCalendarSchedules(schedule, current) < 0
            );
          }),
        ),
        blocks,
        commitments: expandCommitments(fixedCommitments, shownDays, timeZone),
        commitmentSources: fixedCommitments,
        plans,
        timeZone,
      });
    } catch (error) {
      if (ticket !== requestId.current) return;
      setData({
        state: "error",
        message:
          error instanceof Error ? error.message : "Не удалось загрузить расписание.",
      });
    }
  }, [anchor, fallbackTimeZone]);

  useEffect(() => {
    void load();
  }, [load]);

  const timeZone = data.state === "ready" ? data.timeZone : fallbackTimeZone;

  const goToWeek = useCallback(
    (direction: -1 | 0 | 1) => {
      if (direction === 0) {
        setAnchor(zonedDateKey(new Date(), timeZone));
        return;
      }
      setAnchor((current) => shiftDateKey(current, direction * 7));
    },
    [timeZone],
  );

  const move = useCallback(
    async (block: LearningCalendarEntry, startAt: Date, durationMinutes?: number) => {
      setBusy(true);
      setNotice(null);
      try {
        const result = await moveBlock(block.id, {
          startAt: startAt.toISOString(),
          durationMinutes,
          baseVersion: block.schedule_version,
        });
        setLastRevision(result.revision);
        await load({ calendarOnly: true });
      } catch (error) {
        if (error instanceof StudyplanApiError && error.isStale) {
          setNotice("Календарь обновился — здесь была другая версия.");
          await load({ calendarOnly: true });
        } else {
          setNotice(
            error instanceof Error ? error.message : "Перенести не получилось.",
          );
        }
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const undoLast = useCallback(async () => {
    if (!lastRevision) return;
    setBusy(true);
    try {
      await undoRevision(lastRevision.id);
      setLastRevision(null);
      setNotice(null);
      await load({ calendarOnly: true });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Отменить уже нельзя.");
    } finally {
      setBusy(false);
    }
  }, [lastRevision, load]);

  const confirm = useCallback(
    async (scheduleId: string) => {
      setBusy(true);
      setNotice(null);
      try {
        await confirmSchedule(scheduleId);
        await load({ calendarOnly: true });
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : "Подтвердить не получилось.",
        );
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const build = useCallback(
    async (coursePlanId: string) => {
      setBusy(true);
      setNotice(null);
      try {
        await generateSchedule({
          coursePlanId,
          startDate: zonedDateKey(new Date(), timeZone),
          timezone: timeZone,
        });
        await load();
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : "Добавить программу в расписание не получилось.",
        );
      } finally {
        setBusy(false);
      }
    },
    [load, timeZone],
  );

  /**
   * Отменить выделенные занятия.
   *
   * Возвращает список отменённых, чтобы страница показала «Вернуть»: отмена
   * пачкой без выхода назад — слишком дорогая ошибка для одной клавиши.
   */
  const cancel = useCallback(
    async (blockIds: string[]) => {
      if (blockIds.length === 0) return [];
      setBusy(true);
      setNotice(null);
      try {
        const result = await cancelBlocks(blockIds);
        await load({ calendarOnly: true });
        return result.changed;
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : "Отменить не получилось.",
        );
        return [];
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const restore = useCallback(
    async (blockIds: string[]) => {
      if (blockIds.length === 0) return;
      setBusy(true);
      try {
        await cancelBlocks(blockIds, { restore: true });
        await load({ calendarOnly: true });
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : "Вернуть не получилось.",
        );
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  /** Закрепить занятие или отпустить его. */
  const setPinned = useCallback(
    async (blockIds: string[], pinned: boolean) => {
      if (blockIds.length === 0) return;
      setBusy(true);
      setNotice(null);
      try {
        await pinBlocks(blockIds, pinned);
        await load({ calendarOnly: true });
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : "Не получилось изменить.",
        );
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  /** Удалить занятое время целиком. Вернуть можно, создав его заново. */
  const removeCommitment = useCallback(
    async (commitmentId: string) => {
      setBusy(true);
      setNotice(null);
      try {
        await deleteCommitment(commitmentId);
        await load();
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : "Удалить не получилось.",
        );
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  /**
   * Вернуть удалённую занятость.
   *
   * Именно ПЕРЕСОЗДАТЬ: строки на сервере уже нет, восстанавливать нечего.
   * Идентификатор поэтому меняется, и вызывающий обязан взять новый — иначе
   * повтор удаления бил бы по записи, которой не существует.
   */
  const recreateCommitment = useCallback(
    async (item: FixedCommitment): Promise<FixedCommitment | null> => {
      setBusy(true);
      try {
        const created = await createCommitment(
          {
            title: item.title,
            kind: item.kind,
            weekday: item.weekday ?? undefined,
            start_time: item.start_time ?? undefined,
            duration_minutes: item.duration_minutes,
            valid_from: item.valid_from,
            valid_until: item.valid_until,
            start_at: item.start_at ?? undefined,
            end_at: item.end_at ?? undefined,
          },
          item.source,
          item.source_text,
        );
        await load();
        return { ...item, id: created.id };
      } catch (error) {
        setNotice(
          error instanceof Error ? error.message : "Вернуть не получилось.",
        );
        return null;
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
    cancel,
    restore,
    removeCommitment,
    recreateCommitment,
    setPinned,
    reload: load,
    dismissNotice: () => setNotice(null),
  };
}

function newestProposalPerCourse(proposals: StudySchedule[]): StudySchedule[] {
  const newest = new Map<string, StudySchedule>();
  for (const proposal of proposals) {
    const current = newest.get(proposal.course_plan);
    if (!current || compareCalendarSchedules(proposal, current) < 0) {
      newest.set(proposal.course_plan, proposal);
    }
  }
  return Array.from(newest.values()).sort(compareCalendarSchedules);
}
