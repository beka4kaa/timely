// Лента дня для главной «Сейчас»: что уже было, что идёт, что дальше.
//
// Дневник, план и занятое время живут в разных моделях и считают время
// по-разному: уроки — строками «08:45», блоки плана — UTC-моментами. Здесь они
// становятся одной осью «минуты от полуночи» в зоне ученика, и из неё
// собирается то, что рисует главная: свёрнутое прошлое, линия «сейчас»,
// карточка текущего шага и всё, что после неё.
//
// Модуль без React и без запросов — чистые функции, поэтому покрыт тестами
// (`now-feed.test.ts`). Импорты с «.ts» — ради `node --test` без сборщика.

import type { CalendarLearningBlock, ScheduleRevision } from "./studyplan-api.ts";
import {
  formatMinutes,
  shiftDateKey,
  weekdayOf,
  zonedDateKey,
  zonedMinutes,
} from "./studyplan-calendar.ts";
import { durationLabel } from "./studyplan-visuals.ts";
import {
  isFeynmanBlock,
  isLessonBlock,
  isTestBlock,
  type DiaryLesson,
} from "../types/diary.ts";

// ───────────────────────────── Слова и числа ─────────────────────────────────

/** «1 занятие», «3 занятия», «5 занятий». */
export function plural(count: number, forms: [string, string, string]): string {
  const mod100 = Math.abs(count) % 100;
  const mod10 = mod100 % 10;
  if (mod100 >= 11 && mod100 <= 14) return forms[2];
  if (mod10 === 1) return forms[0];
  if (mod10 >= 2 && mod10 <= 4) return forms[1];
  return forms[2];
}

const WEEKDAYS = [
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
  "воскресенье",
];
const WEEKDAYS_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];
const MONTHS_SHORT = [
  "янв.",
  "февр.",
  "марта",
  "апр.",
  "мая",
  "июня",
  "июля",
  "авг.",
  "сент.",
  "окт.",
  "нояб.",
  "дек.",
];

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Неразрывные пробелы: «4 оценки», «1 ч 15 мин» не рвутся между строками. */
export function nbsp(text: string): string {
  return text.replace(/ /g, "\u00a0");
}

function dayNumber(dateKey: string): number {
  return Number(dateKey.split("-")[2]);
}

function monthIndex(dateKey: string): number {
  return Number(dateKey.split("-")[1]) - 1;
}

/** «Вторник, 3 ноября». */
export function longDateLabel(dateKey: string): string {
  return `${capitalize(WEEKDAYS[weekdayOf(dateKey)])}, ${dayNumber(dateKey)} ${
    MONTHS[monthIndex(dateKey)]
  }`;
}

/** «Вт, 3 ноября» — для узкой шапки. */
export function shortDateLabel(dateKey: string): string {
  return `${capitalize(WEEKDAYS_SHORT[weekdayOf(dateKey)])}, ${dayNumber(dateKey)} ${
    MONTHS[monthIndex(dateKey)]
  }`;
}

export function weekdayShortLabel(dateKey: string): string {
  return WEEKDAYS_SHORT[weekdayOf(dateKey)];
}

export function weekdayLabel(dateKey: string): string {
  return WEEKDAYS[weekdayOf(dateKey)];
}

/** «3 ноября». */
export function dayMonthLabel(dateKey: string): string {
  return `${dayNumber(dateKey)} ${MONTHS[monthIndex(dateKey)]}`;
}

/** «4 нояб.» — на полях ленты места на полную дату нет. */
export function dayShortLabel(dateKey: string): string {
  return `${dayNumber(dateKey)}\u00a0${MONTHS_SHORT[monthIndex(dateKey)]}`;
}

const WEEKDAYS_ON = [
  "в понедельник",
  "во вторник",
  "в среду",
  "в четверг",
  "в пятницу",
  "в субботу",
  "в воскресенье",
];

const WEEKDAYS_ACCUSATIVE = [
  "понедельник",
  "вторник",
  "среду",
  "четверг",
  "пятницу",
  "субботу",
  "воскресенье",
];

/** «Д/З на завтра», «Д/З на понедельник», «Д/З на среду». */
export function homeworkTitle(dateKey: string, todayKey: string): string {
  if (daysBetween(todayKey, dateKey) === 1) return "Д/З на завтра";
  return `Д/З на ${WEEKDAYS_ACCUSATIVE[weekdayOf(dateKey)]}`;
}

