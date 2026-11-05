"use client";

// Кнопка «В план» у задания: найти окно, показать его, поставить или спросить помощника.
//
// Ничего не меняется без предпросмотра: сначала ученик видит, куда встанет задание, и
// только потом нажимает «Поставить». Почему это занятое время, а не блок, см. `diary-plan.ts`.

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useFullAccessDenied } from "@/components/full-access-gate";
import {
  COMMITMENTS_KEY,
  SCHEDULES_KEY,
  TTL,
  fetchCommitments,
  fetchSchedules,
} from "@/components/now/now-resources";
import { mascot } from "@/components/shell/mascot/mascot";
import { useAskRail } from "@/contexts/ask-rail";
import {
  firstFreeSlot,
  lessonSpans,
  planTitle,
  planWhenLabel,
  plannedEntryFor,
  rhythmWindows,
  type PlanSlot,
  type TimeSpan,
} from "@/lib/diary-plan";
import { taskTitle } from "@/lib/diary-tasks";
import { dayMonthLabel, parseClock } from "@/lib/now-feed";
import { invalidateResources, useResource } from "@/lib/resource-cache";
import {
  createCommitment,
  deleteCommitment,
  listCalendarBlocks,
  listCommitments,
  listSchedules,
  listTemplates,
  type FixedCommitment,
} from "@/lib/studyplan-api";
import { shiftDateKey, toInstant, zonedDateKey } from "@/lib/studyplan-calendar";
import {
  calendarTimeZone,
  expandCommitments,
  selectVisibleSchedules,
} from "@/lib/studyplan-calendar-entries";
import type { DiaryDay, DiaryLesson, DiaryWeek } from "@/types/diary";

export type PlanStep =
  | { kind: "finding"; lessonId: string }
  | { kind: "preview"; lessonId: string; slot: PlanSlot; timeZone: string; saving: boolean }
  | { kind: "no-window"; lessonId: string }
  | { kind: "error"; lessonId: string };

/** Отменённое и перенесённое места не держит: так же считает сам план. */
const RELEASED = new Set(["cancelled", "rescheduled"]);

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function spanOf(entry: { start_at: string; end_at: string }): TimeSpan {
  return { start: Date.parse(entry.start_at), end: Date.parse(entry.end_at) };
}

function daysBetweenKeys(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = shiftDateKey(day, 1)) days.push(day);
  return days;
}

