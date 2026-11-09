// Слабые темы: что сегодня повторять, как подписать срок и сколько примерно помнится.
//
// Чистые функции без React и сети: так они проверяются таблицей, а страница только рисует.

import { plural } from "./mind-srs";
import type { Topic, TopicStatus } from "../types/mind";

export interface WeakSubtopic {
  id: string;
  title: string;
}

/** Строка `GET /api/topics`: `subject` здесь это id предмета. */
export interface WeakTopic
  extends Pick<
    Topic,
    | "id"
    | "name"
    | "archived"
    | "lastRevisedAt"
    | "nextReviewAt"
    | "intervalDays"
    | "easeFactor"
    | "subjectName"
    | "subjectEmoji"
    | "subjectColor"
  > {
  status: TopicStatus;
  subject: string;
  subtopics?: WeakSubtopic[];
}

export interface WeakSubject {
  id: string;
  name: string;
  color?: string;
  orderIndex?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Сколько календарных дней от `from` до `to`. Вчера это -1, завтра 1. */
export function dayDiff(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);
}

// ── Сроки ─────────────────────────────────────────────────────────────────────

export type ReviewGroup = "late" | "today" | "tomorrow" | "week" | "later" | "none";

export const REVIEW_GROUPS: Array<{ key: ReviewGroup; title: string }> = [
  { key: "late", title: "Просрочено" },
  { key: "today", title: "На сегодня" },
  { key: "tomorrow", title: "Завтра" },
  { key: "week", title: "На этой неделе" },
  { key: "later", title: "Позже" },
  { key: "none", title: "Без срока" },
];

export function reviewGroup(nextReviewAt: string | null, now: Date): ReviewGroup {
  if (!nextReviewAt) return "none";
  const diff = dayDiff(now, new Date(nextReviewAt));
  if (diff < 0) return "late";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  const daysLeftInWeek = 6 - ((now.getDay() + 6) % 7);
  return diff <= daysLeftInWeek ? "week" : "later";
}

const ON_WEEKDAY = ["в воскресенье", "в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу"];

function agoLabel(days: number): string {
  if (days === 0) return "сегодня";
  if (days === 1) return "вчера";
  if (days < 14) return `${days} ${plural(days, "день", "дня", "дней")} назад`;
  if (days < 60) {
    const weeks = Math.floor(days / 7);
    return `${weeks} ${plural(weeks, "неделю", "недели", "недель")} назад`;
  }
  const months = Math.floor(days / 30);
  return `${months} ${plural(months, "месяц", "месяца", "месяцев")} назад`;
}

