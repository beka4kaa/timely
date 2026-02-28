/**
 * diary-grades.ts
 *
 * Pure functions для подсчёта итоговых оценок по предметам.
 *
 * Структура:
 *   lessonGrade     — средняя оценка за один урок (по заполненным: пересказ / упр / тест)
 *   dayGrades       — все оценки за уроки одного предмета в одном дне
 *   monthlyGrade    — средняя оценка по предмету за месяц (по всем урокам в этом месяце)
 *   subjectYearStat — полная статистика по предмету: 12 месячных оценок + годовая
 *   calcYearStats   — агрегатор: принимает DiaryWeek[] за год, возвращает статистику по всем предметам
 */

import type { DiaryWeek, DiaryLesson, LessonGrades, Grade } from '@/types/diary'

// ─────────────────────────────────────────────────────────────────
//  Примитивы
// ─────────────────────────────────────────────────────────────────

/** Среднее только по заполненным (не null) значениям. null если нет ни одного. */
function avg(values: (number | null)[]): number | null {
  const filled = values.filter((v): v is number => v !== null)
  if (filled.length === 0) return null
  return filled.reduce((s, v) => s + v, 0) / filled.length
}

/** Округление до 1 знака после запятой (null → null). */
function round1(v: number | null): number | null {
  return v === null ? null : Math.round(v * 10) / 10
}

// ─────────────────────────────────────────────────────────────────
//  Оценка за урок
// ─────────────────────────────────────────────────────────────────

/**
 * Средняя оценка за один урок.
 * Считается по заполненным полям (пересказ / упражнения / тест).
 * Возвращает null если ни одна оценка не выставлена.
 */
export function lessonGrade(grades: LessonGrades): number | null {
  return round1(avg([grades.retelling, grades.exercises, grades.test]))
}

// ─────────────────────────────────────────────────────────────────
//  Типы результата
// ─────────────────────────────────────────────────────────────────

export interface SubjectYearStat {
  subjectId: string
  subjectName: string
  subjectEmoji: string
  subjectColor: string
  /**
   * 12 элементов: индекс 0 = январь … 11 = декабрь.
   * null — нет данных за этот месяц.
   */
  monthlyGrades: (number | null)[]
  /**
   * Годовая оценка — среднее по месяцам, в которых есть данные.
   * null — нет ни одного урока за год.
   */
  yearlyGrade: number | null
}

// ─────────────────────────────────────────────────────────────────
//  Основная функция
// ─────────────────────────────────────────────────────────────────

/**
 * Принимает все недели дневника за произвольный период.
 * Возвращает массив SubjectYearStat — по одному объекту на каждый
 * встреченный subjectId.
 *
 * @param weeks  Массив DiaryWeek (может быть за любой период, не обязательно 12 мес.)
 * @param year   Календарный год, за который считается статистика (по умолчанию текущий).
 *               Уроки из других лет игнорируются.
 */
export function calcYearStats(
  weeks: DiaryWeek[],
  year = new Date().getFullYear(),
): SubjectYearStat[] {
  // subjectId → month(0-11) → список lesson-grade-значений
  const accumulator = new Map<
    string,
    {
      name: string
      emoji: string
      color: string
      byMonth: Map<number, number[]>
    }
  >()

  for (const week of weeks) {
    for (const day of week.days) {
      // Берём только уроки нужного года
      const dayYear = new Date(day.date).getFullYear()
      if (dayYear !== year) continue

      const month = new Date(day.date).getMonth() // 0-11

      for (const lesson of day.lessons) {
        const grade = lessonGrade(lesson.grades)
        if (grade === null) continue // урок без оценок — не учитываем

        if (!accumulator.has(lesson.subjectId)) {
          accumulator.set(lesson.subjectId, {
            name: lesson.subjectName,
            emoji: lesson.subjectEmoji,
            color: lesson.subjectColor,
            byMonth: new Map(),
          })
        }

        const subj = accumulator.get(lesson.subjectId)!
        if (!subj.byMonth.has(month)) subj.byMonth.set(month, [])
        subj.byMonth.get(month)!.push(grade)
      }
    }
  }

  const result: SubjectYearStat[] = []

  for (const [subjectId, data] of Array.from(accumulator.entries())) {
    // Сформировать массив из 12 месяцев
    const monthlyGrades: (number | null)[] = Array.from({ length: 12 }, (_, m) => {
      const grades = data.byMonth.get(m)
      if (!grades || grades.length === 0) return null
      return round1(avg(grades))
    })

    const yearlyGrade = round1(avg(monthlyGrades))

    result.push({
      subjectId,
      subjectName: data.name,
      subjectEmoji: data.emoji,
      subjectColor: data.color,
      monthlyGrades,
      yearlyGrade,
    })
  }

  // Стабильная сортировка: сначала предметы с лучшей годовой оценкой
  result.sort((a, b) => {
    if (a.yearlyGrade === null && b.yearlyGrade === null) return 0
    if (a.yearlyGrade === null) return 1
    if (b.yearlyGrade === null) return -1
    return b.yearlyGrade - a.yearlyGrade
  })

  return result
}

