/**
 * diary-store.ts
 * File-based storage for Diary (WeeklyTemplate + DiaryWeek snapshots).
 *
 * Files:
 *   .data/weekly-templates.json   — WeeklyTemplate[]
 *   .data/diary-weeks.json        — DiaryWeek[]
 *
 * Snapshot contract:
 *   When a user opens a week for the first time, the active template is
 *   "frozen" into a DiaryWeek. Subsequent changes to the template
 *   do NOT touch already-created weeks.
 */

import fs from 'fs'
import path from 'path'
import { findUserByEmail } from '@/lib/local-users'
import type {
  WeeklyTemplate,
  TemplateLessonSlot,
  DiaryWeek,
  DiaryDay,
  DiaryLesson,
  LessonGrades,
  Grade,
  DayOfWeek,
  GradeUpdate,
  LessonFieldUpdate,
  YoutubeLink,
} from '@/types/diary'
import { DAYS_ORDER } from '@/types/diary'

// ── File paths ────────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), '.data')
const TEMPLATES_FILE = path.join(DATA_DIR, 'weekly-templates.json')
const DIARY_FILE = path.join(DATA_DIR, 'diary-weeks.json')

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

// ── Generic read/write ────────────────────────────────────────

function readJson<T>(file: string, defaultValue: T): T {
  ensureDir()
  if (!fs.existsSync(file)) return defaultValue
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T
  } catch {
    return defaultValue
  }
}

function writeJson<T>(file: string, data: T) {
  ensureDir()
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}

// ── Week date helpers ─────────────────────────────────────────