export function useDiaryPlan() {
  const router = useRouter();
  const { prompt } = useAskRail();
  const denied = useFullAccessDenied();

  // Те же ресурсы, что у главной: один ключ, один запрос. Закрытый раздел не спрашиваем.
  const { data: commitments } = useResource(denied ? null : COMMITMENTS_KEY, fetchCommitments, { ttl: TTL.day });
  const { data: schedules } = useResource(denied ? null : SCHEDULES_KEY, fetchSchedules, { ttl: TTL.day });
  const timeZone = useMemo(
    () => calendarTimeZone(selectVisibleSchedules(schedules ?? []), browserZone()),
    [schedules],
  );

  const [step, setStep] = useState<PlanStep | null>(null);
  const ticket = useRef(0);

  const close = useCallback(() => {
    ticket.current += 1;
    setStep(null);
  }, []);

  const find = useCallback(async (week: DiaryWeek, day: DiaryDay, lesson: DiaryLesson) => {
    const id = ++ticket.current;
    setStep({ kind: "finding", lessonId: lesson.id });
    try {
      const [allSchedules, templates, allCommitments] = await Promise.all([
        listSchedules(),
        listTemplates(),
        listCommitments(),
      ]);
      const visible = selectVisibleSchedules(allSchedules);
      const zone = calendarTimeZone(visible, browserZone());
      const now = new Date();
      const today = zonedDateKey(now, zone);
      const blocks = await listCalendarBlocks({
        from: today,
        to: shiftDateKey(day.date, 1),
        timezone: zone,
      });
      if (id !== ticket.current) return;

      const busy: TimeSpan[] = [
        ...blocks.filter((block) => !RELEASED.has(block.status)).map(spanOf),
        ...expandCommitments(allCommitments, daysBetweenKeys(today, day.date), zone).map(spanOf),
        ...week.days.flatMap((item) => lessonSpans(item.date, item.lessons, zone)),
      ];
      const inUse = templates.filter((template) =>
        visible.some((schedule) => schedule.template === template.id),
      );
      const rhythm = rhythmWindows(
        (inUse.length ? inUse : templates.filter((template) => template.active)).flatMap(
          (template) => template.slots,
        ),
      );
      const slot = firstFreeSlot({
        now,
        timeZone: zone,
        rhythm,
        busy,
        deadline: toInstant(day.date, parseClock(lesson.startTime) ?? 0, zone),
      });
      setStep(
        slot
          ? { kind: "preview", lessonId: lesson.id, slot, timeZone: zone, saving: false }
          : { kind: "no-window", lessonId: lesson.id },
      );
    } catch {
      if (id === ticket.current) setStep({ kind: "error", lessonId: lesson.id });
    }
  }, []);

  const remove = useCallback(async (commitmentId: string) => {
    try {
      await deleteCommitment(commitmentId);
      invalidateResources<FixedCommitment[]>(COMMITMENTS_KEY, (list) =>
        list.filter((item) => item.id !== commitmentId),
      );
      toast("Убрал из плана");
    } catch {
      toast.error("Не получилось убрать. Попробуй ещё раз.");
    }
  }, []);

  const place = useCallback(
    async (day: DiaryDay, lesson: DiaryLesson) => {
      if (step?.kind !== "preview" || step.lessonId !== lesson.id || step.saving) return;
      const { slot, timeZone: zone } = step;
      const id = ++ticket.current;
      setStep({ ...step, saving: true });

      const title = planTitle(taskTitle(lesson));
      const sourceText = `Из дневника, сдать ${dayMonthLabel(day.date)}`;
      const startAt = slot.start.toISOString();
      const endAt = slot.end.toISOString();
      try {
        const created = await createCommitment(
          { title, kind: "other", start_at: startAt, end_at: endAt },
          "manual",
          sourceText,
        );
        const entry: FixedCommitment = {
          id: created.id,
          kind: "other",
          title,
          weekday: null,
          start_time: null,
          duration_minutes: 0,
          valid_from: null,
          valid_until: null,
          start_at: startAt,
          end_at: endAt,
          source: "manual",
          source_text: sourceText,
          created_at: new Date().toISOString(),
        };
        invalidateResources<FixedCommitment[]>(COMMITMENTS_KEY, (list) => [...list, entry]);
        if (id === ticket.current) setStep(null);
        mascot.hop(0.42, "quiet");
        toast(`Поставил ${planWhenLabel(slot.start, zonedDateKey(new Date(), zone), zone)}`, {
          action: { label: "Отменить", onClick: () => void remove(created.id) },
        });
      } catch {
        if (id === ticket.current) setStep({ kind: "error", lessonId: lesson.id });
      }
    },
    [remove, step],
  );

  /** Другое время или места нет: помощник предложит изменение, применяет его ученик. */
  const askHelper = useCallback(
    (lesson: DiaryLesson) => {
      close();
      router.push("/dashboard/plan");
      prompt({ target: "schedule", text: `Поставь в план: ${taskTitle(lesson)}`, send: true });
    },
    [close, prompt, router],
  );

  const entryFor = useCallback(
    (day: DiaryDay, lesson: DiaryLesson) =>
      plannedEntryFor(commitments ?? [], taskTitle(lesson), day.date, timeZone),
    [commitments, timeZone],
  );

  const whenLabel = useCallback(
    (start: Date | string, zone: string = timeZone) =>
      planWhenLabel(start, zonedDateKey(new Date(), zone), zone),
    [timeZone],
  );

  return { available: !denied, step, find, place, close, askHelper, entryFor, whenLabel };
}

export type DiaryPlanApi = ReturnType<typeof useDiaryPlan>;
