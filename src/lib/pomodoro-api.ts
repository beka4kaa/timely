// Клиент помодоро-API. Ходим напрямую в Django через `authFetch`,
// как это делает трекер привычек (`src/components/habits/lib.ts`).

import { BACKEND_URL } from "@/lib/api-utils";
import { authFetch } from "@/lib/auth-fetch";
import { t } from "@/lib/i18n";
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
  if (!response.ok) throw new Error(t("Не удалось загрузить сессии ({status})", { status: response.status }));
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
  if (!response.ok) throw new Error(t("Не удалось загрузить сводку ({status})", { status: response.status }));
  return { ...EMPTY_SUMMARY, ...(await response.json()) };
}

export async function createSession(payload: FocusSessionPayload): Promise<void> {
  const response = await authFetch(`${BASE}/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(t("Не удалось сохранить сессию ({status})", { status: response.status }));
}

/** «Очистить день» — удаляет сессии за один локальный день. */
export async function clearDay(date: string): Promise<void> {
  const params = new URLSearchParams({
    date,
    tz_offset: String(timezoneOffsetMinutes()),
  });
  const response = await authFetch(`${BASE}/clear-day/?${params}`, { method: "DELETE" });
  if (!response.ok) throw new Error(t("Не удалось очистить день ({status})", { status: response.status }));
}

// ── Идущий таймер, общий для всех устройств ──

const STATE_URL = `${BACKEND_URL}/api/pomodoro/state/`;

export interface RemoteTimerState {
  /** Как прислал сервер: проверяет `remoteTimer` перед тем, как взять. */
  state: unknown;
  version: number;
}

function remotePayload(data: unknown): RemoteTimerState {
  const body = (data && typeof data === "object" ? data : {}) as { state?: unknown; version?: unknown };
  const version = Number(body.version);
  return { state: body.state ?? null, version: Number.isInteger(version) && version >= 0 ? version : 0 };
}

export async function fetchTimerState(signal?: AbortSignal): Promise<RemoteTimerState> {
  const response = await authFetch(STATE_URL, { signal });
  if (!response.ok) throw new Error(t("Не удалось загрузить таймер ({status})", { status: response.status }));
  return remotePayload(await response.json());
}

/**
 * Записывает таймер поверх версии `baseVersion`. Другое устройство успело раньше — сервер
 * отвечает 409, и здесь возвращается то, что лежит у него сейчас.
 */
export async function saveTimerState(
  state: unknown,
  baseVersion: number,
): Promise<{ ok: true; version: number } | { ok: false; current: RemoteTimerState }> {
  const response = await authFetch(STATE_URL, {
    method: "PUT",
    body: JSON.stringify({ state, base_version: baseVersion }),
  });
  if (response.status === 409) return { ok: false, current: remotePayload(await response.json()) };
  if (!response.ok) throw new Error(t("Не удалось сохранить таймер ({status})", { status: response.status }));
  return { ok: true, version: remotePayload(await response.json()).version };
}