/**
 * День внутри фразы: «сегодня», «завтра», «в пятницу», «12 ноября».
 *
 * Голое «пт» годится для полей ленты, но не для предложения: «Дальше — пт в
 * 17:00» читается как опечатка.
 */
export function dayPhrase(dateKey: string, todayKey: string): string {
  const distance = daysBetween(todayKey, dateKey);
  if (distance === 0) return "сегодня";
  if (distance === 1) return "завтра";
  if (distance > 1 && distance < 7) return WEEKDAYS_ON[weekdayOf(dateKey)];
  return dayMonthLabel(dateKey);
}

/**
 * День относительно сегодняшнего: «сегодня», «завтра», «вчера», «в пт».
 * Дальше недели — дата: «12 нояб.».
 */
export function relativeDayLabel(dateKey: string, todayKey: string): string {
  if (dateKey === todayKey) return "сегодня";
  if (dateKey === shiftDateKey(todayKey, 1)) return "завтра";
  if (dateKey === shiftDateKey(todayKey, -1)) return "вчера";
  const distance = daysBetween(todayKey, dateKey);
  if (Math.abs(distance) < 7) return WEEKDAYS_SHORT[weekdayOf(dateKey)];
  return `${dayNumber(dateKey)} ${MONTHS_SHORT[monthIndex(dateKey)]}`;
}

