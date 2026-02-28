// ============================================================
// DIARY — Types & Interfaces
// ============================================================

// ----- Shared primitives ------------------------------------

export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday'

export const DAY_OF_WEEK_LABELS: Record<DayOfWeek, string> = {
  monday: 'Понедельник',
  tuesday: 'Вторник',
  wednesday: 'Среда',
  thursday: 'Четверг',
  friday: 'Пятница',
  saturday: 'Суббота',
  sunday: 'Воскресенье',
}

export const DAYS_ORDER: DayOfWeek[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]

export const DAY_SHORT_LABELS: Record<DayOfWeek, string> = {
  monday: 'Пн',
  tuesday: 'Вт',
  wednesday: 'Ср',
  thursday: 'Чт',
  friday: 'Пт',
  saturday: 'Сб',
  sunday: 'Вс',
}

/** Grade 1–5, or null = not graded yet */
export type Grade = 1 | 2 | 3 | 4 | 5 | null

/** A YouTube video or stream link attached to a diary day */
export interface YoutubeLink {
  id: string
  url: string
  /** Optional custom label, e.g. "Лекция по математике" */
  label?: string
  /** Duration in minutes (optional, user-entered) */
  durationMin?: number
  createdAt: string
}

/**
 * Three types of grades per lesson.
 *  - retelling : пересказ
 *  - exercises : упражнения
 *  - test      : тест
 */
export interface LessonGrades {
  retelling: Grade
  exercises: Grade
  test: Grade
}

export const GRADE_TYPE_LABELS: Record<keyof LessonGrades, string> = {
  retelling: 'Пересказ',
  exercises: 'Упражнения',
  test: 'Тест',
}

// ----- Template entities ------------------------------------

/**
 * One lesson slot inside a WeeklyTemplate.
 * Contains NO grades — only structural info for a specific day.
 */
export type BlockType = string

export type PresetBlockType = 'lesson' | 'break' | 'focus' | 'test' | 'other'

export const BLOCK_TYPE_META: Record<PresetBlockType, { label: string; emoji: string; color: string }> = {
  lesson:  { label: 'Урок',     emoji: '📚', color: 'text-blue-400' },
  break:   { label: 'Перерыв', emoji: '☕', color: 'text-slate-400' },
  focus:   { label: 'Фокус',   emoji: '🎯', color: 'text-violet-400' },
  test:    { label: 'Тест',    emoji: '📝', color: 'text-orange-400' },
  other:   { label: 'Другое',  emoji: '🔖', color: 'text-green-400' },
}

export const PRESET_BLOCK_TYPES: PresetBlockType[] = ['lesson', 'break', 'focus', 'test', 'other']

export interface TemplateLessonSlot {
  id: string
  dayOfWeek: DayOfWeek
  lessonNumber: number   // порядковый номер урока в дне (1, 2, 3…)
  startTime: string      // "08:00"
  endTime: string        // "08:45"
  subjectId: string      // ссылка на Subject (только для blockType=lesson)
  blockType?: BlockType  // тип блока (по умолчанию 'lesson')
  label?: string         // название для не-урочных блоков
}

/**
 * Weekly schedule template.
 * A user can have multiple templates but only one active at a time.
 *
 * IMPORTANT: Changing a template NEVER affects already-generated DiaryWeeks —
 * those are historical snapshots.
 */
export interface WeeklyTemplate {
  id: string
  userId: string
  name: string
  /** All lesson slots across all days of the week */
  slots: TemplateLessonSlot[]
  isActive: boolean
  createdAt: string
  updatedAt: string
}

// ----- Concrete diary entities (historical snapshots) --------

/**
 * A lesson as it was recorded in a specific DiaryDay.
 *
 * subjectName / subjectEmoji / subjectColor are DENORMALIZED from Subject
 * at snapshot time so that renaming a subject in the future
 * does not corrupt historical records.
 */
export interface DiaryLesson {
  id: string
  lessonNumber: number
  startTime: string        // "08:00"
  endTime: string          // "08:45"

  // Subject reference + denormalized snapshot fields
  subjectId: string
  subjectName: string
  subjectEmoji: string
  subjectColor: string

  grades: LessonGrades
  homework: string         // DOM-задание (пустая строка = нет)
  notes: string            // Заметки учителя / ученика
}

/**
 * One day in the diary.
 * Created as a static snapshot when a DiaryWeek is opened for the first time.
 * Lessons array is a copy from WeeklyTemplate — edits here do NOT
 * affect the template or other weeks.
 */
export interface DiaryDay {
  id: string
  userId: string
  date: string             // ISO "2026-02-23"
  dayOfWeek: DayOfWeek
  weekId: string           // parent DiaryWeek.id
  lessons: DiaryLesson[]
  /** YouTube videos / streams watched this day */
  youtubeLinks: YoutubeLink[]
  createdAt: string
  updatedAt: string
}

/**
 * One calendar week in the diary.
 * Generated automatically on first access by copying the active WeeklyTemplate.
 * After creation it is IMMUTABLE in structure — only lesson grades/homework/notes
 * inside DiaryDays can be edited.
 */
export interface DiaryWeek {
  id: string
  userId: string
  /** Monday of this week, ISO "2026-02-23" */
  weekStart: string
  /** Sunday of this week, ISO "2026-03-01" */
  weekEnd: string
  /**
   * ID of the WeeklyTemplate that was used to generate this week.
   * Stored for audit; changes to the template do NOT retroactively affect this week.
   */
  templateId: string | null
  days: DiaryDay[]         // always 7 entries, mon–sun
  createdAt: string
}

// ----- Storage shape ----------------------------------------

/** Shape of .data/weekly-templates.json */
export interface TemplatesStore {
  templates: WeeklyTemplate[]
}

/** Shape of .data/diary-weeks.json */
export interface DiaryStore {
  weeks: DiaryWeek[]
}

// ----- Helper types for UI ----------------------------------

export interface GradeUpdate {
  lessonId: string
  type: keyof LessonGrades
  value: Grade
}

export interface LessonFieldUpdate {
  lessonId: string
  field: 'homework' | 'notes'
  value: string
}
