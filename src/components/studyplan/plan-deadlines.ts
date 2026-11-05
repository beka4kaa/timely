"use client";

// Сроки для строки «весь день» и карточки «Скоро».
//
// Каждый источник живёт сам по себе: упали цели, контрольные и контесты всё равно на
// месте, а календарь работает и вовсе без них.

import { useMemo } from "react";

import { TTL, diaryKey, fetchDiaryWeek } from "@/components/now/now-resources";
import { listContests, type Contest } from "@/lib/contest-api";
import { upcomingTests } from "@/lib/now-feed";
import { useResource } from "@/lib/resource-cache";
import type { FixedCommitment } from "@/lib/studyplan-api";
import { shiftDateKey, weekDays } from "@/lib/studyplan-calendar";
import type { DiaryWeek } from "@/types/diary";

import { buildDeadlines, type Due } from "./plan-grid.logic";

interface GoalRow {
  id: string | number;
  title: string;
  status?: string;
  endDate?: string | null;
  dueDate?: string | null;
}

async function fetchGoalDates(): Promise<GoalRow[]> {
  const response = await fetch("/api/goals", { cache: "no-store" });
  if (!response.ok) throw new Error(`Цели не загрузились (${response.status})`);
  const body = (await response.json()) as { goals?: GoalRow[] };
  return body.goals ?? [];
}

const NO_WEEK: DiaryWeek["days"] = [];

export function usePlanDeadlines(
  todayKey: string | null,
  timeZone: string,
  commitments: readonly FixedCommitment[],
): Due[] {
  // Только эта и следующая неделя, как у главной. Первый запрос недели создаёт её в
  // дневнике из шаблона, и листание плана на месяц вперёд не должно этого делать.
  const monday = todayKey ? weekDays(todayKey)[0] : null;
  const nextMonday = monday ? shiftDateKey(monday, 7) : null;
  const thisWeek = useResource<DiaryWeek>(
    monday ? diaryKey(monday) : null,
    () => fetchDiaryWeek(monday ?? ""),
    { ttl: TTL.day },
  );
  const nextWeek = useResource<DiaryWeek>(
    nextMonday ? diaryKey(nextMonday) : null,
    () => fetchDiaryWeek(nextMonday ?? ""),
    { ttl: TTL.day, delay: 400 },
  );
  const goals = useResource<GoalRow[]>("plan:goal-dates", fetchGoalDates, { ttl: TTL.library });
  const contests = useResource<Contest[]>("plan:contests", listContests, { ttl: TTL.library });

  return useMemo(() => {
    const days = [...(thisWeek.data?.days ?? NO_WEEK), ...(nextWeek.data?.days ?? NO_WEEK)];
    // Начало первого дня и «ещё ничего не началось»: нужны все контрольные этих двух
    // недель, и прошедшие на этой неделе тоже остаются в сетке.
    const tests = days.length && monday ? upcomingTests(days, monday, -1, 13) : [];
    return buildDeadlines({
      tests,
      goals: goals.data,
      contests: contests.data,
      exams: commitments.filter((item) => item.kind === "exam"),
      timeZone,
    });
  }, [commitments, contests.data, goals.data, monday, nextWeek.data, thisWeek.data, timeZone]);
}
