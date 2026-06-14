import type { GoalNode, TimeScale } from '@/types/goals'

export const WEEKDAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
export const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]
export const MONTHS_RU_SHORT = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

/* ── core conversions (local, anchored at noon to dodge TZ edges) ── */

export function toISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0)
}

export function todayISO(): string {
  return toISO(new Date())
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

export function addDays(iso: string, n: number): string {
  const d = parseISO(iso)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

export function addMonths(iso: string, n: number): string {
  const d = parseISO(iso)
  d.setMonth(d.getMonth() + n)
  return toISO(d)
}

export function isSameDay(a: string, b: string): boolean {
  return a === b
}

export function isToday(iso: string): boolean {
  return iso === todayISO()
}

/** Inclusive range test; tolerates null bounds. */
export function inRange(iso: string, start: string | null, end: string | null): boolean {
  if (!start) return false
  const lo = start
  const hi = end ?? start
  const [a, b] = lo <= hi ? [lo, hi] : [hi, lo]
  return iso >= a && iso <= b
}

/* ── grids ── */

/** Monday-first 6×7 month matrix of ISO dates for the month containing `iso`. */
export function monthMatrix(iso: string): string[][] {
  const d = parseISO(iso)
  const first = new Date(d.getFullYear(), d.getMonth(), 1, 12)
  const weekday = (first.getDay() + 6) % 7 // 0 = Monday
  const start = new Date(first)
  start.setDate(first.getDate() - weekday)
  const weeks: string[][] = []
  const cur = new Date(start)
  for (let w = 0; w < 6; w++) {
    const row: string[] = []
    for (let i = 0; i < 7; i++) {
      row.push(toISO(cur))
      cur.setDate(cur.getDate() + 1)
    }
    weeks.push(row)
  }
  return weeks
}

/** 7 ISO dates (Mon–Sun) of the week containing `iso`. */
export function weekDays(iso: string): string[] {
  const d = parseISO(iso)
  const weekday = (d.getDay() + 6) % 7
  const monday = new Date(d)
  monday.setDate(d.getDate() - weekday)
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(monday)
    x.setDate(monday.getDate() + i)
    return toISO(x)
  })
}

export function monthOf(iso: string): number { return parseISO(iso).getMonth() }
export function yearOf(iso: string): number { return parseISO(iso).getFullYear() }

/** First-day ISO of each month in the quarter containing `iso`. */
export function quarterMonths(iso: string): string[] {
  const d = parseISO(iso)
  const q = Math.floor(d.getMonth() / 3)
  return [0, 1, 2].map(i => toISO(new Date(d.getFullYear(), q * 3 + i, 1, 12)))
}

/** First-day ISO of each of the 12 months in the year of `iso`. */
export function yearMonths(iso: string): string[] {
  const y = parseISO(iso).getFullYear()
  return Array.from({ length: 12 }, (_, i) => toISO(new Date(y, i, 1, 12)))
}

/** First-day ISO of January for `count` years starting at the year of `iso`. */
export function multiYears(iso: string, count = 3): string[] {
  const y = parseISO(iso).getFullYear()
  return Array.from({ length: count }, (_, i) => toISO(new Date(y + i, 0, 1, 12)))
}

/* ── goal ↔ date matching ── */

/** Does a goal occupy a given calendar day? (span, start, or due) */
export function goalCoversDate(goal: GoalNode, iso: string): boolean {
  if (goal.startDate && goal.endDate) return inRange(iso, goal.startDate, goal.endDate)
  if (goal.startDate) return goal.startDate === iso
  if (goal.dueDate) return goal.dueDate === iso
  return false
}

export function goalsOnDate(goals: GoalNode[], iso: string): GoalNode[] {
  return goals.filter(g => g.status !== 'archived' && goalCoversDate(g, iso))
}

/** Any goal touching [start..end] inclusive (by span/start/due/month). */
export function goalsInRange(goals: GoalNode[], start: string, end: string): GoalNode[] {
  const [a, b] = start <= end ? [start, end] : [end, start]
  return goals.filter(g => {
    if (g.status === 'archived') return false
    if (g.startDate && g.endDate) return g.startDate <= b && g.endDate >= a
    const anchor = g.startDate || g.dueDate
    if (anchor) return anchor >= a && anchor <= b
    if (g.month) return g.month >= a.slice(0, 7) && g.month <= b.slice(0, 7)
    return false
  })
}

/* ── scale → range / labels ── */

export function rangeForScale(scale: TimeScale, anchorISO: string): { start: string; end: string } {
  const d = parseISO(anchorISO)
  switch (scale) {
    case 'day':
      return { start: anchorISO, end: anchorISO }
    case 'week': {
      const wd = weekDays(anchorISO)
      return { start: wd[0], end: wd[6] }
    }
    case 'month': {
      const start = toISO(new Date(d.getFullYear(), d.getMonth(), 1, 12))
      const end = toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12))
      return { start, end }
    }
    case 'quarter': {
      const q = Math.floor(d.getMonth() / 3)
      const start = toISO(new Date(d.getFullYear(), q * 3, 1, 12))
      const end = toISO(new Date(d.getFullYear(), q * 3 + 3, 0, 12))
      return { start, end }
    }
    case 'year':
      return { start: toISO(new Date(d.getFullYear(), 0, 1, 12)), end: toISO(new Date(d.getFullYear(), 11, 31, 12)) }
    case 'multi_year':
      return { start: toISO(new Date(d.getFullYear(), 0, 1, 12)), end: toISO(new Date(d.getFullYear() + 2, 11, 31, 12)) }
  }
}

export function scaleLabel(scale: TimeScale, anchorISO: string): string {
  const d = parseISO(anchorISO)
  switch (scale) {
    case 'day':
      return `${d.getDate()} ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`
    case 'week': {
      const wd = weekDays(anchorISO)
      const a = parseISO(wd[0]); const b = parseISO(wd[6])
      return `${a.getDate()} ${MONTHS_RU_SHORT[a.getMonth()]} – ${b.getDate()} ${MONTHS_RU_SHORT[b.getMonth()]}`
    }
    case 'month':
      return `${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`
    case 'quarter':
      return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`
    case 'year':
      return `${d.getFullYear()}`
    case 'multi_year':
      return `${d.getFullYear()}–${d.getFullYear() + 2}`
  }
}

export function formatDayLong(iso: string): string {
  const d = parseISO(iso)
  return `${d.getDate()} ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}`
}
