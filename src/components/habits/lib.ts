import { BACKEND_URL } from '@/lib/api-utils'

export interface CalDay {
  date: string
  done: boolean
  minutes: number
}

export interface Habit {
  id: number
  name: string
  emoji: string
  color: string
  goalText: string
  freezeBudget: number
  createdAt: string
  streak: number
  shieldsUsed: number
  shieldsLeft: number
  doneToday: boolean
  totalDone: number
  totalMinutes: number
  noteToday: string
  minutesToday: number
  hasPhotoToday: boolean
  calendar: CalDay[]
}

export interface GalleryItem {
  id: number
  habitId: number
  habitName: string
  emoji: string
  color: string
  date: string
  photo: string
  note: string
  minutes: number
}

export function mapHabit(raw: any): Habit {
  return {
    id: raw.id,
    name: raw.name,
    emoji: raw.emoji,
    color: raw.color,
    goalText: raw.goal_text ?? '',
    freezeBudget: raw.freeze_budget ?? 0,
    createdAt: raw.created_at,
    streak: raw.streak ?? 0,
    shieldsUsed: raw.shields_used ?? 0,
    shieldsLeft: raw.shields_left ?? 0,
    doneToday: raw.done_today ?? false,
    totalDone: raw.total_done ?? 0,
    totalMinutes: raw.total_minutes ?? 0,
    noteToday: raw.note_today ?? '',
    minutesToday: raw.minutes_today ?? 0,
    hasPhotoToday: raw.has_photo_today ?? false,
    calendar: raw.calendar ?? [],
  }
}

export function api(path: string, email: string, options: RequestInit = {}) {
  return fetch(`${BACKEND_URL}/api/habits${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-user-email': email,
      ...options.headers,
    },
  })
}

export const COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#ef4444',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
  '#3b82f6', '#06b6d4',
]

export const EMOJIS = ['✨', '💪', '📚', '🏃', '🧘', '💧', '🎯', '🌱', '🔥', '🎨', '🎵', '🍎', '😴', '🧠', '✍️', '🚀', '☕', '🦷']

export const MILESTONES: { days: number; message: string }[] = [
  { days: 3,   message: '3 дня — отличный старт!' },
  { days: 7,   message: 'Неделя! Привычка формируется 🎉' },
  { days: 14,  message: 'Две недели! Ты в потоке 💪' },
  { days: 21,  message: '21 день — почти автоматизм!' },
  { days: 30,  message: 'Месяц! Это часть тебя 🌱' },
  { days: 60,  message: 'Два месяца! Невероятно ⚡' },
  { days: 100, message: '100 дней! Легенда 🏆' },
  { days: 365, message: 'ГОД. Ты изменил себя ✨' },
]

export function getMilestone(streak: number): string | null {
  const hit = [...MILESTONES].reverse().find(m => streak >= m.days)
  return hit ? hit.message : null
}

export function daysWord(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'день'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'дня'
  return 'дней'
}

export function greeting(): string {
  const h = new Date().getHours()
  if (h < 6) return 'Доброй ночи'
  if (h < 12) return 'Доброе утро'
  if (h < 18) return 'Добрый день'
  return 'Добрый вечер'
}

/** Lighten a hex color toward white by `amt` (0..1). */
export function lighten(hex: string, amt: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const mix = (c: number) => Math.round(c + (255 - c) * amt)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

/** Vibrant diagonal gradient used to fill a completed habit card. */
export function cardGradient(color: string): string {
  return `linear-gradient(135deg, ${color} 0%, ${lighten(color, 0.28)} 100%)`
}

/** Resize an image file to a max dimension and return a JPEG data URL. */
export async function resizeImage(file: File, max = 640, quality = 0.78): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  return canvas.toDataURL('image/jpeg', quality)
}

export function softHaptic() {
  try { navigator.vibrate?.(12) } catch { /* no-op */ }
}
