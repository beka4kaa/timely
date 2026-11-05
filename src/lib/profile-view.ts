// Что профиль считает из настоящих данных: дни, серии, год занятий, часы и бейджи.
// Здесь нет React и нет сети, поэтому всё проверяется тестами.

import type { Contest, Submission } from "./contest-api";
import { contestResult, ru, shortDate } from "./contest-view";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Ключ локального дня `YYYY-MM-DD`, как в сводке помодоро. */
export function dayKeyOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Номер дня: разница двух номеров равна числу дней и не зависит от перевода часов. */
function dayNumber(key: string): number {
  const [year, month, day] = key.split("-").map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

export interface HabitCalendar {
  calendar: ReadonlyArray<{ date: string; done: boolean }>;
}

export interface DayActivity {
  seconds: number;
  habit: boolean;
}

/** День занятий это день с фокусом или с отмеченной привычкой. */
export function mergeActivity(
  daily: Readonly<Record<string, number>>,
  habits: readonly HabitCalendar[],
): Map<string, DayActivity> {
  const days = new Map<string, DayActivity>();
  for (const [key, seconds] of Object.entries(daily)) {
    if (seconds > 0) days.set(key, { seconds, habit: false });
  }
  for (const habit of habits) {
    for (const row of habit.calendar) {
      if (!row.done) continue;
      const day = days.get(row.date);
      if (day) day.habit = true;
      else days.set(row.date, { seconds: 0, habit: true });
    }
  }
  return days;
}

export interface Streaks {
  /** Текущая серия: заканчивается сегодня или вчера, сегодняшний день ещё не прошёл. */
  current: number;
  best: number;
  total: number;
}

export function streaksOf(days: Iterable<string>, today: Date): Streaks {
  const numbers = Array.from(new Set(Array.from(days, dayNumber))).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  numbers.forEach((value, index) => {
    run = index > 0 && value - numbers[index - 1] === 1 ? run + 1 : 1;
    best = Math.max(best, run);
  });
  const todayNumber = dayNumber(dayKeyOf(today));
  let current = 0;
  if (numbers.length) {
    let cursor = numbers[numbers.length - 1];
    if (cursor === todayNumber || cursor === todayNumber - 1) {
      for (let index = numbers.length - 1; index >= 0 && numbers[index] === cursor; index -= 1) {
        current += 1;
        cursor -= 1;
      }
    }
  }
  return { current, best, total: numbers.length };
}

export interface HeatCell {
  key: string;
  level: 0 | 1 | 2 | 3 | 4;
  today: boolean;
  future: boolean;
  title: string;
}

function levelOf(day: DayActivity | undefined): HeatCell["level"] {
  if (!day) return 0;
  const minutes = day.seconds / 60;
  if (minutes >= 120) return 4;
  if (minutes >= 60) return 3;
  if (minutes >= 20) return 2;
  return 1;
}

/** Год по неделям: столбец начинается с понедельника, последний столбец это эта неделя. */
export function heatCells(
  activity: ReadonlyMap<string, DayActivity>,
  today: Date,
  weeks = 52,
): HeatCell[] {
  const format = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
  const todayKey = dayKeyOf(today);
  const fromMonday = (today.getDay() + 6) % 7;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - fromMonday - (weeks - 1) * 7);
  const cells: HeatCell[] = [];
  for (let index = 0; index < weeks * 7; index += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const key = dayKeyOf(date);
    const future = key > todayKey;
    const day = future ? undefined : activity.get(key);
    let note = "";
    if (day?.seconds) note = `: ${Math.max(1, Math.round(day.seconds / 60))} мин фокуса`;
    else if (day?.habit) note = ": привычки";
    cells.push({
      key,
      level: levelOf(day),
      today: key === todayKey,
      future,
      title: future ? "" : `${format.format(date)}${note}`,
    });
  }
  return cells;
}

export interface WeekBar {
  seconds: number;
  /** Высота столбика от самой длинной недели, в процентах. */
  height: number;
  now: boolean;
  monday: Date;
}

export function weekBars(
  daily: Readonly<Record<string, number>>,
  today: Date,
  weeks = 12,
): WeekBar[] {
  const fromMonday = (today.getDay() + 6) % 7;
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - fromMonday);
  const bars: WeekBar[] = [];
  for (let back = weeks - 1; back >= 0; back -= 1) {
    const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - back * 7);
    let seconds = 0;
    for (let index = 0; index < 7; index += 1) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
      seconds += daily[dayKeyOf(date)] ?? 0;
    }
    bars.push({ seconds, height: 0, now: back === 0, monday: start });
  }
  const longest = Math.max(...bars.map((bar) => bar.seconds), 1);
  return bars.map((bar) => ({ ...bar, height: Math.round((bar.seconds / longest) * 100) }));
}

