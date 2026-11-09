// Школьный день для календаря недели: уроки дневника одним блоком от первого урока до
// последнего. Без React и без запросов, импорты с «.ts»: ради `node --test`.

import type { DiaryWeek } from "@/types/diary";

import { classesOfDay, taskText } from "./diary-tasks.ts";
import { lessonGrade, lessonTitle, parseClock } from "./now-feed.ts";
import { subjectColor } from "./subject-color.ts";

export interface SchoolLesson {
  dayId: string;
  lessonId: string;
  title: string;
  start: string;
  end: string;
  color: string;
  /** Задание урока: нет, ждёт или сделано. */
  task: "none" | "open" | "done";
  grade: number | null;
}

export interface SchoolDay {
  dateKey: string;
  startMinutes: number;
  endMinutes: number;
  lessons: SchoolLesson[];
}

export function schoolDays(week: DiaryWeek | null | undefined, dateKeys: readonly string[]): SchoolDay[] {
  if (!week) return [];
  const visible = new Set(dateKeys);
  const days: SchoolDay[] = [];
  for (const day of week.days) {
    if (!visible.has(day.date)) continue;
    const lessons = classesOfDay(day);
    const starts = lessons.map((lesson) => parseClock(lesson.startTime)).filter((value): value is number => value !== null);
    const ends = lessons.map((lesson) => parseClock(lesson.endTime)).filter((value): value is number => value !== null);
    if (!starts.length || !ends.length) continue;
    const startMinutes = Math.min(...starts);
    const endMinutes = Math.max(...ends);
    if (endMinutes <= startMinutes) continue;
    days.push({
      dateKey: day.date,
      startMinutes,
      endMinutes,
      lessons: lessons.map((lesson) => {
        const title = lessonTitle(lesson);
        return {
          dayId: day.id,
          lessonId: lesson.id,
          title,
          start: lesson.startTime,
          end: lesson.endTime,
          color: subjectColor(title, lesson.subjectColor),
          task: taskText(lesson) ? (lesson.homeworkDone ? "done" : "open") : "none",
          grade: lessonGrade(lesson),
        };
      }),
    });
  }
  return days.sort((left, right) => left.dateKey.localeCompare(right.dateKey));
}
