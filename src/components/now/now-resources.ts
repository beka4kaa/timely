"use client";

// Запросы главной и их ключи в общем кэше (`resource-cache.ts`).
//
// Ключи и загрузчики живут в одном месте, потому что их делят два компонента:
// главная грузит всё, а рейл на любой странице — блоки, темы и книги для своих
// отметок. Один ключ — один запрос на обоих.

import {
  getPlan,
  listChats,
  listDocuments,
  listGoals,
  listMaterials,
  listPlans,
} from "@/lib/curriculum-api";
import {
  listCalendarBlocks,
  listCommitments,
  listRevisions,
  listSchedules,
  type ScheduleRevision,
} from "@/lib/studyplan-api";
import { shiftDateKey, weekDays } from "@/lib/studyplan-calendar";
import { selectVisibleSchedules } from "@/lib/studyplan-calendar-entries";
import type { DiaryWeek } from "@/types/diary";
import type { Topic } from "@/types/mind";

export const TTL = {
  /** План и дневник меняются от действий ученика — держим две минуты. */
  day: 2 * 60_000,
  /** Книги и программы — реже. */
  library: 5 * 60_000,
  /** Отметки рейла на чужих страницах: им не нужна свежесть до секунды. */
  status: 5 * 60_000,
};

// ── План ──────────────────────────────────────────────────────────────────────

export const blocksKey = (timeZone: string, today: string) =>
  `now:blocks:${timeZone}:${today}`;

/**
 * Блоки от недели назад до конца следующей недели: сегодня, неделя для полосы
 * сверху, семь дней назад для прошедших без отметки и следующая неделя — чтобы
 * в воскресенье вечером знать, что дальше. Один запрос вместо четырёх.
 */
export function fetchBlocks(timeZone: string, today: string) {
  const days = weekDays(today);
  return listCalendarBlocks({
    from: shiftDateKey(today, -7),
    to: shiftDateKey(days[days.length - 1], 8),
    timezone: timeZone,
  });
}

export const SCHEDULES_KEY = "now:schedules";
export const fetchSchedules = () => listSchedules();

export const COMMITMENTS_KEY = "now:commitments";
export const fetchCommitments = () => listCommitments();

export const revisionsKey = (scheduleIds: string[]) =>
  `now:revisions:${scheduleIds.join(",")}`;

/** Предложения изменить план по всем видимым расписаниям. */
export async function fetchRevisions(scheduleIds: string[]): Promise<ScheduleRevision[]> {
  const lists = await Promise.all(
    scheduleIds.map((id) => listRevisions(id).catch(() => [] as ScheduleRevision[])),
  );
  return lists.flat();
}

export { selectVisibleSchedules };

// ── Дневник ───────────────────────────────────────────────────────────────────

export const diaryKey = (monday: string) => `now:diary:${monday}`;

/**
 * Неделя дневника.
 *
 * Первый запрос недели создаёт её из шаблона — так же, как это делает сам
 * дневник при открытии, поэтому главная не делает ничего сверх него.
 */
export async function fetchDiaryWeek(monday: string): Promise<DiaryWeek> {
  const response = await fetch(`/api/diary/week?weekStart=${encodeURIComponent(monday)}`);
  if (!response.ok) throw new Error(`Дневник не загрузился (${response.status})`);
  return response.json();
}

// ── Темы ──────────────────────────────────────────────────────────────────────

export const WEAK_TOPICS_KEY = "now:topics:weak";

export async function fetchWeakTopics(): Promise<Topic[]> {
  const response = await fetch("/api/topics?filter=weak");
  if (!response.ok) throw new Error(`Темы не загрузились (${response.status})`);
  const body = (await response.json()) as Topic[] | { results?: Topic[] };
  return Array.isArray(body) ? body : body.results ?? [];
}

/** «Помню» / «Не помню» — то же повторение, что на странице слабых тем. */
export async function reviewTopic(topicId: string, rating: "GOOD" | "AGAIN"): Promise<void> {
  const response = await fetch(`/api/topics/${encodeURIComponent(topicId)}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating }),
  });
  if (!response.ok) throw new Error("Не удалось записать повторение");
}

// ── Библиотека и тьютор ───────────────────────────────────────────────────────

export const GOALS_KEY = "now:goals";
export const fetchGoals = () => listGoals();

export const PLANS_KEY = "now:plans";
export const fetchPlans = () => listPlans();

export const MATERIALS_KEY = "now:materials";
export const fetchMaterials = () => listMaterials();

export const DOCUMENTS_KEY = "now:documents";
export const fetchDocuments = () => listDocuments();

export const CHATS_KEY = "now:chats";
export const fetchChats = () => listChats();

export const planKey = (planId: string) => `now:plan:${planId}`;
export const fetchPlan = (planId: string) => getPlan(planId);