/**
 * Статистика по предмету за один месяц — с разбивкой по дням.
 */
export interface SubjectMonthStat {
  subjectId: string
  subjectName: string
  subjectEmoji: string
  subjectColor: string
  /** ISO-дата → средняя оценка за все уроки этого предмета в этот день */
  byDay: Record<string, number | null>
  /** Средняя за месяц */
  monthGrade: number | null
}

/**
 * Считает статистику по предметам за конкретный месяц.
 *
 * @param weeks  DiaryWeek[] (может содержать недели за любой период)
 * @param year   Год
 * @param month  Месяц 0-11
 */
export function calcMonthStats(
  weeks: DiaryWeek[],
  year: number,
  month: number,
): SubjectMonthStat[] {
  // subjectId → { meta, byDay: date→grades[] }
  const acc = new Map<
    string,
    { name: string; emoji: string; color: string; byDay: Map<string, number[]> }
  >()

  for (const week of weeks) {
    for (const day of week.days) {
      const d = new Date(day.date)
      if (d.getFullYear() !== year || d.getMonth() !== month) continue

      for (const lesson of day.lessons) {
        const grade = lessonGrade(lesson.grades)
        if (grade === null) continue

        if (!acc.has(lesson.subjectId)) {
          acc.set(lesson.subjectId, {
            name: lesson.subjectName,
            emoji: lesson.subjectEmoji,
            color: lesson.subjectColor,
            byDay: new Map(),
          })
        }
        const subj = acc.get(lesson.subjectId)!
        if (!subj.byDay.has(day.date)) subj.byDay.set(day.date, [])
        subj.byDay.get(day.date)!.push(grade)
      }
    }
  }

  const result: SubjectMonthStat[] = []
  for (const [subjectId, data] of Array.from(acc.entries())) {
    const byDay: Record<string, number | null> = {}
    const allGrades: number[] = []
    for (const [date, grades] of Array.from(data.byDay.entries())) {
      const g = round1(avg(grades))
      byDay[date] = g
      if (g !== null) allGrades.push(g)
    }
    result.push({
      subjectId,
      subjectName: data.name,
      subjectEmoji: data.emoji,
      subjectColor: data.color,
      byDay,
      monthGrade: round1(avg(allGrades)),
    })
  }

  result.sort((a, b) => {
    if (a.monthGrade === null && b.monthGrade === null) return 0
    if (a.monthGrade === null) return 1
    if (b.monthGrade === null) return -1
    return b.monthGrade - a.monthGrade
  })

  return result
}



/** Имя месяца по индексу 0-11 (кратко, на русском). */
export const MONTH_SHORT: readonly string[] = [
  'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн',
  'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек',
]

/**
 * Цвет оценки для отображения в UI — совпадает с логикой GradeCell.
 *   5   → зелёный
 *   4   → синий
 *   3   → жёлтый
 *   1-2 → красный
 *   null → нейтральный
 */
export function gradeColor(grade: number | null): string {
  if (grade === null) return 'text-muted-foreground'
  if (grade >= 4.5) return 'text-green-500'
  if (grade >= 3.5) return 'text-blue-500'
  if (grade >= 2.5) return 'text-yellow-500'
  return 'text-red-500'
}

/**
 * Форматирует оценку для отображения: "4.7" или "—" если null.
 */
export function formatGrade(grade: number | null): string {
  return grade === null ? '—' : grade.toFixed(1)
}