/** Сколько суток от `from` до `to` (может быть отрицательным). */
export function daysBetween(from: string, to: string): number {
  const toUtc = (key: string) => {
    const [year, month, day] = key.split("-").map(Number);
    return Date.UTC(year, (month ?? 1) - 1, day ?? 1);
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

/** «сегодня, 15:58», «вчера, 21:14», «пн, 19:40», «30 окт.». */
export function relativeStamp(iso: string, now: Date, timeZone: string): string {
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return "";
  const dateKey = zonedDateKey(moment, timeZone);
  const todayKey = zonedDateKey(now, timeZone);
  const day = relativeDayLabel(dateKey, todayKey);
  const distance = daysBetween(dateKey, todayKey);
  if (distance >= 7 || distance < 0) return day;
  return `${day}, ${formatMinutes(zonedMinutes(moment, timeZone))}`;
}

/** «через 33 мин», «через 1 ч 5 мин». */
export function untilLabel(minutes: number): string {
  if (minutes <= 0) return "сейчас";
  return `через ${durationLabel(minutes)}`;
}

/** Приветствие по часу: «Доброе утро», «Добрый день». */
export function greetingFor(hour: number): string {
  if (hour < 5) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  if (hour < 17) return "Добрый день";
  return "Добрый вечер";
}

/** Имя для приветствия: первое слово полного имени. */
export function firstName(fullName: string | null | undefined): string {
  return (fullName ?? "").trim().split(/\s+/)[0] ?? "";
}

/**
 * Критерий готовности — как его написал план, только без точки в конце.
 *
 * Вклеивать его во фразу «Готово, когда…» нельзя: планировщик пишет критерии
 * в третьем лице без подлежащего («Решает 3 задачи…»), и выходило «Готово,
 * когда решает» — без того, кто решает. Поэтому на карточке он стоит после
 * подписи «Критерий:», целым предложением.
 */
export function criterionText(text: string): string {
  return text.trim().replace(/\.$/, "");
}

// ──────────────────────────────── Блоки ──────────────────────────────────────

/** Хвосты названий, которые генератор плана ставит после темы. */
const TITLE_DETAILS =
  /^(теория|разбор примера|практика с разбором|практика|самостоятельная практика|проверка|повторение|чтение|домашняя работа|проект|код|задача на бумаге)(\s+\d+\/\d+)?$/i;

/**
 * «Равноускоренное движение — практика с разбором»
 *   → { topic: «Равноускоренное движение», detail: «практика с разбором» }.
 *
 * Название занятия генерирует план, и вид занятия в нём повторяет то, что уже
 * сказано подписью «Практика с разбором». На карточке тема — заголовок, а вид
 * — строчка над ним. Нераспознанный хвост не отрезается: «Глава 2 — Динамика»
 * остаётся целиком.
 */
export function splitBlockTitle(title: string): { topic: string; detail: string } {
  const clean = title.trim();
  const index = clean.lastIndexOf(" — ");
  if (index > 0) {
    const detail = clean.slice(index + 3).trim();
    if (TITLE_DETAILS.test(detail)) {
      return { topic: clean.slice(0, index).trim(), detail };
    }
  }
  return { topic: clean, detail: "" };
}

/** Часть разбитого занятия из хвоста «практика 1/2» — «часть 1 из 2». */
export function partLabel(detail: string): string {
  const match = detail.match(/(\d+)\/(\d+)$/);
  return match ? `часть ${match[1]} из ${match[2]}` : "";
}

/** Блоки, которых в дне больше нет: их перенесли или отменили. */
const GONE_STATUSES = new Set(["cancelled", "rescheduled"]);

/** Что ещё можно сделать: блок не закрыт и не пропущен намеренно. */
const OPEN_STATUSES = new Set(["scheduled", "ready", "in_progress", "paused", "missed"]);

export function isOpenBlock(block: { status: string }): boolean {
  return OPEN_STATUSES.has(block.status);
}

export interface Span {
  start: number;
  end: number;
}

/** Минуты блока в зоне ученика. Конец не уходит за полночь: лента — про один день. */
export function blockSpan(
  block: { start_at: string; duration_minutes: number },
  timeZone: string,
): Span {
  const start = zonedMinutes(block.start_at, timeZone);
  return { start, end: Math.min(start + Math.max(0, block.duration_minutes), 24 * 60) };
}

/** «08:45» → 525. Не время — `null`. */
export function parseClock(value: string | null | undefined): number | null {
  const match = (value ?? "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59) return null;
  return hours * 60 + minutes;
}

// ──────────────────────────────── Школа ──────────────────────────────────────

/** Строки дневника, которые не уроки: перемены и самостоятельные окна. */
const NOT_CLASS = new Set(["break", "rest", "focus"]);

export function isClassRow(lesson: Pick<DiaryLesson, "blockType">): boolean {
  return !NOT_CLASS.has(lesson.blockType ?? "lesson");
}

/** Оценка строки: у урока — за упражнения, у Фейнмана — за пересказ, у теста — за тест. */
export function lessonGrade(lesson: Pick<DiaryLesson, "grades" | "blockType">): number | null {
  const grades = lesson.grades ?? { exercises: null, retelling: null, test: null };
  if (isLessonBlock(lesson.blockType)) return grades.exercises ?? null;
  if (isFeynmanBlock(lesson.blockType)) return grades.retelling ?? null;
  return grades.test ?? null;
}

/** Подпись строки дневника: предмет у урока, своё имя у теста и прочих блоков. */
export function lessonTitle(lesson: Pick<DiaryLesson, "blockType" | "blockLabel" | "subjectName">): string {
  const subject = (lesson.subjectName ?? "").trim();
  const usable = subject && subject !== "Предмет" ? subject : "";
  if (isLessonBlock(lesson.blockType)) return usable || "Урок";
  const label = (lesson.blockLabel ?? "").trim();
  if (label) return label;
  if (isTestBlock(lesson.blockType)) return usable ? `Тест: ${usable}` : "Тест";
  return usable || "Занятие";
}

export interface SchoolDay extends Span {
  /** Уроки по порядку, без перемен. */
  lessons: DiaryLesson[];
  /** Сколько уроков с оценкой. */
  graded: number;
  /** Урок, который идёт сейчас. */
  currentId: string | null;
}

export function schoolDay(lessons: DiaryLesson[], nowMinutes: number): SchoolDay | null {
  const rows = lessons
    .filter(isClassRow)
    .map((lesson) => ({
      lesson,
      start: parseClock(lesson.startTime),
      end: parseClock(lesson.endTime),
    }))
    .filter(
      (row): row is { lesson: DiaryLesson; start: number; end: number } =>
        row.start !== null && row.end !== null,
    )
    .sort((left, right) => left.start - right.start);
  if (!rows.length) return null;

  const current = rows.find((row) => row.start <= nowMinutes && nowMinutes < row.end);
  return {
    start: rows[0].start,
    end: Math.max(...rows.map((row) => row.end)),
    lessons: rows.map((row) => row.lesson),
    graded: rows.filter((row) => lessonGrade(row.lesson) !== null).length,
    currentId: current?.lesson.id ?? null,
  };
}

// ─────────────────────────────── Лента дня ───────────────────────────────────

/** Занятое время из «Плана»: секция, репетитор. Школа приходит из дневника. */
export interface BusyEntry extends Span {
  id: string;
  title: string;
  kind: string;
}

export type Phase = "past" | "current" | "future";

export type TimelineEntry =
  | ({ kind: "block"; block: CalendarLearningBlock; phase: Phase } & Span)
  | ({ kind: "busy"; busy: BusyEntry; phase: Phase } & Span)
  | ({ kind: "school"; school: SchoolDay; phase: Phase } & Span)
  | ({ kind: "free"; minutes: number } & Span);

/** Запись дня, у которой есть фаза: всё, кроме свободного окна. */
type PhasedEntry = Exclude<TimelineEntry, { kind: "free" }>;

export interface Hero extends Span {
  block: CalendarLearningBlock;
  /** `now` — блок идёт, `next` — ближайший впереди. */
  mode: "now" | "next";
  minutesLeft: number;
  minutesUntil: number;
  /** Доля прошедшего времени блока, 0…1. */
  progress: number;
}

export type DayState = "now" | "next" | "done" | "empty";

export interface DayModel {
  dateKey: string;
  nowMinutes: number;
  state: DayState;
  /** Всё, что закончилось, — по времени. На экране свёрнуто в одну строку. */
  past: TimelineEntry[];
  /** Что идёт прямо сейчас, кроме самого шага: урок, секция. */
  current: TimelineEntry[];
  /** Что начнётся раньше следующего шага. Бывает, только когда шаг ещё впереди. */
  beforeHero: TimelineEntry[];
  hero: Hero | null;
  /** Что впереди после шага, со свободными окнами между. */
  future: TimelineEntry[];
  school: SchoolDay | null;
  /** Занятия плана на сегодня (без отменённых и перенесённых). */
  blocks: CalendarLearningBlock[];
  plannedMinutes: number;
  pastBlocks: number;
}

export interface DayInput {
  now: Date;
  timeZone: string;
  /** Уроки дневника на сегодня. */
  lessons: DiaryLesson[];
  /** Блоки плана за любой диапазон: сегодняшние отбираются здесь. */
  blocks: CalendarLearningBlock[];
  busy?: BusyEntry[];
  /** Окно короче — не «свободно», а просто перерыв. */
  minFreeMinutes?: number;
}

function phaseOf(span: Span, nowMinutes: number): Phase {
  if (span.end <= nowMinutes) return "past";
  if (span.start <= nowMinutes) return "current";
  return "future";
}

export function buildDay(input: DayInput): DayModel {
  const { now, timeZone } = input;
  const dateKey = zonedDateKey(now, timeZone);
  const nowMinutes = zonedMinutes(now, timeZone);
  const minFree = input.minFreeMinutes ?? 45;

  const blocks = input.blocks
    .filter((block) => !GONE_STATUSES.has(block.status))
    .filter((block) => zonedDateKey(block.start_at, timeZone) === dateKey)
    .sort((left, right) => Date.parse(left.start_at) - Date.parse(right.start_at));

  const school = schoolDay(input.lessons, nowMinutes);

  const entries: PhasedEntry[] = [];
  for (const block of blocks) {
    const span = blockSpan(block, timeZone);
    entries.push({ kind: "block", block, phase: phaseOf(span, nowMinutes), ...span });
  }
  for (const busy of input.busy ?? []) {
    entries.push({ kind: "busy", busy, phase: phaseOf(busy, nowMinutes), start: busy.start, end: busy.end });
  }
  if (school) {
    entries.push({ kind: "school", school, phase: phaseOf(school, nowMinutes), start: school.start, end: school.end });
  }
  entries.sort((left, right) => left.start - right.start || left.end - right.end);

  // Шаг: идущий открытый блок, иначе ближайший впереди. Из двух идущих
  // одновременно — начавшийся позже: он и есть то, чем ученик занят сейчас.
  const running = entries.filter(
    (entry): entry is Extract<TimelineEntry, { kind: "block" }> =>
      entry.kind === "block" && entry.phase === "current" && isOpenBlock(entry.block),
  );
  const upcoming = entries.find(
    (entry): entry is Extract<TimelineEntry, { kind: "block" }> =>
      entry.kind === "block" && entry.phase === "future" && isOpenBlock(entry.block),
  );
  const heroEntry = running.length ? running[running.length - 1] : upcoming ?? null;

  let hero: Hero | null = null;
  if (heroEntry) {
    const length = Math.max(1, heroEntry.end - heroEntry.start);
    hero = {
      block: heroEntry.block,
      start: heroEntry.start,
      end: heroEntry.end,
      mode: heroEntry.phase === "current" ? "now" : "next",
      minutesLeft: Math.max(0, heroEntry.end - nowMinutes),
      minutesUntil: Math.max(0, heroEntry.start - nowMinutes),
      progress: Math.min(1, Math.max(0, (nowMinutes - heroEntry.start) / length)),
    };
  }

  const others = entries.filter((entry) => entry !== heroEntry);
  const past = others.filter((entry) => entry.phase === "past");
  const current = others.filter((entry) => entry.phase === "current");
  const later = others.filter((entry) => entry.phase === "future");

  // То, что начнётся раньше следующего шага (секция, утренняя школа), стоит
  // перед ним: лента идёт по времени, и шаг на 16:45 над секцией в 15:00
  // читался бы как «сначала шаг».
  const beforeHero =
    hero?.mode === "next" ? later.filter((entry) => entry.start < hero.start) : [];
  const afterHero = later.filter((entry) => !beforeHero.includes(entry));

  // Свободные окна — только после шага. До него время и так видно на самой
  // карточке («через 2 ч»), а без шага день уже закончился.
  const future: TimelineEntry[] = [];
  let cursor = hero ? hero.end : Number.POSITIVE_INFINITY;
  for (const entry of afterHero) {
    const gap = entry.start - cursor;
    if (gap >= minFree) {
      future.push({ kind: "free", start: cursor, end: entry.start, minutes: gap });
    }
    future.push(entry);
    cursor = Math.max(cursor, entry.end);
  }

  const state: DayState = hero
    ? hero.mode
    : blocks.length
      ? "done"
      : "empty";

  return {
    dateKey,
    nowMinutes,
    state,
    past,
    current,
    beforeHero,
    hero,
    future,
    school,
    blocks,
    plannedMinutes: blocks.reduce((total, block) => total + block.duration_minutes, 0),
    pastBlocks: blocks.filter((block) => blockSpan(block, timeZone).end <= nowMinutes).length,
  };
}

/**
 * Одна строка о дне над лентой.
 *
 * «Сегодня 5 занятий на 2 ч 15 мин. Одно уже позади, сейчас — Физика 9.»
 * Отвечает на вопрос «много ли сегодня и где я», не заставляя читать ленту.
 */
export function daySummary(day: DayModel): { lead: string; total: string; tail: string } {
  const count = day.blocks.length;
  if (!count) {
    return { lead: "Сегодня", total: "занятий по плану нет", tail: "." };
  }
  const total = nbsp(
    `${count} ${plural(count, ["занятие", "занятия", "занятий"])} на ${durationLabel(
      day.plannedMinutes,
    )}`,
  );
  if (day.state === "done") {
    return { lead: "Сегодня было", total, tail: " — на сегодня всё." };
  }

  const parts: string[] = [];
  if (day.pastBlocks > 0) {
    parts.push(`${day.pastBlocks === 1 ? "Одно" : day.pastBlocks} уже позади`);
  }
  if (day.hero?.mode === "now") {
    const course = day.hero.block.course_plan_title?.trim();
    parts.push(course ? `сейчас — ${course}` : "одно идёт сейчас");
  } else if (day.hero) {
    parts.push(`следующее в ${formatMinutes(day.hero.start)}`);
  }
  const tail = parts.length ? `. ${capitalize(parts.join(", "))}.` : ".";
  return { lead: "Сегодня", total, tail };
}

// ──────────────────────────── Хвосты и Д/З ───────────────────────────────────

/**
 * Прошедшие без отметки занятия прошлых дней — самые свежие сверху.
 *
 * «Без отметки», а не «пропущенные»: выполненным блок отметить пока негде, и
 * открытый статус в прошлом значит только, что отметки нет. Закреплённые не
 * берём — их помощник по расписанию не переносит, а предлагать то, что
 * сделать нельзя, незачем.
 */
export function missedBlocks(
  blocks: CalendarLearningBlock[],
  todayKey: string,
  timeZone: string,
): CalendarLearningBlock[] {
  return blocks
    .filter((block) => isOpenBlock(block) && !block.fixed)
    .filter((block) => zonedDateKey(block.start_at, timeZone) < todayKey)
    .sort((left, right) => Date.parse(right.start_at) - Date.parse(left.start_at));
}

/**
 * Ближайший день после сегодняшнего, в который есть уроки, — для «Д/З на…».
 * В пятницу это понедельник, а не суббота без уроков.
 */
export function nextSchoolDay(
  days: Array<{ date: string; lessons: DiaryLesson[] }>,
  todayKey: string,
): { date: string; lessons: DiaryLesson[] } | null {
  return (
    [...days]
      .filter((day) => day.date > todayKey && day.lessons.some(isClassRow))
      .sort((left, right) => left.date.localeCompare(right.date))[0] ?? null
  );
}

export interface HomeworkItem {
  id: string;
  subject: string;
  text: string;
}

/**
 * Домашнее задание дня.
 *
 * В дневнике задание записывают в строку того урока, к которому его надо
 * сдать, — как в бумажном дневнике. Поэтому «Д/З к завтра» — это задания из
 * уроков завтрашнего дня, а не сегодняшнего.
 */
export function homeworkOf(lessons: DiaryLesson[]): HomeworkItem[] {
  return lessons
    .filter((lesson) => (lesson.homework ?? "").trim())
    .sort((left, right) => (parseClock(left.startTime) ?? 0) - (parseClock(right.startTime) ?? 0))
    .map((lesson) => ({
      id: lesson.id,
      subject: lessonTitle(lesson),
      text: lesson.homework.trim(),
    }));
}

export interface UpcomingTest {
  dateKey: string;
  title: string;
  /** Предмет, если его удалось узнать, — для подбора слабых тем. */
  subject: string;
  /** Дней до теста: 0 — сегодня. */
  inDays: number;
}

/**
 * Тесты в ближайшие дни по дневнику — повод для «Подготовиться».
 *
 * Сегодняшний считается, только пока он не начался: после него готовиться
 * уже поздно.
 */
export function upcomingTests(
  days: Array<{ date: string; lessons: DiaryLesson[] }>,
  todayKey: string,
  nowMinutes: number,
  horizonDays = 3,
): UpcomingTest[] {
  const tests: UpcomingTest[] = [];
  for (const day of days) {
    const inDays = daysBetween(todayKey, day.date);
    if (inDays < 0 || inDays > horizonDays) continue;
    for (const lesson of day.lessons) {
      if (!isTestBlock(lesson.blockType)) continue;
      if (inDays === 0 && (parseClock(lesson.startTime) ?? 0) <= nowMinutes) continue;
      const subject = (lesson.subjectName ?? "").trim();
      tests.push({
        dateKey: day.date,
        title: lessonTitle(lesson),
        subject: subject && subject !== "Предмет" ? subject : "",
        inDays,
      });
    }
  }
  return tests.sort((left, right) => left.inDays - right.inDays);
}

// ────────────────────────────── Неделя ───────────────────────────────────────

export interface WeekDay {
  dateKey: string;
  weekday: string;
  day: number;
  minutes: number;
  /** Нагрузка относительно самого загруженного дня недели, 0…1. */
  ratio: number;
  test: string | null;
  isToday: boolean;
  isWeekend: boolean;
}

export function weekStrip(
  days: string[],
  blocks: CalendarLearningBlock[],
  diaryDays: Array<{ date: string; lessons: DiaryLesson[] }>,
  todayKey: string,
  timeZone: string,
): WeekDay[] {
  const minutes = new Map<string, number>();
  for (const block of blocks) {
    if (GONE_STATUSES.has(block.status)) continue;
    const key = zonedDateKey(block.start_at, timeZone);
    minutes.set(key, (minutes.get(key) ?? 0) + block.duration_minutes);
  }
  const peak = Math.max(0, ...days.map((key) => minutes.get(key) ?? 0));
  const diary = new Map(diaryDays.map((day) => [day.date, day.lessons]));

  return days.map((dateKey) => {
    const total = minutes.get(dateKey) ?? 0;
    const test = (diary.get(dateKey) ?? []).find((lesson) => isTestBlock(lesson.blockType));
    const weekday = weekdayOf(dateKey);
    return {
      dateKey,
      weekday: WEEKDAYS_SHORT[weekday],
      day: dayNumber(dateKey),
      minutes: total,
      ratio: peak ? total / peak : 0,
      test: test ? lessonTitle(test) : null,
      isToday: dateKey === todayKey,
      isWeekend: weekday >= 5,
    };
  });
}

// ─────────────────────────── Изменения плана ─────────────────────────────────

export interface RevisionRow {
  id: string;
  title: string;
  kind: "moved" | "created" | "removed" | "shortened" | "extended";
  /** Было: «сегодня 17:15», «30 мин». Пусто у нового. */
  from: string;
  /** Стало: «завтра 16:30», «15 мин». Пусто у убранного. */
  to: string;
}

function momentLabel(iso: string, todayKey: string, timeZone: string): string {
  const key = zonedDateKey(iso, timeZone);
  return `${relativeDayLabel(key, todayKey)} ${formatMinutes(zonedMinutes(iso, timeZone))}`;
}

/**
 * Списки из запросов, которые падают независимо друг от друга. Упала часть —
 * отдаём то, что пришло. Упали все — бросаем первую ошибку, чтобы сбой не
 * выглядел как честно пустой результат.
 */
export async function mergeListRequests<T>(requests: Promise<T[]>[]): Promise<T[]> {
  const failures: unknown[] = [];
  const lists = await Promise.all(
    requests.map((request) =>
      request.catch((error: unknown) => {
        failures.push(error);
        return [] as T[];
      }),
    ),
  );
  if (failures.length && failures.length === requests.length) throw failures[0];
  return lists.flat();
}

/** Предложения помощника, которые ждут ответа ученика, — свежие сверху. */
export function pendingRevisions(revisions: ScheduleRevision[]): ScheduleRevision[] {
  return revisions
    .filter((revision) => revision.status === "proposed")
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
}

/** Строки «что изменится» для карточки предложения. */
export function revisionRows(
  revision: ScheduleRevision,
  todayKey: string,
  timeZone: string,
): RevisionRow[] {
  const rows: RevisionRow[] = [];
  const diff = revision.diff ?? ({} as ScheduleRevision["diff"]);
  for (const entry of diff.moved ?? []) {
    rows.push({
      id: `m-${entry.block_id}`,
      title: entry.title,
      kind: "moved",
      from: momentLabel(entry.from.start_at, todayKey, timeZone),
      to: momentLabel(entry.to.start_at, todayKey, timeZone),
    });
  }
  for (const [kind, list] of [
    ["shortened", diff.shortened ?? []],
    ["extended", diff.extended ?? []],
  ] as const) {
    for (const entry of list) {
      rows.push({
        id: `${kind[0]}-${entry.block_id}`,
        title: entry.title,
        kind,
        from: durationLabel(entry.from.duration_minutes),
        to: durationLabel(entry.to.duration_minutes),
      });
    }
  }
  for (const entry of diff.created ?? []) {
    rows.push({
      id: `c-${entry.block_id}`,
      title: entry.title,
      kind: "created",
      from: "",
      to: `${momentLabel(entry.to.start_at, todayKey, timeZone)} · ${durationLabel(
        entry.to.duration_minutes,
      )}`,
    });
  }
  for (const entry of diff.removed ?? []) {
    rows.push({
      id: `r-${entry.block_id}`,
      title: entry.title,
      kind: "removed",
      from: momentLabel(entry.from.start_at, todayKey, timeZone),
      to: "",
    });
  }
  return rows;
}

// ─────────────────────────────── Фокус ───────────────────────────────────────

/**
 * Какой ритм помодоро взять под оставшееся время блока.
 *
 * Самый длинный фокус, который укладывается в остаток (с запасом в пять
 * минут), иначе самый короткий. Иначе таймер «43:00 до перерыва» спорил бы с
 * «ещё 23 мин» блока — два отсчёта, и непонятно, какому верить.
 */
export function pickPresetIndex(minutesLeft: number, presets: Array<{ focus: number }>): number {
  let best = -1;
  presets.forEach((preset, index) => {
    if (preset.focus > minutesLeft + 5) return;
    if (best === -1 || preset.focus > presets[best].focus) best = index;
  });
  if (best !== -1) return best;
  let shortest = 0;
  presets.forEach((preset, index) => {
    if (preset.focus < presets[shortest].focus) shortest = index;
  });
  return shortest;
}
