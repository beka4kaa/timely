"use client";

// Запросы главной и их ключи в общем кэше (`resource-cache.ts`).
//
// Ключи и загрузчики живут в одном месте, потому что их делят два компонента:
// главная грузит всё, а рейл на любой странице — блоки, темы и книги для своих
// отметок. Один ключ — один запрос на обоих.

import { listContests } from "@/lib/contest-api";
import { getPlan, listDocuments, listPlans } from "@/lib/curriculum-api";
import { mergeListRequests } from "@/lib/now-feed";
import { invalidateResources } from "@/lib/resource-cache";
import {
  listCalendarBlocks,
  listCommitments,
  listOpenRevisions,
  listSchedules,
  type ScheduleRevision,
} from "@/lib/studyplan-api";
import { shiftDateKey, weekDays } from "@/lib/studyplan-calendar";
import { selectVisibleSchedules } from "@/lib/studyplan-calendar-entries";
import type { DiaryWeek } from "@/types/diary";
import type { ReviewRating, Topic } from "@/types/mind";

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

/**
 * Открытые предложения изменить план по всем видимым расписаниям.
 *
 * Не ответило одно расписание — показываем остальные, а его предложения вернутся
 * со следующим опросом. Не ответило ни одно, например ноутбук проснулся раньше
 * Wi-Fi, — это ошибка: кэш повторит запрос раньше обычного, а пока набор расписаний
 * тот же, оставит на экране прежние карточки.
 */
export function fetchRevisions(scheduleIds: string[]): Promise<ScheduleRevision[]> {
  return mergeListRequests(scheduleIds.map((id) => listOpenRevisions(id)));
}

export { selectVisibleSchedules };

/**
 * План поменялся — неважно, на какой странице. Всё, что главная и рейл о нём
 * знают, устарело: то, что на экране, перечитается сразу, остальное — при
 * следующем заходе.
 *
 * `closed` отмечает предложения, на которые больше нельзя ответить. Из уже
 * полученных списков они уходят сразу: даже если перечитать их не выйдет,
 * карточка с живыми кнопками не вернётся.
 */
export function invalidatePlan(closed?: (revision: ScheduleRevision) => boolean) {
  invalidateResources("now:blocks:");
  invalidateResources(SCHEDULES_KEY);
  invalidateResources<ScheduleRevision[]>(
    "now:revisions:",
    closed ? (list) => list.filter((revision) => !closed(revision)) : undefined,
  );
}

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

/**
 * Оценка повторения, то же, что на странице слабых тем. Возвращает тему с новым сроком,
 * если сервер её прислал: по ней пишем, когда тема вернётся.
 */
export async function reviewTopic(topicId: string, rating: ReviewRating): Promise<Partial<Topic> | null> {
  const response = await fetch(`/api/topics/${encodeURIComponent(topicId)}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rating }),
  });
  if (!response.ok) throw new Error("Не удалось записать повторение");
  try {
    return (await response.json()) as Partial<Topic>;
  } catch {
    return null;
  }
}

// ── Библиотека ────────────────────────────────────────────────────────────────

export const PLANS_KEY = "now:plans";
export const fetchPlans = () => listPlans();

export const DOCUMENTS_KEY = "now:documents";
export const fetchDocuments = () => listDocuments();

export const planKey = (planId: string) => `now:plan:${planId}`;
export const fetchPlan = (planId: string) => getPlan(planId);

// ── Контесты ──────────────────────────────────────────────────────────────────

export const CONTESTS_KEY = "now:contests";
export const fetchContests = () => listContests();
