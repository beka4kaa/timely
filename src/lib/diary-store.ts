/**
 * diary-store.ts
 * Async storage for Diary — backed by Django/PostgreSQL on Railway.
 *
 * All functions are async; they call the Django REST API via BACKEND_URL.
 * Next.js API routes stay thin: auth via NextAuth, then call these helpers.
 */

import { BACKEND_URL } from '@/lib/api-utils'
import type {
  WeeklyTemplate,
  TemplateLessonSlot,
  DiaryWeek,
  DiaryDay,
  DiaryLesson,
  DayOfWeek,
  GradeUpdate,
  LessonFieldUpdate,
  YoutubeLink,
} from '@/types/diary'
import { DAYS_ORDER, BLOCK_TYPE_META } from '@/types/diary'

// ── Django API helper ────────────────────────────────────────

function diaryFetch(userEmail: string, path: string, opts: RequestInit = {}): Promise<Response> {
  const url = `${BACKEND_URL}/api/diary${path}`
  return fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-user-email': userEmail,
      ...(opts.headers ?? {}),
    },
    cache: 'no-store',
  })
}

// ── Week date helpers ─────────────────────────────────────────

export function getMondayOf(date: Date): string {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

export function getSundayOf(date: Date): string {
  const monday = new Date(getMondayOf(date))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return sunday.toISOString().slice(0, 10)
}

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

export async function getTemplatesForUser(userId: string): Promise<WeeklyTemplate[]> {
  try {
    const res = await diaryFetch(userId, '/templates/')
    if (!res.ok) return []
    return res.json()
  } catch { return [] }
}

export async function getActiveTemplate(userId: string): Promise<WeeklyTemplate | null> {
  try {
    const res = await diaryFetch(userId, '/templates/?is_active=true')
    if (!res.ok) return null
    const data: WeeklyTemplate[] = await res.json()
    return data[0] ?? null
  } catch { return null }
}

export async function createTemplate(
  userId: string,
  name: string,
  slots: Omit<TemplateLessonSlot, 'id'>[] = [],
  customPresets: string[] = [],
): Promise<WeeklyTemplate> {
  const now = new Date().toISOString()
  const template = {
    id: crypto.randomUUID(),
    userId,
    name,
    slots: slots.map(s => ({ ...s, id: crypto.randomUUID() })),
    customPresets,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }
  const res = await diaryFetch(userId, '/templates/', {
    method: 'POST',
    body: JSON.stringify(template),
  })
  if (!res.ok) throw new Error(`Failed to create template: ${res.status}`)
  return res.json()
}

export async function updateTemplate(
  templateId: string,
  userId: string,
  patch: Partial<Pick<WeeklyTemplate, 'name' | 'slots' | 'isActive' | 'customPresets'>>,
): Promise<WeeklyTemplate | null> {
  try {
    const payload: Record<string, unknown> = {}
    if (patch.name !== undefined) payload.name = patch.name
    if (patch.slots !== undefined) {
      payload.slots = patch.slots.map(s => ({ ...s, id: (s as any).id || crypto.randomUUID() }))
    }
    if (patch.isActive !== undefined) payload.isActive = patch.isActive
    if (patch.customPresets !== undefined) payload.customPresets = patch.customPresets

    const res = await diaryFetch(userId, `/templates/${templateId}/`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
    if (!res.ok) return null
    return res.json()
  } catch { return null }
}

export async function deleteTemplate(templateId: string, userId: string): Promise<boolean> {
  try {
    const res = await diaryFetch(userId, `/templates/${templateId}/`, { method: 'DELETE' })
    return res.ok || res.status === 204
  } catch { return false }
}

// ── New template management functions ─────────────────────────

/**
 * Fetch a specific template by ID.
 * Returns null if not found or on error.
 */
export async function getTemplateById(
  userId: string,
  templateId: string,
): Promise<WeeklyTemplate | null> {
  try {
    const res = await diaryFetch(userId, `/templates/${templateId}/`)
    if (!res.ok) return null
    return res.json()
  } catch { return null }
}

/**
 * Create a brand-new, empty template (no lesson slots).
 * The new template starts as inactive so it does not replace the current one.
 */
export async function createEmptyTemplate(
  userId: string,
  name: string,
): Promise<WeeklyTemplate> {
  const res = await diaryFetch(userId, '/templates/create_empty/', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(`Failed to create empty template: ${res.status}`)
  return res.json()
}

/**
 * Duplicate an existing template.
 * The backend copies all TemplateLesson rows with fresh IDs.
 * The copy starts as inactive.
 *
 * @param userId      - owner's email
 * @param templateId  - ID of the template to copy
 * @param name        - optional name override; defaults to "<original> (Copy)"
 */
export async function duplicateTemplate(
  userId: string,
  templateId: string,
  name?: string,
): Promise<WeeklyTemplate> {
  const res = await diaryFetch(userId, `/templates/${templateId}/duplicate/`, {
    method: 'POST',
    body: JSON.stringify(name ? { name } : {}),
  })
  if (!res.ok) throw new Error(`Failed to duplicate template: ${res.status}`)
  return res.json()
}

/**
 * Activate a specific template (deactivates all others for this user).
 */
export async function setActiveTemplate(
  userId: string,
  templateId: string,
): Promise<WeeklyTemplate | null> {
  return updateTemplate(templateId, userId, { isActive: true })
}

/**
 * Apply a template to a diary week (startDate → startDate + 6 days).
 *
 * Strategy:
 *  1. Fetch the target template by ID.
 *  2. Build a fresh DiaryWeek snapshot from that template.
 *  3. If a week already exists for those dates:
 *       - Overwrite lesson structure but PRESERVE grades/homework/notes
 *         for any matching lesson (same day + lessonNumber).
 *  4. Persist / replace the week in the database.
 *
 * @param userId        - owner's email
 * @param templateId    - ID of the template to apply
 * @param weekStart     - ISO "YYYY-MM-DD" Monday date
 * @param resolveSubject - map subjectId → display fields
 */
export async function applyTemplateToWeek(
  userId: string,
  templateId: string,
  weekStart: string,
  resolveSubject: (subjectId: string) => { name: string; emoji: string; color: string },
): Promise<DiaryWeek> {
  // 1. Fetch the requested template
  const template = await getTemplateById(userId, templateId)
  if (!template) throw new Error(`Template ${templateId} not found`)

  // 2. Build fresh snapshot from the template
  const fresh = buildWeekSnapshot(userId, weekStart, template, resolveSubject)

  // 3. Check for existing week and merge preserved data
  try {
    const res = await diaryFetch(userId, `/weeks/?week_start=${weekStart}`)
    if (res.ok) {
      const data: DiaryWeek[] = await res.json()
      const existing = data[0]
      if (existing) {
        // Build lookup: dayOfWeek+lessonNumber → existing lesson data
        type LessonKey = string // `${dayOfWeek}:${lessonNumber}`
        const preserved = new Map<LessonKey, Pick<DiaryLesson, 'grades' | 'homework' | 'notes'>>()
        for (const day of existing.days) {
          for (const lesson of day.lessons) {
            const key: LessonKey = `${day.dayOfWeek}:${lesson.lessonNumber}`
            preserved.set(key, {
              grades:   lesson.grades,
              homework: lesson.homework,
              notes:    lesson.notes,
            })
          }
        }

        // Merge: overlay preserved grades/homework/notes onto fresh lessons
        for (const day of fresh.days) {
          for (const lesson of day.lessons) {
            const key: LessonKey = `${day.dayOfWeek}:${lesson.lessonNumber}`
            const saved = preserved.get(key)
            if (saved) {
              lesson.grades   = saved.grades
              lesson.homework = saved.homework
              lesson.notes    = saved.notes
            }
          }
        }

        // Carry over the existing week ID and persist
        fresh.id = existing.id
        await replaceWeek(userId, existing.id, fresh)
        return fresh
      }
    }
  } catch { /* no existing week — fall through to create */ }

  // 4. No existing week: just persist the fresh snapshot
  await persistWeek(userId, fresh)
  return fresh
}

export function buildWeekSnapshot(
  userId: string,
  weekStart: string,
  template: WeeklyTemplate | null,
  resolveSubject: (subjectId: string) => { name: string; emoji: string; color: string },
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
      const bt = slot.blockType ?? 'lesson'
      const isLesson = bt === 'lesson'

      let subjectName = ''
      let subjectEmoji = '🔖'
      let subjectColor = '#64748b'
      let subjectId = ''

      if (isLesson) {
        const subject = resolveSubject(slot.subjectId)
        subjectName = subject.name
        subjectEmoji = subject.emoji
        subjectColor = subject.color
        subjectId = slot.subjectId
      } else {
        const meta = (BLOCK_TYPE_META as Record<string, { label: string; emoji: string; color: string }>)[bt]
        subjectName = slot.label || (meta?.label ?? bt)
        subjectEmoji = meta?.emoji ?? '🔖'
        subjectColor = '#64748b'
      }

      return {
        id: crypto.randomUUID(),
        lessonNumber: slot.lessonNumber,
        startTime: slot.startTime,
        endTime: slot.endTime,
        blockType: bt,
        blockLabel: slot.label ?? '',
        linkedSubjectIds: [],
        subjectId,
        subjectName,
        subjectEmoji,
        subjectColor,
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

function isWeekUnchanged(week: DiaryWeek): boolean {
  for (const day of week.days) {
    if (day.youtubeLinks && day.youtubeLinks.length > 0) return false
    for (const lesson of day.lessons) {
      const g = lesson.grades
      if (g.retelling !== null || g.exercises !== null || g.test !== null) return false
      if (lesson.homework && lesson.homework.trim() !== '') return false
      if (lesson.notes && lesson.notes.trim() !== '') return false
    }
  }
  return true
}

// ── DiaryWeek persistence ─────────────────────────────────────

async function persistWeek(userId: string, week: DiaryWeek): Promise<void> {
  await diaryFetch(userId, '/weeks/', {
    method: 'POST',
    body: JSON.stringify(week),
  })
}

async function replaceWeek(userId: string, weekId: string, week: DiaryWeek): Promise<void> {
  await diaryFetch(userId, `/weeks/${weekId}/`, {
    method: 'PUT',
    body: JSON.stringify(week),
  })
}

export async function getOrCreateWeek(
  userId: string,
  weekStart: string,
  resolveSubject: (subjectId: string) => { name: string; emoji: string; color: string },
): Promise<DiaryWeek> {
  const template = await getActiveTemplate(userId)

  // Try to load existing week
  try {
    const res = await diaryFetch(userId, `/weeks/?week_start=${weekStart}`)
    if (res.ok) {
      const data: DiaryWeek[] = await res.json()
      const existing = data[0]
      if (existing) {
        if (isWeekUnchanged(existing)) {
          // Refresh from latest template (propagates template changes)
          const refreshed = buildWeekSnapshot(userId, weekStart, template, resolveSubject)
          refreshed.id = existing.id
          await replaceWeek(userId, existing.id, refreshed)
          return refreshed
        }
        return existing
      }
    }
  } catch { /* fallthrough to create */ }

  const newWeek = buildWeekSnapshot(userId, weekStart, template, resolveSubject)
  await persistWeek(userId, newWeek)
  return newWeek
}

/** Force-rebuild week from active template, even if it has grades/notes. */
export async function forceRecreateWeek(
  userId: string,
  weekStart: string,
  resolveSubject: (subjectId: string) => { name: string; emoji: string; color: string },
): Promise<DiaryWeek> {
  const template = await getActiveTemplate(userId)
  try {
    const res = await diaryFetch(userId, `/weeks/?week_start=${weekStart}`)
    if (res.ok) {
      const data: DiaryWeek[] = await res.json()
      const existing = data[0]
      if (existing) {
        const refreshed = buildWeekSnapshot(userId, weekStart, template, resolveSubject)
        refreshed.id = existing.id
        await replaceWeek(userId, existing.id, refreshed)
        return refreshed
      }
    }
  } catch { /* fallthrough */ }
  const newWeek = buildWeekSnapshot(userId, weekStart, template, resolveSubject)
  await persistWeek(userId, newWeek)
  return newWeek
}

export async function getWeeksForUser(userId: string): Promise<DiaryWeek[]> {
  try {
    const res = await diaryFetch(userId, '/weeks/')
    if (!res.ok) return []
    return res.json()
  } catch { return [] }
}

async function getWeekById(userId: string, weekId: string): Promise<DiaryWeek | null> {
  try {
    const res = await diaryFetch(userId, `/weeks/${weekId}/`)
    if (!res.ok) return null
    return res.json()
  } catch { return null }
}

// ── Lesson mutations ──────────────────────────────────────────

export async function updateGrade(
  userId: string,
  weekId: string,
  dayId: string,
  update: GradeUpdate,
): Promise<DiaryWeek | null> {
  const week = await getWeekById(userId, weekId)
  if (!week) return null

  const now = new Date().toISOString()
  const updated: DiaryWeek = {
    ...week,
    days: week.days.map(d =>
      d.id !== dayId ? d : {
        ...d,
        updatedAt: now,
        lessons: d.lessons.map(l =>
          l.id !== update.lessonId ? l : {
            ...l,
            grades: { ...l.grades, [update.type]: update.value },
          }
        ),
      }
    ),
  }
  await replaceWeek(userId, weekId, updated)
  return updated
}

export async function updateLessonField(
  userId: string,
  weekId: string,
  dayId: string,
  update: LessonFieldUpdate,
): Promise<DiaryWeek | null> {
  const week = await getWeekById(userId, weekId)
  if (!week) return null

  const now = new Date().toISOString()
  const updated: DiaryWeek = {
    ...week,
    days: week.days.map(d =>
      d.id !== dayId ? d : {
        ...d,
        updatedAt: now,
        lessons: d.lessons.map(l =>
          l.id !== update.lessonId ? l : { ...l, [update.field]: update.value }
        ),
      }
    ),
  }
  await replaceWeek(userId, weekId, updated)
  return updated
}

export async function updateLinkedSubjects(
  userId: string,
  weekId: string,
  dayId: string,
  lessonId: string,
  linkedSubjectIds: string[],
): Promise<DiaryWeek | null> {
  const week = await getWeekById(userId, weekId)
  if (!week) return null

  const now = new Date().toISOString()
  const updated: DiaryWeek = {
    ...week,
    days: week.days.map(d =>
      d.id !== dayId ? d : {
        ...d,
        updatedAt: now,
        lessons: d.lessons.map(l =>
          l.id !== lessonId ? l : { ...l, linkedSubjectIds }
        ),
      }
    ),
  }
  await replaceWeek(userId, weekId, updated)
  return updated
}

export async function updateDayYoutubeLinks(
  userId: string,
  weekId: string,
  dayId: string,
  links: YoutubeLink[],
): Promise<DiaryWeek | null> {
  const week = await getWeekById(userId, weekId)
  if (!week) return null

  const now = new Date().toISOString()
  const updated: DiaryWeek = {
    ...week,
    days: week.days.map(d =>
      d.id !== dayId ? d : { ...d, updatedAt: now, youtubeLinks: links }
    ),
  }
  await replaceWeek(userId, weekId, updated)
  return updated
}