/** Returns ISO string of Monday for the week containing `date`. */
export function getMondayOf(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = (day === 0 ? -6 : 1 - day) // make Sunday go back 6 days
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

/** Returns ISO string of Sunday for the week containing `date`. */
export function getSundayOf(date: Date): string {
  const monday = new Date(getMondayOf(date))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return sunday.toISOString().slice(0, 10)
}

/** Returns ISO date string for each day mon–sun of the week. */
function weekDates(weekStart: string): Record<DayOfWeek, string> {
  const base = new Date(weekStart)
  const result = {} as Record<DayOfWeek, string>
  DAYS_ORDER.forEach((day, i) => {
    const d = new Date(base)
    d.setDate(base.getDate() + i)
    result[day] = d.toISOString().slice(0, 10)
  })
  return result
}

// ── Template CRUD ─────────────────────────────────────────────

function readTemplates(): WeeklyTemplate[] {
  return readJson<WeeklyTemplate[]>(TEMPLATES_FILE, [])
}

function writeTemplates(templates: WeeklyTemplate[]) {
  writeJson(TEMPLATES_FILE, templates)
}

export function getTemplatesForUser(userId: string): WeeklyTemplate[] {
  return readTemplates().filter(t => t.userId === userId)
}

export function getActiveTemplate(userId: string): WeeklyTemplate | null {
  return readTemplates().find(t => t.userId === userId && t.isActive) ?? null
}

export function createTemplate(
  userId: string,
  name: string,
  slots: Omit<TemplateLessonSlot, 'id'>[] = [],
): WeeklyTemplate {
  const templates = readTemplates()

  // Deactivate existing active templates for this user
  const updated = templates.map(t =>
    t.userId === userId ? { ...t, isActive: false } : t
  )

  const now = new Date().toISOString()
  const template: WeeklyTemplate = {
    id: crypto.randomUUID(),
    userId,
    name,
    slots: slots.map(s => ({ ...s, id: crypto.randomUUID() })),
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }

  writeTemplates([...updated, template])
  return template
}

export function updateTemplate(
  templateId: string,
  userId: string,
  patch: Partial<Pick<WeeklyTemplate, 'name' | 'slots' | 'isActive'>>,
): WeeklyTemplate | null {
  const templates = readTemplates()
  const idx = templates.findIndex(t => t.id === templateId && t.userId === userId)
  if (idx === -1) return null

  // If activating this template, deactivate others
  let list = templates
  if (patch.isActive) {
    list = templates.map(t =>
      t.userId === userId ? { ...t, isActive: false } : t
    )
  }

  const existing = list[idx] ?? templates[idx]
  const updated: WeeklyTemplate = {
    ...existing,
    ...patch,
    slots: patch.slots
      ? patch.slots.map(s => ({ ...s, id: s.id || crypto.randomUUID() }))
      : existing.slots,
    updatedAt: new Date().toISOString(),
  }

  list[idx] = updated
  writeTemplates(list)
  return updated
}

export function deleteTemplate(templateId: string, userId: string): boolean {
  const templates = readTemplates()
  const filtered = templates.filter(t => !(t.id === templateId && t.userId === userId))
  if (filtered.length === templates.length) return false
  writeTemplates(filtered)
  return true
}

// ── Snapshot: generate DiaryWeek from template  ───────────────

/**
 * Builds a DiaryWeek snapshot from the given template.
 * Subject names/emojis/colors are looked up via the `resolveSubject` callback —
 * this lets the caller pass in live subject data while keeping the store
 * free of HTTP calls.
 */
export function buildWeekSnapshot(
  userId: string,
  weekStart: string,
  template: WeeklyTemplate | null,
  resolveSubject: (subjectId: string) => {
    name: string
    emoji: string
    color: string
  },
): DiaryWeek {
  const now = new Date().toISOString()
  const weekId = crypto.randomUUID()
  const dates = weekDates(weekStart)

  const days: DiaryDay[] = DAYS_ORDER.map(dayOfWeek => {
    const slots = template
      ? template.slots
          .filter(s => s.dayOfWeek === dayOfWeek)
          .sort((a, b) => a.lessonNumber - b.lessonNumber)
      : []

    const lessons: DiaryLesson[] = slots.map(slot => {
      const subject = resolveSubject(slot.subjectId)
      return {
        id: crypto.randomUUID(),
        lessonNumber: slot.lessonNumber,
        startTime: slot.startTime,
        endTime: slot.endTime,
        subjectId: slot.subjectId,
        subjectName: subject.name,
        subjectEmoji: subject.emoji,
        subjectColor: subject.color,
        grades: { retelling: null, exercises: null, test: null },
        homework: '',
        notes: '',
      }
    })

    return {
      id: crypto.randomUUID(),
      userId,
      date: dates[dayOfWeek],
      dayOfWeek,
      weekId,
      lessons,
      youtubeLinks: [],
      createdAt: now,
      updatedAt: now,
    }
  })

  return {
    id: weekId,
    userId,
    weekStart,
    weekEnd: getSundayOf(new Date(weekStart)),
    templateId: template?.id ?? null,
    days,
    createdAt: now,
  }
}

// ── DiaryWeek CRUD ────────────────────────────────────────────

function readWeeks(): DiaryWeek[] {
  return readJson<DiaryWeek[]>(DIARY_FILE, [])
}

function writeWeeks(weeks: DiaryWeek[]) {
  writeJson(DIARY_FILE, weeks)
}

/**
 * Returns true if the user has made no data entries on this week
 * (all grades null, all homework/notes empty, no youtube links).
 * Such weeks can be safely rebuilt from the latest template.
 */
function isWeekUnchanged(week: DiaryWeek): boolean {
  for (const day of week.days) {
    if (day.youtubeLinks && day.youtubeLinks.length > 0) return false
    for (const lesson of day.lessons) {
      const grades = lesson.grades
      if (
        grades.retelling !== null ||
        grades.exercises !== null ||
        grades.test !== null
      ) return false
      if (lesson.homework && lesson.homework.trim() !== '') return false
      if (lesson.notes && lesson.notes.trim() !== '') return false
    }
  }
  return true
}

/**
 * Returns the DiaryWeek for a given Monday date:
 * - If the week doesn't exist → create from active template.
 * - If the week exists but has NO user changes → rebuild from the current
 *   active template (so template updates propagate to untouched weeks).
 * - If the week exists and has ANY user data → return as-is.
 *
 * @param resolveSubject  Callback to get subject display data by ID.
 */
export function getOrCreateWeek(
  userId: string,
  weekStart: string,
  resolveSubject: (subjectId: string) => { name: string; emoji: string; color: string },
): DiaryWeek {
  // Block lessons for weeks before the user's registration date
  const localUser = findUserByEmail(userId)
  if (localUser?.createdAt) {
    const registrationMonday = getMondayOf(new Date(localUser.createdAt))
    if (weekStart < registrationMonday) {
      // Return an empty week (no lessons) — don't persist it
      return buildWeekSnapshot(userId, weekStart, null, resolveSubject)
    }
  }

  const weeks = readWeeks()
  const existingIdx = weeks.findIndex(w => w.userId === userId && w.weekStart === weekStart)

  const template = getActiveTemplate(userId)

  if (existingIdx !== -1) {
    const existing = weeks[existingIdx]
    // If the user hasn't entered anything, refresh from the current template
    if (isWeekUnchanged(existing)) {
      const refreshed = buildWeekSnapshot(userId, weekStart, template, resolveSubject)
      weeks[existingIdx] = refreshed
      writeWeeks(weeks)
      return refreshed
    }
    return existing
  }

  const newWeek = buildWeekSnapshot(userId, weekStart, template, resolveSubject)
  writeWeeks([...weeks, newWeek])
  return newWeek
}

export function getWeeksForUser(userId: string): DiaryWeek[] {
  return readWeeks()
    .filter(w => w.userId === userId)
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
}

// ── Lesson mutations (grades, homework, notes) ────────────────

function updateDay(
  userId: string,
  weekId: string,
  dayId: string,
  mutate: (day: DiaryDay) => DiaryDay,
): DiaryWeek | null {
  const weeks = readWeeks()
  const weekIdx = weeks.findIndex(w => w.id === weekId && w.userId === userId)
  if (weekIdx === -1) return null

  const week = weeks[weekIdx]
  const dayIdx = week.days.findIndex(d => d.id === dayId)
  if (dayIdx === -1) return null

  const updatedDay = mutate({ ...week.days[dayIdx] })
  updatedDay.updatedAt = new Date().toISOString()

  const updatedWeek = {
    ...week,
    days: week.days.map((d, i) => (i === dayIdx ? updatedDay : d)),
  }
  weeks[weekIdx] = updatedWeek
  writeWeeks(weeks)
  return updatedWeek
}

export function updateGrade(
  userId: string,
  weekId: string,
  dayId: string,
  update: GradeUpdate,
): DiaryWeek | null {
  return updateDay(userId, weekId, dayId, day => ({
    ...day,
    lessons: day.lessons.map(l =>
      l.id === update.lessonId
        ? { ...l, grades: { ...l.grades, [update.type]: update.value } }
        : l
    ),
  }))
}

export function updateLessonField(
  userId: string,
  weekId: string,
  dayId: string,
  update: LessonFieldUpdate,
): DiaryWeek | null {
  return updateDay(userId, weekId, dayId, day => ({
    ...day,
    lessons: day.lessons.map(l =>
      l.id === update.lessonId ? { ...l, [update.field]: update.value } : l
    ),
  }))
}

export function updateDayYoutubeLinks(
  userId: string,
  weekId: string,
  dayId: string,
  links: YoutubeLink[],
): DiaryWeek | null {
  return updateDay(userId, weekId, dayId, day => ({
    ...day,
    youtubeLinks: links,
  }))
}
