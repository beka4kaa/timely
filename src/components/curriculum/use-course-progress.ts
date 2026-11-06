// Настоящий прогресс курсов: читается из занятий расписания.
//
// Сервер не отдаёт готового процента, поэтому каталог спрашивает расписания ученика и
// занятия тех, по которым он занимается. Запросов немного: по одному на курс с
// расписанием, и повторяются они, только когда меняется сам список курсов, а не на
// каждый опрос обработки книги.

"use client";

import { useEffect, useMemo, useState } from "react";

import {
  type CourseProgress,
  pickProgressSchedule,
  programMinutesOf,
  summarizeProgress,
} from "@/lib/curriculum-course-progress";
import { type StudySchedule, listBlocks, listSchedules } from "@/lib/studyplan-api";

export interface PlanProgress {
  schedule: StudySchedule;
  progress: CourseProgress;
}

/** Прогресс одной программы. `null`: расписания у неё ещё нет. */
export async function loadPlanProgress(
  planId: string,
  plan?: { estimated_total_minutes: number } | null,
): Promise<PlanProgress | null> {
  const schedule = pickProgressSchedule(await listSchedules(planId));
  if (!schedule) return null;
  return { schedule, progress: summarizeProgress(await listBlocks(schedule.id), programMinutesOf(schedule, plan)) };
}

export interface CatalogProgress {
  /** Курс → прогресс. Курса без расписания здесь нет: у него просто ничего не пройдено. */
  byPlan: Map<string, CourseProgress>;
  /** Ответ получен. Пока его нет, процент лучше не показывать, чем показать ноль. */
  loaded: boolean;
}

const EMPTY: CatalogProgress = { byPlan: new Map(), loaded: false };

export function useCatalogProgress(plans: readonly { id: string; estimated_total_minutes: number }[]): CatalogProgress {
  const key = useMemo(
    () => plans.map((plan) => `${plan.id}:${plan.estimated_total_minutes}`).sort().join(","),
    [plans],
  );
  const [state, setState] = useState<CatalogProgress>(EMPTY);

  useEffect(() => {
    const wanted = key
      ? key.split(",").map((row) => {
          const [id, minutes] = row.split(":");
          return { id, estimated_total_minutes: Number(minutes) };
        })
      : [];
    if (wanted.length === 0) {
      setState({ byPlan: new Map(), loaded: true });
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const schedules = await listSchedules();
        const entries = await Promise.all(
          wanted.map(async (plan) => {
            const schedule = pickProgressSchedule(
              schedules.filter((item) => item.course_plan === plan.id),
            );
            if (!schedule) return null;
            // Один упавший курс не должен гасить проценты у остальных.
            const blocks = await listBlocks(schedule.id).catch(() => null);
            return blocks
              ? ([plan.id, summarizeProgress(blocks, programMinutesOf(schedule, plan))] as const)
              : null;
          }),
        );
        if (cancelled) return;
        setState({
          byPlan: new Map(entries.filter((entry) => entry !== null)),
          loaded: true,
        });
      } catch {
        // Расписания не ответили: каталог остаётся рабочим, просто без процентов.
        if (!cancelled) setState({ byPlan: new Map(), loaded: false });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [key]);

  return state;
}
