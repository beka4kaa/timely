// Правки недели дневника и школьного расписания. Без React и без запросов: запись
// в `use-diary-week.ts` и `template-api.ts`. Импорты с «.ts» и только типы через «@/»: ради
// `node --test` без сборщика.

import type { LessonSlot } from "@/lib/diary-undo";
import type { DiaryDay, DiaryLesson, DiaryWeek, LessonGrades, TemplateLessonSlot } from "@/types/diary";

import { DAYS_ORDER } from "../../types/diary.ts";

export interface LessonValues {
  homework?: string;
  notes?: string;
  homeworkDone?: boolean;
  grades?: Partial<LessonGrades>;
}

export interface LessonPlace {
  day_id: string;
  lesson_id: string;
  slot: LessonSlot;
  subject_id: string;
}

/** `expect` то, что должно быть в уроке сейчас, `write` то, что туда лягут. */
export interface LessonEdit {
  place: LessonPlace;
  expect: LessonValues;
  write: LessonValues;
}

/** Карточка опоздала: урока больше нет или в нём уже другое. Чужое не перезаписываем. */
export class LessonChangedError extends Error {
  readonly isStale = true;
}

export interface Located {
  day: DiaryDay;
  lesson: DiaryLesson;
}

export function locateById(week: DiaryWeek, dayId: string, lessonId: string): Located | null {
  const day = week.days.find((item) => item.id === dayId);
  const lesson = day?.lessons.find((item) => item.id === lessonId);
  return day && lesson ? { day, lesson } : null;
}

export function locateBySlot(week: DiaryWeek, slot: LessonSlot): Located | null {
  const day = week.days.find((item) => item.dayOfWeek === slot.dayOfWeek);
  const lesson =
    day?.lessons.find(
      (item) => item.lessonNumber === slot.lessonNumber && item.startTime === slot.startTime,
    ) ?? day?.lessons.find((item) => item.lessonNumber === slot.lessonNumber);
  return day && lesson ? { day, lesson } : null;
}

export function mapLesson(
  week: DiaryWeek,
  dayId: string,
  lessonId: string,
  change: (lesson: DiaryLesson) => DiaryLesson,
): DiaryWeek {
  return {
    ...week,
    days: week.days.map((day) =>
      day.id !== dayId
        ? day
        : {
            ...day,
            lessons: day.lessons.map((lesson) =>
              lesson.id === lessonId ? change(lesson) : lesson,
            ),
          },
    ),
  };
}

const text = (value: string | undefined | null) => (value ?? "").trim();

function holds(lesson: DiaryLesson, expected: LessonValues): boolean {
  if (expected.homework !== undefined && text(lesson.homework) !== text(expected.homework)) return false;
  if (expected.notes !== undefined && text(lesson.notes) !== text(expected.notes)) return false;
  if (expected.homeworkDone !== undefined && Boolean(lesson.homeworkDone) !== expected.homeworkDone) return false;
  return Object.entries(expected.grades ?? {}).every(
    ([field, value]) => (lesson.grades?.[field as keyof LessonGrades] ?? null) === (value ?? null),
  );
}

const NO_GRADES: LessonGrades = { retelling: null, exercises: null, test: null };

function written(lesson: DiaryLesson, { grades, ...rest }: LessonValues): DiaryLesson {
  return { ...lesson, ...rest, ...(grades ? { grades: { ...NO_GRADES, ...lesson.grades, ...grades } } : {}) };
}

/** Неделя с правками. Хоть один урок не на месте: не меняется ничего. */
export function applyLessonEdits(week: DiaryWeek, edits: LessonEdit[]): DiaryWeek {
  return edits.reduce((current, { place, expect, write }) => {
    const found = locateById(current, place.day_id, place.lesson_id) ?? locateBySlot(current, place.slot);
    if (!found || (found.lesson.subjectId ?? "") !== place.subject_id) {
      throw new LessonChangedError("Этого урока на неделе больше нет");
    }
    if (!holds(found.lesson, expect)) throw new LessonChangedError("В этом уроке уже другая запись");
    return mapLesson(current, found.day.id, found.lesson.id, (lesson) => written(lesson, write));
  }, week);
}

// ─────────────────────────── Школьное расписание ─────────────────────────────

export interface TimetableLesson {
  weekday: number;
  start: string;
  end: string;
  subject: string;
}

/** Они стоят между уроками и без них не нужны. Фокус, тест и другие свои блоки ученик ставил сам. */
const GOES_WITH_LESSONS = new Set(["lesson", "break", "rest"]);

function minutesOf(clock: string): number {
  const [hours, minutes] = clock.split(":").map(Number);
  return hours * 60 + minutes;
}

const overlaps = (left: TemplateLessonSlot, right: TemplateLessonSlot) =>
  minutesOf(left.startTime) < minutesOf(right.endTime) && minutesOf(right.startTime) < minutesOf(left.endTime);

/**
 * Расписание с новыми уроками. Меняются только названные дни. Номер урока это его место в дне:
 * так считает и редактор расписания, поэтому в этих днях нумеруем заново.
 */
export function mergeTimetable(
  before: TemplateLessonSlot[],
  lessons: TimetableLesson[],
  clearWeekdays: number[],
  subjectIdOf: (name: string) => string,
  newId: () => string,
): TemplateLessonSlot[] {
  const fresh = lessons.map(
    (lesson): TemplateLessonSlot => ({
      id: newId(),
      dayOfWeek: DAYS_ORDER[lesson.weekday],
      lessonNumber: 0,
      startTime: lesson.start,
      endTime: lesson.end,
      subjectId: subjectIdOf(lesson.subject),
      blockType: "lesson",
      label: "",
    }),
  );
  const touched = new Set([...fresh.map((slot) => slot.dayOfWeek), ...clearWeekdays.map((day) => DAYS_ORDER[day])]);
  const kept = before.filter((slot) => {
    if (!touched.has(slot.dayOfWeek)) return true;
    if (GOES_WITH_LESSONS.has(slot.blockType ?? "lesson")) return false;
    return !fresh.some((lesson) => lesson.dayOfWeek === slot.dayOfWeek && overlaps(lesson, slot));
  });
  const untouched = kept.filter((slot) => !touched.has(slot.dayOfWeek));
  const renumbered = Array.from(touched).flatMap((day) =>
    [...fresh, ...kept]
      .filter((slot) => slot.dayOfWeek === day)
      .sort((left, right) => minutesOf(left.startTime) - minutesOf(right.startTime))
      .map((slot, index) => ({ ...slot, lessonNumber: index + 1 })),
  );
  return [...renumbered, ...untouched];
}

function slotKey(slot: TemplateLessonSlot): string {
  return [
    slot.dayOfWeek,
    slot.lessonNumber,
    slot.startTime,
    slot.endTime,
    slot.subjectId ?? "",
    slot.blockType ?? "lesson",
    slot.label ?? "",
  ].join("|");
}

/** То же расписание? Порядок и идентификаторы строк значения не имеют. */
export function sameSlots(left: TemplateLessonSlot[], right: TemplateLessonSlot[]): boolean {
  const keys = (slots: TemplateLessonSlot[]) => slots.map(slotKey).sort().join("\n");
  return left.length === right.length && keys(left) === keys(right);
}
