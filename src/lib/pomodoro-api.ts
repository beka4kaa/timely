// Клиент помодоро-API. Ходим напрямую в Django с заголовком `X-User-Email`,
// как это делает трекер привычек (`src/components/habits/lib.ts`).

import { BACKEND_URL } from "@/lib/api-utils";
import {
  EMPTY_SUMMARY,
  type FocusSessionPayload,
  type FocusSessionRow,
  type PomodoroSummary,
  timezoneOffsetMinutes,
} from "@/lib/pomodoro";

const BASE = `${BACKEND_URL}/api/pomodoro/sessions`;

function headers(email: string): HeadersInit {
  return { "Content-Type": "application/json", "X-User-Email": email };
}

/** Сессии за последние `days` дней (для истории за сегодня хватает days=2). */
export async function fetchSessions(
  email: string,
  days: number,
  signal?: AbortSignal,
): Promise<FocusSessionRow[]> {
  const response = await fetch(`${BASE}/?days=${days}`, {
    headers: headers(email),
    signal,
  });
  if (!response.ok) throw new Error(`Не удалось загрузить сессии (${response.status})`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

/** Агрегаты по дням для календаря активности и метрик. */
export async function fetchSummary(
  email: string,
  days: number,
  signal?: AbortSignal,
): Promise<PomodoroSummary> {
  const params = new URLSearchParams({
    days: String(days),
    tz_offset: String(timezoneOffsetMinutes()),
  });
  const response = await fetch(`${BASE}/summary/?${params}`, {
    headers: headers(email),
    signal,
  });
  if (!response.ok) throw new Error(`Не удалось загрузить сводку (${response.status})`);
  return { ...EMPTY_SUMMARY, ...(await response.json()) };
}

export async function createSession(
  email: string,
  payload: FocusSessionPayload,
): Promise<void> {
  const response = await fetch(`${BASE}/`, {
    method: "POST",
    headers: headers(email),
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Не удалось сохранить сессию (${response.status})`);
}

/** «Очистить день» — удаляет сессии за один локальный день. */
export async function clearDay(email: string, date: string): Promise<void> {
  const params = new URLSearchParams({
    date,
    tz_offset: String(timezoneOffsetMinutes()),
  });
  const response = await fetch(`${BASE}/clear-day/?${params}`, {
    method: "DELETE",
    headers: headers(email),
  });
  if (!response.ok) throw new Error(`Не удалось очистить день (${response.status})`);
}