/** Подписи под столбиками: первый месяц, средний и последний, без повторов. */
export function monthAxis(bars: readonly WeekBar[]): string[] {
  if (!bars.length) return [];
  const format = new Intl.DateTimeFormat("ru-RU", { month: "long" });
  const picks = [bars[0], bars[Math.floor(bars.length / 2)], bars[bars.length - 1]];
  return Array.from(new Set(picks.map((bar) => format.format(bar.monday))));
}

/** «2 ч 15 мин», «45 мин». */
export function hoursAndMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} мин`;
  return rest ? `${hours} ч ${rest} мин` : `${hours} ч`;
}

/** Часы для счётчика: «64» или «2,5». Меньше шести минут счётчиком не считается. */
export function hoursStat(seconds: number): { value: string; label: string } | null {
  const hours = seconds / 3600;
  if (hours < 0.1) return null;
  if (hours >= 10) {
    const whole = Math.round(hours);
    return { value: String(whole), label: `${ru(whole, "час", "часа", "часов")} в фокусе` };
  }
  const tenth = Math.round(hours * 10) / 10;
  if (Number.isInteger(tenth)) return { value: String(tenth), label: `${ru(tenth, "час", "часа", "часов")} в фокусе` };
  return { value: String(tenth).replace(".", ","), label: "часа в фокусе" };
}

/** Принятые решения, по одному на задачу, самые свежие сверху. */
export function solvedTasks(submissions: readonly Submission[]): Submission[] {
  const byTask = new Map<number, Submission>();
  for (const row of submissions) {
    if (row.status !== "approved") continue;
    const seen = byTask.get(row.task);
    if (!seen || at(row) > at(seen)) byTask.set(row.task, row);
  }
  return Array.from(byTask.values()).sort((a, b) => at(b) - at(a));
}

function at(row: Submission): number {
  return new Date(row.reviewed_at ?? row.created_at).getTime();
}

// ── Бейджи ───────────────────────────────────────────────────────────────────

export type BadgeShape = "hex" | "seal" | "circle" | "shield" | "squircle" | "star" | "diamond" | "penta";

export interface Badge {
  key: string;
  shape: BadgeShape;
  from: string;
  to: string;
  glyph: string;
  size: number;
  kind: "" | "math" | "dark";
  name: string;
  /** За что дан или что для него нужно: подсказка под курсором. */
  how: string;
  earned: boolean;
}

export interface BadgeTopic {
  name: string;
  status: string;
  subject_name: string | null;
  last_revised_at: string | null;
  archived?: boolean;
}

export interface BadgeMaterial {
  title: string;
  total_units: number;
  completed_units: number;
}

export interface BadgeCourse {
  subject: string;
  percent: number | null;
}

export interface BadgeInput {
  activeDays: Iterable<string>;
  daily: Readonly<Record<string, number>>;
  submissions: readonly Submission[];
  contests: readonly Contest[];
  topics: readonly BadgeTopic[];
  materials: readonly BadgeMaterial[];
  courses: readonly BadgeCourse[];
}

/** В какой день серия дошла до `length`. */
function streakReached(days: readonly string[], length: number): string | null {
  let run = 0;
  for (let index = 0; index < days.length; index += 1) {
    run = index > 0 && dayNumber(days[index]) - dayNumber(days[index - 1]) === 1 ? run + 1 : 1;
    if (run >= length) return days[index];
  }
  return null;
}

/** В какой день сумма фокуса дошла до `seconds`. */
function focusReached(daily: Readonly<Record<string, number>>, seconds: number): string | null {
  let sum = 0;
  for (const key of Object.keys(daily).sort()) {
    sum += daily[key];
    if (sum >= seconds) return key;
  }
  return null;
}

/** Когда за семь дней подряд набралось `points` баллов. */
function pointsWeekReached(submissions: readonly Submission[], points: number): string | null {
  const approved = submissions
    .filter((row) => row.status === "approved" && row.reviewed_at)
    .sort((a, b) => at(a) - at(b));
  for (let end = 0; end < approved.length; end += 1) {
    let sum = 0;
    for (let index = end; index >= 0 && at(approved[end]) - at(approved[index]) < 7 * DAY_MS; index -= 1) {
      sum += approved[index].task_points;
    }
    if (sum >= points) return approved[end].reviewed_at;
  }
  return null;
}

const MASTERED = new Set(["SUCCESS", "MASTERED"]);

/** Значок темы идёт от её предмета. */
function topicGlyph(subject: string | null): { glyph: string; size: number } {
  if (/физик|механик/i.test(subject ?? "")) return { glyph: "F=ma", size: 14 };
  if (/хими/i.test(subject ?? "")) return { glyph: "H₂O", size: 15 };
  return { glyph: "x²", size: 25 };
}

export function computeBadges(input: BadgeInput): Badge[] {
  const days = Array.from(new Set(input.activeDays)).sort();
  const week = streakReached(days, 7);
  const month = days.length >= 30 ? days[29] : null;
  const focus = focusReached(input.daily, 10 * 3600);
  const hundred = pointsWeekReached(input.submissions, 100);
  const contest = [...input.contests]
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    .find((row) => contestResult(row, input.submissions).tookPart);
  const mastered = input.topics.filter((topic) => !topic.archived && MASTERED.has(topic.status));
  const firstTopic = mastered[0];
  const topicArt = topicGlyph(firstTopic?.subject_name ?? null);
  const finished =
    input.materials.find((row) => row.total_units > 0 && row.completed_units >= row.total_units)?.title ??
    input.courses.find((course) => course.percent === 100)?.subject ??
    null;

  return [
    {
      key: "week",
      shape: "hex",
      from: "#ff9a3d",
      to: "#f4432f",
      glyph: "7",
      size: 25,
      kind: "",
      name: "Неделя подряд",
      how: week ? `7 дней занятий подряд, ${shortDate(`${week}T12:00:00`)}` : "Занимайся 7 дней подряд",
      earned: Boolean(week),
    },
    {
      key: "month",
      shape: "seal",
      from: "#ff78b6",
      to: "#b92fd0",
      glyph: "30",
      size: 23,
      kind: "",
      name: "30 дней занятий",
      how: month ? `Тридцатый день занятий, ${shortDate(`${month}T12:00:00`)}` : "Набери 30 дней занятий",
      earned: Boolean(month),
    },
    {
      key: "focus",
      shape: "circle",
      from: "#8476ff",
      to: "#3f2fd1",
      glyph: "10",
      size: 23,
      kind: "",
      name: "10 часов фокуса",
      how: focus ? `10 часов в фокусе, ${shortDate(`${focus}T12:00:00`)}` : "Набери 10 часов в помодоро",
      earned: Boolean(focus),
    },
    {
      key: "topic",
      shape: "shield",
      from: "#ff7d7d",
      to: "#d82b5e",
      glyph: topicArt.glyph,
      size: topicArt.size,
      kind: "math",
      name: "Тема усвоена",
      how: firstTopic ? firstTopic.name : "Усвой первую тему в «Слабых темах»",
      earned: Boolean(firstTopic),
    },
    {
      key: "topics",
      shape: "squircle",
      from: "#3fc8ff",
      to: "#2b66f5",
      glyph: "5",
      size: 25,
      kind: "",
      name: "Пять тем",
      how: mastered.length >= 5 ? `Усвоено тем: ${mastered.length}` : "Усвой пять тем",
      earned: mastered.length >= 5,
    },
    {
      key: "contest",
      shape: "star",
      from: "#ffd54f",
      to: "#ff9f1c",
      glyph: "№1",
      size: 15,
      kind: "dark",
      name: "Первый контест",
      how: contest ? `${contest.title}, ${shortDate(contest.start_time)}` : "Участвуй в контесте",
      earned: Boolean(contest),
    },
    {
      key: "points",
      shape: "diamond",
      from: "#43e3a4",
      to: "#07a07a",
      glyph: "+100",
      size: 14,
      kind: "",
      name: "Сотня баллов",
      how: hundred ? `100 баллов за неделю, ${shortDate(hundred)}` : "Набери 100 баллов за неделю",
      earned: Boolean(hundred),
    },
    {
      key: "finished",
      shape: "penta",
      from: "#bbe64c",
      to: "#57b137",
      glyph: "§",
      size: 25,
      kind: "math",
      name: "Курс пройден",
      how: finished ?? "Пройди курс или материал до конца",
      earned: Boolean(finished),
    },
  ];
}