/** Подпись срока в строке темы. */
export function whenLabel(nextReviewAt: string | null, now: Date): string {
  if (!nextReviewAt) return "без срока";
  const date = new Date(nextReviewAt);
  const group = reviewGroup(nextReviewAt, now);
  if (group === "late") return agoLabel(-dayDiff(now, date));
  if (group === "today") return "сегодня";
  if (group === "tomorrow") return "завтра";
  if (group === "week") return ON_WEEKDAY[date.getDay()];
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Подпись под предметом на карточке: когда тему повторяли в прошлый раз. */
export function lastTimeLabel(lastRevisedAt: string | null, now: Date): string {
  if (!lastRevisedAt) return "первое повторение";
  return `прошлый раз ${agoLabel(Math.max(0, -dayDiff(now, new Date(lastRevisedAt))))}`;
}

function byReviewDate(a: WeakTopic, b: WeakTopic): number {
  const left = a.nextReviewAt ? new Date(a.nextReviewAt).getTime() : Infinity;
  const right = b.nextReviewAt ? new Date(b.nextReviewAt).getTime() : Infinity;
  return left - right || a.name.localeCompare(b.name, "ru");
}

/** Темы одной группы списка, ближайшие сверху. */
export function topicsInGroup(topics: WeakTopic[], group: ReviewGroup, now: Date): WeakTopic[] {
  return topics.filter((topic) => reviewGroup(topic.nextReviewAt, now) === group).sort(byReviewDate);
}

/** Колода на сегодня: всё просроченное и сегодняшнее, самое давнее сверху. */
export function dueTopics(topics: WeakTopic[], now: Date): WeakTopic[] {
  return topics
    .filter((topic) => {
      if (topic.archived) return false;
      const group = reviewGroup(topic.nextReviewAt, now);
      return group === "late" || group === "today";
    })
    .sort(byReviewDate);
}

/** Следующая тема, когда на сегодня всё. */
export function nearestTopic(topics: WeakTopic[], now: Date): WeakTopic | null {
  return (
    topics
      .filter((topic) => !topic.archived && topic.nextReviewAt && dayDiff(now, new Date(topic.nextReviewAt)) > 0)
      .sort(byReviewDate)[0] ?? null
  );
}

// ── Память ────────────────────────────────────────────────────────────────────

/**
 * Оценка, а не измерение. Модель как у half-life regression: к сроку повторения помнится
 * половина, и убывает по экспоненте. Истории повторений бэкенд не хранит, известно только
 * последнее, поэтому и на графике зубец один. Подпись на странице поэтому «примерно».
 */
const RETENTION_AT_REVIEW = 0.5;

function retention(elapsedDays: number, intervalDays: number): number {
  return Math.pow(RETENTION_AT_REVIEW, Math.max(0, elapsedDays) / Math.max(intervalDays, 0.4));
}

/** Сколько процентов примерно помнится сейчас. `null`, если тему ещё не повторяли. */
export function memoryPercent(
  topic: Pick<WeakTopic, "lastRevisedAt" | "intervalDays">,
  now: Date,
): number | null {
  if (!topic.lastRevisedAt) return null;
  const since = (now.getTime() - new Date(topic.lastRevisedAt).getTime()) / DAY_MS;
  return Math.round(retention(since, topic.intervalDays || 1) * 100);
}

export interface MemoryPoint {
  x: number;
  y: number;
}

export interface MemoryCurve {
  /** Кривая от прошлого повторения до сегодня. Пусто, если тему ещё не повторяли. */
  past: string;
  area: string;
  future: string;
  /** Подъём в день повторения. Пусто, если повторения сегодня не будет. */
  up: string;
  todayX: number;
  height: number;
  /** Отмеченные повторения. */
  reviews: MemoryPoint[];
  next: MemoryPoint | null;
}

const CHART_W = 300;
const CHART_H = 96;
const CHART_FROM = -14;
const CHART_TO = 14;

/**
 * График памяти: две недели назад, сегодня, две недели вперёд.
 *
 * `nextDays` это срок следующего повторения. С `reviewToday` тема повторяется сегодня,
 * кривая поднимается и падает медленнее до этого срока. Без него сегодня всё уже
 * сделано: память просто продолжает убывать до даты, которая уже назначена.
 */
export function memoryCurve({
  lastRevisedAt,
  intervalDays,
  nextDays,
  reviewToday,
  now,
}: {
  lastRevisedAt: string | null;
  intervalDays: number | null;
  nextDays: number;
  reviewToday: boolean;
  now: Date;
}): MemoryCurve {
  const x = (day: number) => ((day - CHART_FROM) / (CHART_TO - CHART_FROM)) * CHART_W;
  const y = (memory: number) => 6 + (1 - memory) * (CHART_H - 12);
  const line = (points: Array<[number, number]>) =>
    points.map(([day, memory], index) => `${index ? "L" : "M"}${x(day).toFixed(1)} ${y(memory).toFixed(1)}`).join("");

  const interval = intervalDays || 1;
  const since = lastRevisedAt
    ? Math.max(0, (now.getTime() - new Date(lastRevisedAt).getTime()) / DAY_MS)
    : null;

  let past = "";
  let area = "";
  const reviews: MemoryPoint[] = [];
  if (since !== null) {
    const start = Math.max(CHART_FROM, -since);
    const points: Array<[number, number]> = [];
    for (let day = start; day < 0; day += 0.25) points.push([day, retention(day + since, interval)]);
    points.push([0, retention(since, interval)]);
    past = line(points);
    area = `${past}L${x(0).toFixed(1)} ${CHART_H}L${x(start).toFixed(1)} ${CHART_H}Z`;
    if (since <= -CHART_FROM) reviews.push({ x: x(-since), y: y(1) });
  }

  const future: Array<[number, number]> = [];
  let up = "";
  let nextMemory: number;
  if (reviewToday) {
    const stretch = Math.max(nextDays, 0.4);
    for (let day = 0; day <= CHART_TO; day += 0.25) future.push([day, retention(day, stretch)]);
    nextMemory = retention(nextDays, stretch);
    if (since !== null) {
      up = `M${x(0).toFixed(1)} ${y(retention(since, interval)).toFixed(1)}V${y(1).toFixed(1)}`;
    }
  } else {
    const base = since ?? 0;
    for (let day = 0; day <= CHART_TO; day += 0.25) future.push([day, retention(base + day, interval)]);
    nextMemory = retention(base + nextDays, interval);
  }

  return {
    past,
    area,
    future: line(future),
    up,
    todayX: x(0),
    height: CHART_H,
    reviews,
    next: nextDays >= 0.5 && nextDays <= CHART_TO ? { x: x(nextDays), y: y(nextMemory) } : null,
  };
}

// ── Обложка ───────────────────────────────────────────────────────────────────

const DEFAULT_SUBJECT_COLOR = "#8b5cf6";
const COVER_CLASSES = ["b-phys", "b-alg", "b-rus", "b-plum", "b-pale"];
const KNOWN_COVERS: Array<[RegExp, string]> = [
  [/физик/i, "b-phys"],
  [/алгебр|математ|геометр/i, "b-alg"],
  [/русск|литератур/i, "b-rus"],
  [/истор/i, "b-plum"],
];

/**
 * Обложка предмета. Цвет, который ученик выбрал сам, важнее всего. У остальных предметов
 * в базе один и тот же цвет по умолчанию, поэтому различаем их по названию.
 */
export function coverOf(
  subjectName: string | null | undefined,
  color: string | null | undefined,
): { className: string; style?: Record<string, string> } {
  if (color && color.toLowerCase() !== DEFAULT_SUBJECT_COLOR && /^#[0-9a-f]{3,8}$/i.test(color)) {
    return {
      className: "",
      style: { "--b1": color, "--b2": `color-mix(in srgb, ${color} 60%, #000)` },
    };
  }
  const name = subjectName ?? "";
  const known = KNOWN_COVERS.find(([pattern]) => pattern.test(name));
  if (known) return { className: known[1] };
  let sum = 0;
  for (const letter of name) sum += letter.codePointAt(0) ?? 0;
  return { className: COVER_CLASSES[sum % COVER_CLASSES.length] };
}

// ── «Что сегодня изучил» ──────────────────────────────────────────────────────

function normalized(text: string): string {
  return text.trim().toLocaleLowerCase("ru").replace(/ё/g, "е").replace(/\s+/g, " ");
}

/** Предмет ровно с таким названием, без учёта регистра. */
export function exactSubject<T extends { name: string }>(subjects: T[], name: string): T | undefined {
  const wanted = normalized(name);
  return wanted ? subjects.find((subject) => normalized(subject.name) === wanted) : undefined;
}

/**
 * Предмет для того, что назвал разбор: точно или по началу, чтобы «Русский» находил
 * «Русский язык». Человек видит результат в предпросмотре и может поменять.
 */
export function findSubject<T extends { name: string }>(subjects: T[], name: string): T | undefined {
  const wanted = normalized(name);
  if (!wanted) return undefined;
  return (
    exactSubject(subjects, name) ??
    subjects.find((subject) => {
      const have = normalized(subject.name);
      return have.startsWith(`${wanted} `) || wanted.startsWith(`${have} `);
    })
  );
}

/** Созданный карточкой предмет убираем при отмене, только пока он пуст и не стоит в школьном расписании. */
export function subjectsToRemove(
  created: string[],
  topics: { subject: string }[],
  slots: { subjectId?: string }[],
): string[] {
  return created.filter(
    (id) => !topics.some((topic) => topic.subject === id) && !slots.some((slot) => slot.subjectId === id),
  );
}

/** Одна тема в предпросмотре, ещё не записанная. */
export interface TopicDraft {
  key: string;
  title: string;
  /** Существующий предмет. */
  subjectId: string;
  /** Новый предмет, которого ещё нет. */
  newSubject: string;
  /** Такая тема уже есть: запись пропустим, а не задвоим. */
  duplicate: boolean;
}

export function draftHasSubject(draft: TopicDraft): boolean {
  return Boolean(draft.subjectId || draft.newSubject.trim());
}

/** `mind.Topic.name`: длиннее сервер не примет. */
const MAX_TOPIC_NAME = 255;

/** Что записывать: разобранные темы, сопоставленные с предметами и уже имеющимися темами. */
export function buildDrafts(
  parsed: Array<{ title: string; subject: string }>,
  subjects: WeakSubject[],
  topics: WeakTopic[],
): TopicDraft[] {
  const seen = new Set<string>();
  const drafts: TopicDraft[] = [];
  for (const row of parsed) {
    const title = row.title.trim().slice(0, MAX_TOPIC_NAME);
    const key = normalized(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const subject = findSubject(subjects, row.subject);
    // Предмет не назван, но такая тема уже есть: значит, он известен.
    const same = topics.find(
      (topic) => normalized(topic.name) === key && (!row.subject.trim() || topic.subject === subject?.id),
    );
    drafts.push({
      key,
      title,
      subjectId: same?.subject ?? subject?.id ?? "",
      newSubject: subject || same ? "" : row.subject.trim(),
      duplicate: Boolean(same),
    });
  }
  return drafts;
}

/** Только что изученная тема: повторяли сегодня, следующий раз завтра. */
export function firstReviewFields(now: Date) {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  return {
    status: "MEDIUM" as const,
    studyState: "STUDIED" as const,
    lastRevisedAt: now.toISOString(),
    nextReviewAt: next.toISOString(),
    intervalDays: 1,
  };
}
