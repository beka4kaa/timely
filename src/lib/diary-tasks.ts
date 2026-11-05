// Дневник как список «что задано»: неделя → дни сдачи → задания.
//
// Задание записывают в строку того урока, к которому его надо сдать (как в бумажном
// дневнике), поэтому день задания — это день урока, а не день, когда его выдали.
//
// Модуль без React и без запросов, поэтому покрыт тестами (`diary-tasks.test.ts`).
// Импорты с «.ts» — ради `node --test` без сборщика.

import {
  dayMonthLabel,
  daysBetween,
  isClassRow,
  lessonTitle,
  parseClock,
  weekdayLabel,
} from "./now-feed.ts";
import { shiftDateKey, weekdayOf } from "./studyplan-calendar.ts";
import {
  isFeynmanBlock,
  isLessonBlock,
  isTestBlock,
  type DiaryDay,
  type DiaryLesson,
  type DiaryWeek,
  type LessonGrades,
} from "../types/diary.ts";

// ──────────────────────────────── Даты ───────────────────────────────────────

/**
 * Сегодняшняя дата по часам ученика.
 *
 * Не `toISOString()`: та отдаёт дату по UTC, и в Бишкеке до шести утра дневник
 * открывался бы на вчерашнем дне, а в понедельник утром на прошлой неделе.
 */
