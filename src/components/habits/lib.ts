// Привычки на сервере. Заметки, таймер и щиты живут там же и никуда не деваются:
// эта страница их просто не показывает и не меняет.

import { BACKEND_URL } from '@/lib/api-utils'
import { authFetch } from '@/lib/auth-fetch'

import type { CalDay } from './habit-days'

export interface Habit {
  id: number
  name: string
  emoji: string
  color: string
  goalId: string | null
  goalTitle: string
  freezeBudget: number
  /** День, который сервер считает сегодняшним для этого ответа. */
  today: string
  streak: number
  doneToday: boolean
  calendar: CalDay[]
}

function mapHabit(raw: any): Habit {
  const calendar: CalDay[] = (raw.calendar ?? []).map((day: CalDay) => ({ date: day.date, done: day.done }))
  return {
    id: raw.id,
    name: raw.name,
    emoji: raw.emoji ?? '',
    color: raw.color ?? '',
    goalId: raw.goal ? String(raw.goal) : null,
    goalTitle: raw.goal_title ?? '',
    freezeBudget: raw.freeze_budget ?? 0,
    today: raw.today ?? calendar[calendar.length - 1]?.date ?? '',
    streak: raw.streak ?? 0,
    doneToday: raw.done_today ?? false,
    calendar,
  }
}

function api(path: string, options: RequestInit = {}) {
  return authFetch(`${BACKEND_URL}/api/habits${path}`, options)
}

async function readHabit(response: Response): Promise<Habit> {
  if (!response.ok) throw new Error(`habits: ${response.status}`)
  return mapHabit(await response.json())
}

/** `today` это день ученика: сервер считает календарь и серию от него. */
export async function listHabits(today: string): Promise<Habit[]> {
  const response = await api(`/?today=${today}`)
  if (!response.ok) throw new Error(`habits: ${response.status}`)
  const rows: unknown = await response.json()
  return Array.isArray(rows) ? rows.map(mapHabit) : []
}

export async function createHabit(
  fields: { name: string; color: string; goal?: string | null },
  today: string,
): Promise<Habit> {
  return readHabit(await api(`/?today=${today}`, { method: 'POST', body: JSON.stringify(fields) }))
}

export async function updateHabit(
  id: number,
  patch: { name?: string; goal?: string | null },
  today: string,
): Promise<Habit> {
  return readHabit(await api(`/${id}/?today=${today}`, { method: 'PATCH', body: JSON.stringify(patch) }))
}

/** Сегодняшняя отметка. `done` делает запрос повторяемым: он называет итог, а не переключает. */
export async function markHabit(id: number, done: boolean, date: string): Promise<Habit> {
  return readHabit(await api(`/${id}/toggle/`, { method: 'POST', body: JSON.stringify({ done, date }) }))
}

export async function deleteHabit(id: number, options: { keepalive?: boolean } = {}): Promise<void> {
  const response = await api(`/${id}/`, { method: 'DELETE', keepalive: options.keepalive })
  if (!response.ok && response.status !== 404) throw new Error(`habits: ${response.status}`)
}
