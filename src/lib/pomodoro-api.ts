// Клиент помодоро-API. Ходим напрямую в Django через `authFetch`,
// как это делает трекер привычек (`src/components/habits/lib.ts`).

import { BACKEND_URL } from "@/lib/api-utils";
import { authFetch } from "@/lib/auth-fetch";
import {
  EMPTY_SUMMARY,
  type FocusSessionPayload,
  type FocusSessionRow,
  type PomodoroSummary,
  timezoneOffsetMinutes,
} from "@/lib/pomodoro";

const BASE = `${BACKEND_URL}/api/pomodoro/sessions`;

/** Сессии за последние `days` дней (для истории за сегодня хватает days=2). */
export async function fetchSessions(
  days: number,
  signal?: AbortSignal,
): Promise<FocusSessionRow[]> {
  const response = await authFetch(`${BASE}/?days=${days}`, { signal });
  if (!response.ok) throw new Error(`Не удалось загрузить сессии (${response.status})`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

/** Агрегаты по дням для календаря активности и метрик. */
export async function fetchSummary(
  days: number,
  signal?: AbortSignal,
): Promise<PomodoroSummary> {
  const params = new URLSearchParams({
    days: String(days),
    tz_offset: String(timezoneOffsetMinutes()),
  });
  const response = await authFetch(`${BASE}/summary/?${params}`, { signal });
  if (!response.ok) throw new Error(`Не удалось загрузить сводку (${response.status})`);
  return { ...EMPTY_SUMMARY, ...(await response.json()) };
}

export async function createSession(payload: FocusSessionPayload): Promise<void> {
  const response = await authFetch(`${BASE}/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Не удалось сохранить сессию (${response.status})`);
}

/** «Очистить день» — удаляет сессии за один локальный день. */
export async function clearDay(date: string): Promise<void> {
  const params = new URLSearchParams({
    date,
    tz_offset: String(timezoneOffsetMinutes()),
  });
  const response = await authFetch(`${BASE}/clear-day/?${params}`, { method: "DELETE" });
  if (!response.ok) throw new Error(`Не удалось очистить день (${response.status})`);
}