export function localDateKey(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${String(date.getFullYear()).padStart(4, "0")}-${month}-${day}`;
}

export function mondayOf(dateKey: string): string {
  return shiftDateKey(dateKey, -weekdayOf(dateKey));
}

/**
 * Какую неделю открыть первой. В воскресенье текущая уже закончилась, и «что
 * задано на завтра» лежит в следующей.
 */
export function defaultWeekStart(today: string): string {
  const monday = mondayOf(today);
  return weekdayOf(today) === 6 ? shiftDateKey(monday, 7) : monday;
}

/** «2–8 ноября», а на стыке месяцев «30 ноября – 6 декабря». */
export function weekRangeLabel(weekStart: string): string {
  const [startDay, startMonth] = dayMonthLabel(weekStart).split(/\s/);
  const [endDay, endMonth] = dayMonthLabel(shiftDateKey(weekStart, 6)).split(/\s/);
  return startMonth === endMonth
    ? `${startDay}–${endDay} ${endMonth}`
    : `${startDay} ${startMonth} – ${endDay} ${endMonth}`;
}

// ────────────────────────────── Задания ──────────────────────────────────────

export function taskText(lesson: Pick<DiaryLesson, "homework">): string {
  return (lesson.homework ?? "").trim();
}

/** В списке задания дня: строки с текстом и контрольные, даже если текста ещё нет. */
export function isTask(lesson: Pick<DiaryLesson, "homework" | "blockType">): boolean {
  return Boolean(taskText(lesson)) || isTestBlock(lesson.blockType);
}

function byStart(left: DiaryLesson, right: DiaryLesson): number {
  return (
    (parseClock(left.startTime) ?? 0) - (parseClock(right.startTime) ?? 0) ||
    left.lessonNumber - right.lessonNumber
  );
}

export function tasksOfDay(day: Pick<DiaryDay, "lessons">): DiaryLesson[] {
  return day.lessons.filter(isTask).sort(byStart);
}

/** Уроки дня по порядку, без перемен: их показывает карточка «Сегодня в школе». */
export function classesOfDay(day: Pick<DiaryDay, "lessons">): DiaryLesson[] {
  return day.lessons.filter(isClassRow).sort(byStart);
}

/** Уроки, в которые ещё можно записать задание: у одного урока один текст. */
export function freeClasses(day: Pick<DiaryDay, "lessons">): DiaryLesson[] {
  return classesOfDay(day).filter((lesson) => !taskText(lesson));
}

/** «Физика: §10, вопросы 1–3». Подпись для мини-окна и название блока в плане. */
export function taskTitle(
  lesson: Pick<DiaryLesson, "blockType" | "blockLabel" | "subjectName" | "homework">,
): string {
  const subject = lessonTitle(lesson);
  const text = taskText(lesson);
  return text ? `${subject}: ${text}` : subject;
}

// Отдельным регулярным выражением в строке: литерал с флагом `u` не проходит при
// target=es5, а lookbehind ломает страницу на iOS до 16.4. Сокращения сравниваются
// с учётом регистра: «сор» строчными это просто мусор, а не контрольная.
const TEST_WORD = new RegExp(
  "(^|[^\\p{L}\\p{N}])(" +
    [
      "СОР",
      "СОЧ",
      "БЖБ",
      "ТЖБ",
      "ЕНТ",
      "ОГЭ",
      "ЕГЭ",
      "[Кк]/[Рр]",
      "[Сс]/[Рр]",
      "[Кк]онтрольн\\p{L}*",
      "[Сс]амостоятельн(?:ая|ую|ой)",
      "[Тт]ест(?:а|у|ом|е|ы|ов|ам|ами|ах)?",
      "[Зз]ач[её]т\\p{L}*",
      "[Дд]иктант\\p{L}*",
      "[Ээ]кзамен\\p{L}*",
    ].join("|") +
    ")(?![\\p{L}\\p{N}])",
  "gu",
);

export interface TextPart {
  text: string;
  test: boolean;
}

/** Разбивает текст задания так, чтобы слова про контрольную можно было выделить. */
export function splitTestWords(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const pattern = new RegExp(TEST_WORD.source, TEST_WORD.flags);
  let cursor = 0;
  let match = pattern.exec(text);
  while (match) {
    const start = match.index + match[1].length;
    if (start > cursor) parts.push({ text: text.slice(cursor, start), test: false });
    parts.push({ text: match[2], test: true });
    cursor = start + match[2].length;
    if (pattern.lastIndex <= match.index) pattern.lastIndex = match.index + 1;
    match = pattern.exec(text);
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), test: false });
  return parts;
}

// ────────────────────────────── Группы ───────────────────────────────────────

const WEEKDAYS_ACCUSATIVE = [
  "понедельник",
  "вторник",
  "среду",
  "четверг",
  "пятницу",
  "субботу",
  "воскресенье",
];

export interface DayGroup {
  day: DiaryDay;
  /** Задания этой группы. Сегодняшние могут разойтись по двум группам. */
  tasks: DiaryLesson[];
  title: string;
  when: string;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function upcomingGroup(day: DiaryDay, tasks: DiaryLesson[], today: string): DayGroup {
  const distance = daysBetween(today, day.date);
  if (distance === 0) {
    return { day, tasks, title: "На сегодня", when: `${weekdayLabel(day.date)}, ${dayMonthLabel(day.date)}` };
  }
  if (distance === 1) {
    return { day, tasks, title: "На завтра", when: `${weekdayLabel(day.date)}, ${dayMonthLabel(day.date)}` };
  }
  return { day, tasks, title: `На ${WEEKDAYS_ACCUSATIVE[weekdayOf(day.date)]}`, when: dayMonthLabel(day.date) };
}

function pastGroup(day: DiaryDay, tasks: DiaryLesson[], today: string): DayGroup {
  const title = day.date === today ? "Сегодня" : capitalize(weekdayLabel(day.date));
  return { day, tasks, title, when: dayMonthLabel(day.date) };
}

export interface WeekTasks {
  /** Что ещё предстоит сдать. */
  upcoming: DayGroup[];
  /** Что уже прошло. У прошлой недели здесь все дни. */
  past: DayGroup[];
}

/**
 * Раскладывает неделю по дням сдачи.
 *
 * Сегодняшнее задание считается предстоящим, только пока его урок не начался: после
 * этого делать его уже поздно. Правило то же, что у тестов на главной.
 *
 * Впереди показываем и дни без заданий: в них есть куда записать. Прошедшие дни без
 * заданий в списке ни к чему, а записать в такой день можно из окна урока сбоку.
 */
export function groupWeek(
  week: Pick<DiaryWeek, "days">,
  today: string,
  nowMinutes: number,
): WeekTasks {
  const upcoming: DayGroup[] = [];
  const past: DayGroup[] = [];
  const days = [...week.days].sort((left, right) => left.date.localeCompare(right.date));

  for (const day of days) {
    const tasks = tasksOfDay(day);
    const classes = classesOfDay(day);
    if (!tasks.length && !classes.length) continue;

    const distance = daysBetween(today, day.date);
    if (distance > 0) {
      upcoming.push(upcomingGroup(day, tasks, today));
    } else if (distance < 0) {
      if (tasks.length) past.push(pastGroup(day, tasks, today));
    } else {
      const notStarted = (lesson: DiaryLesson) => (parseClock(lesson.startTime) ?? 0) > nowMinutes;
      const live = tasks.filter(notStarted);
      const over = tasks.filter((lesson) => !notStarted(lesson));
      if (live.length || classes.some(notStarted)) upcoming.push(upcomingGroup(day, live, today));
      if (over.length) past.push(pastGroup(day, over, today));
    }
  }
  return { upcoming, past };
}

export function taskCount(groups: DayGroup[]): number {
  return groups.reduce((sum, group) => sum + group.tasks.length, 0);
}

// ────────────────────────────── Оценки ───────────────────────────────────────

/** Какое поле оценки у этой строки. У блоков без оценки — `null`. */
export function gradeField(lesson: Pick<DiaryLesson, "blockType">): keyof LessonGrades | null {
  if (isLessonBlock(lesson.blockType)) return "exercises";
  if (isFeynmanBlock(lesson.blockType)) return "retelling";
  if (isTestBlock(lesson.blockType)) return "test";
  return null;
}
