import type { GoalType, GoalStatus, GoalPriority, GoalLinkType } from '@/types/goals'

/** Accent palette per goal type — pink/violet/white/champagne. No cyan/blue. */
export const TYPE_COLOR: Record<GoalType, string> = {
  global_goal:    '#f6e9ff', // bright white-violet
  goal:           '#a78bfa', // violet
  subgoal:        '#d946ef', // magenta-pink
  milestone:      '#e9e3f5', // soft white
  task:           '#9aa0b5', // muted gray (done → soft green, at render)
  habit:          '#ff4fd8', // rose
  financial_goal: '#e9c7a8', // champagne
}

export const TYPE_LABEL: Record<GoalType, string> = {
  global_goal:    'Глобальная',
  goal:           'Цель',
  subgoal:        'Подцель',
  milestone:      'Этап',
  task:           'Задача',
  habit:          'Привычка',
  financial_goal: 'Финансы',
}

export const STATUS_COLOR: Record<GoalStatus, string> = {
  not_started: '#8b8fa3',
  active:      '#c4a5fb', // violet
  on_track:    '#7ee7b8', // soft green
  at_risk:     '#f6c177', // muted champagne-amber
  blocked:     '#ff5f7a', // muted rose-red
  done:        '#7ee7b8',
  archived:    '#5b5b66',
}

export const STATUS_LABEL: Record<GoalStatus, string> = {
  not_started: 'Не начато',
  active:      'Активна',
  on_track:    'В графике',
  at_risk:     'Под риском',
  blocked:     'Заблокирована',
  done:        'Готово',
  archived:    'В архиве',
}

export const PRIORITY_COLOR: Record<GoalPriority, string> = {
  low:      '#8b8fa3',
  medium:   '#c4a5fb',
  high:     '#e9c7a8',
  critical: '#ff5f7a',
}

export const PRIORITY_LABEL: Record<GoalPriority, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  critical: 'Критичный',
}

/** Link rendering hints for the graph. */
export const LINK_STYLE: Record<GoalLinkType, { color: string; dashed: boolean }> = {
  parent_child: { color: 'rgba(255,255,255,0.18)',  dashed: false },
  depends_on:   { color: 'rgba(217,70,239,0.40)',   dashed: true  },
  blocks:       { color: 'rgba(255,95,122,0.55)',   dashed: false },
  supports:     { color: 'rgba(126,231,184,0.38)',  dashed: false },
  related_to:   { color: 'rgba(255,255,255,0.10)',  dashed: true  },
}

/** Force-graph circle radius per type. */
export const TYPE_RADIUS: Record<GoalType, number> = {
  global_goal:    11,
  goal:           8,
  subgoal:        6,
  milestone:      4.5,
  task:           3.5,
  habit:          5,
  financial_goal: 9,
}

/** Effective accent color — tasks split done/not-done, blocked overrides. */
export function nodeColor(type: GoalType, status: GoalStatus): string {
  if (status === 'blocked') return '#ff5f7a'
  if (type === 'task') return status === 'done' ? '#7ee7b8' : '#9aa0b5'
  return TYPE_COLOR[type]
}

/** The signature accent gradient used for primary surfaces. */
export const GOALS_GRADIENT = 'linear-gradient(135deg, #ff4fd8 0%, #8b5cf6 52%, #f3e8ff 120%)'

/* ── Graph palette: calm, mostly neutral (Obsidian-like). Pink only on select. ── */
export function graphNodeColor(type: GoalType, status: GoalStatus): string {
  if (status === 'blocked') return '#c98a92'              // muted red
  if (type === 'task') return status === 'done' ? '#8fae9d' : '#9aa0b0' // muted green-gray / gray
  if (type === 'financial_goal') return '#cdb9a3'         // muted champagne
  if (type === 'global_goal') return '#e8e8ef'            // soft white
  if (type === 'milestone') return '#cfcfdb'              // soft white-gray
  return '#b9b9c6'                                         // goal / subgoal — soft gray
}

/** Smaller, calmer radii for the minimal graph. */
export const GRAPH_RADIUS: Record<GoalType, number> = {
  global_goal: 8, goal: 6, subgoal: 5, milestone: 4, task: 3.5, habit: 4.5, financial_goal: 6,
}

const CURRENCY_SYMBOL: Record<string, string> = { USD: '$', EUR: '€', RUB: '₽', KZT: '₸' }

export function formatMoney(amount: number, currency = 'USD'): string {
  const sym = CURRENCY_SYMBOL[currency] ?? ''
  return `${sym}${amount.toLocaleString('ru-RU')}`
}

const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

/** "2026-07" → "Июль 2026". "0000-00" is the no-deadline bucket. */
export function formatMonth(month: string): string {
  if (month === '0000-00') return 'Без срока'
  const [y, m] = month.split('-')
  const idx = Number(m) - 1
  return `${MONTHS_RU[idx] ?? month} ${y}`
}
