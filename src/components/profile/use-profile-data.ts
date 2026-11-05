"use client";

// Всё, из чего складывается свой профиль. Ключи общие с «Контестами» и «Рейтингом»:
// один запрос на все три страницы.

import { BACKEND_URL } from "@/lib/api-utils";
import { authFetch } from "@/lib/auth-fetch";
import { listContests, listGlobalLeaderboard, listMySubmissions } from "@/lib/contest-api";
import { loadLessons } from "@/components/goals/lessons-data";
import { listMaterials } from "@/lib/curriculum-api";
import { fetchSummary } from "@/lib/pomodoro-api";
import type { BadgeTopic, HabitCalendar } from "@/lib/profile-view";
import { useResource } from "@/lib/resource-cache";

const TTL = 60_000;
/** Столько дней отдаёт сводка помодоро для года занятий. */
const YEAR_DAYS = 371;

async function fetchHabits(): Promise<HabitCalendar[]> {
  const response = await authFetch(`${BACKEND_URL}/api/habits/`);
  if (!response.ok) throw new Error(`Привычки не загрузились (${response.status})`);
  return response.json();
}

async function fetchTopics(): Promise<BadgeTopic[]> {
  const response = await authFetch(`${BACKEND_URL}/api/mind/topics/`);
  if (!response.ok) throw new Error(`Темы не загрузились (${response.status})`);
  const body = (await response.json()) as BadgeTopic[] | { results?: BadgeTopic[] };
  return Array.isArray(body) ? body : (body.results ?? []);
}

export function useProfileData() {
  const summary = useResource("compete:focus-year", () => fetchSummary(YEAR_DAYS), { ttl: TTL });
  const habits = useResource("compete:habits", fetchHabits, { ttl: TTL });
  const submissions = useResource("compete:submissions", listMySubmissions, { ttl: TTL });
  const contests = useResource("compete:contests", listContests, { ttl: TTL });
  const board = useResource("compete:leaderboard", listGlobalLeaderboard, { ttl: TTL });
  const lessons = useResource("compete:lessons", loadLessons, { ttl: TTL });
  const materials = useResource("compete:materials", listMaterials, { ttl: TTL });
  const topics = useResource("compete:topics", fetchTopics, { ttl: TTL });
  return { summary, habits, submissions, contests, board, lessons, materials, topics };
}
