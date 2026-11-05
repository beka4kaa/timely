// Что считается на плашке цели: цвет, тропа к вершине, сроки, к какой цели тянется
// привычка. Без React и без сети, чтобы всё это проверялось тестами.

import { localDay, plural } from "../habits/habit-days";
import { understandLocally } from "../../lib/understand";

export const TONES = ["indigo", "rose", "teal", "blue", "amber"] as const;
export type Tone = (typeof TONES)[number];
export type GoalScope = "study" | "general";

/** Старые задачи, вехи и подцели живут внутри целей, а привычки теперь отдельно. */
const SHOWN_TYPES = new Set(["goal", "global_goal", "financial_goal"]);

export interface Goal {
  id: string;
  title: string;
  type: string;
  status: string;
  scope: GoalScope;
  tone: Tone;
  isMain: boolean;
  /** То, что видит ученик: у завершённой цели всегда 100. */
  progress: number;
  /** Что записано на сервере: цель, вернувшаяся в работу, продолжит с этого места. */
  savedProgress: number;
  /** Ползунок двигает прогресс. Нет, если он считается сам: по вложенным целям или суммам. */
  manual: boolean;
  /** ISO-дата срока. */
  due: string | null;
  /** Предметы (LearningGoal), которые ведут к цели. */
  lessons: string[];
}

export function hashOf(text: string): number {
  let h = 7;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) & 0x7fffffff;
  return h;
}

/**
 * Цвет плашки. У целей, созданных раньше плашек, он постоянный и зависит от id. Считается
 * так же, как `goalTone` в чате: одна и та же цель не должна менять цвет между страницами.
 */
export function toneOf(id: string, stored: unknown): Tone {
  if (TONES.includes(stored as Tone)) return stored as Tone;
  let value = 0;
  for (const char of id) value = (value * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return TONES[value % TONES.length];
}

/** Учёба или общая. У старых целей этого поля нет: определяем по названию. */
export function scopeOf(title: string, stored: unknown): GoalScope {
  if (stored === "study" || stored === "general") return stored;
  const understood = understandLocally(title, "goal");
  return understood.kind === "goal" ? understood.scope : "general";
}

function clampPercent(value: unknown): number {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : 0;
}

/** Старые цели хранили срок по-разному: точной датой, концом периода, месяцем или годом. */
function deadlineOf(raw: Record<string, unknown>): string | null {
  for (const field of [raw.dueDate, raw.endDate]) {
    if (typeof field === "string" && field) return field.slice(0, 10);
  }
  if (typeof raw.month === "string" && /^\d{4}-\d{2}$/.test(raw.month)) {
    const [year, month] = raw.month.split("-").map(Number);
    return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  }
  if (typeof raw.year === "number" && raw.year > 0) return `${raw.year}-12-31`;
  return null;
}

export function mapGoal(raw: Record<string, unknown>): Goal {
  const id = String(raw.id);
  const title = String(raw.title ?? "");
  const status = String(raw.status ?? "not_started");
  const type = String(raw.type ?? "goal");
  const children = Number(raw.children_count ?? 0);
  const target = Number(raw.targetAmount ?? 0);
  const counted = type === "financial_goal" && target > 0;
  const progress = counted
    ? clampPercent((Number(raw.currentAmount ?? 0) / target) * 100)
    : clampPercent(children > 0 ? raw.computed_progress : raw.progress);
  return {
    id,
    title,
    type,
    status,
    scope: scopeOf(title, raw.scope),
    tone: toneOf(id, raw.tone),
    isMain: raw.isMain === true,
    progress: status === "done" ? 100 : progress,
    savedProgress: progress,
    manual: !counted && children === 0,
    due: deadlineOf(raw),
    lessons: Array.isArray(raw.lessons) ? raw.lessons.map(String) : [],
  };
}

export function isShownGoal(goal: Pick<Goal, "type" | "status">): boolean {
  return SHOWN_TYPES.has(goal.type) && goal.status !== "archived";
}

export function isOpenGoal(goal: Pick<Goal, "type" | "status">): boolean {
  return isShownGoal(goal) && goal.status !== "done";
}

// ─────────────────────────────── Тропа к вершине ─────────────────────────────

const WIDTH = 360;
const HEIGHT = 176;
const LAST = 7;

type Point = readonly [number, number];

export interface RidgeShape {
  width: number;
  height: number;
  points: Point[];
  lengths: number[];
  total: number;
  trail: string;
  fill: string;
  fillBack: string;
  flag: string;
}

function random(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

function polyline(points: readonly Point[]): string {
  return points.map((p, index) => `${index ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("");
}

/** Гряда у цели всегда одна и та же: зависит только от её id. */
export function ridgeShape(id: string): RidgeShape {
  const next = random(hashOf(id) + 41);
  const points: Point[] = [];
  for (let i = 0; i <= LAST; i += 1) {
    const k = i / LAST;
    const wobble = i === 0 || i === LAST ? 0 : (i % 2 ? -1 : 1) * (5 + next() * 15);
    points.push([24 + k * (WIDTH - 62), HEIGHT - 20 - k * (HEIGHT - 74) + wobble]);
  }
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const length = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    lengths.push(length);
    total += length;
  }
  const top = points[LAST];
  const back: Point[] = points.map((p, n) => [p[0] - 34, p[1] - 8 - (n % 2 ? 16 : -6)]);
  const close = (edge: number) =>
    `L${WIDTH + 40} ${edge}L${WIDTH + 40} ${HEIGHT + 4}L-10 ${HEIGHT + 4}Z`;
  return {
    width: WIDTH,
    height: HEIGHT,
    points,
    lengths,
    total,
    trail: polyline(points),
    fill: polyline(points) + close(top[1] + 26),
    fillBack: polyline(back) + close(back[LAST][1] + 16),
    flag: `M${top[0].toFixed(1)} ${top[1].toFixed(1)}v-30l17 7-17 7`,
  };
}

/** Где слайм при таком прогрессе и какая часть тропы уже пройдена. */
export function walkRidge(shape: RidgeShape, progress: number): { at: Point; walked: string } {
  const goal = (Math.max(0, Math.min(100, progress)) / 100) * shape.total;
  const walked: Point[] = [shape.points[0]];
  let covered = 0;
  for (let i = 0; i < shape.lengths.length; i += 1) {
    const length = shape.lengths[i];
    if (covered + length >= goal) {
      const part = length > 0 ? (goal - covered) / length : 0;
      const from = shape.points[i];
      const to = shape.points[i + 1];
      const at: Point = [from[0] + (to[0] - from[0]) * part, from[1] + (to[1] - from[1]) * part];
      walked.push(at);
      return { at, walked: polyline(walked) };
    }
    covered += length;
    walked.push(shape.points[i + 1]);
  }
  return { at: shape.points[LAST], walked: polyline(walked) };
}

// ──────────────────────────────────── Сроки ──────────────────────────────────

const DAY_MS = 86_400_000;
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

function utc(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function isoOf(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return isoOf(utc(iso) + days * DAY_MS);
}

export function daysUntil(due: string, today: string): number {
  return Math.round((utc(due) - utc(today)) / DAY_MS);
}

function addMonth(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return isoOf(Date.UTC(year, month, Math.min(day, lastDay)));
}

/** «6 ноября». Год нужен, только если иначе дату можно принять за ближайшую. */
export function formatDay(iso: string, today: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const far = Math.abs(daysUntil(iso, today)) > 300;
  return `${day} ${MONTHS[month - 1]}${far ? ` ${year}` : ""}`;
}

function daysWord(n: number): string {
  return plural(n, "день", "дня", "дней");
}

/** Строка на карточке: «до 25 мая, осталось 203 дня». */
export function dueLine(due: string | null, today: string): string {
  if (!due) return "Без срока";
  const left = daysUntil(due, today);
  const date = formatDay(due, today);
  if (left < 0) return `Срок был ${date}`;
  if (left === 0) return "Срок сегодня";
  return `до ${date}, осталось ${left} ${daysWord(left)}`;
}

export interface DueStub {
  /** Большое число на корешке главной цели. `null`: числа нет. */
  count: number | null;
  word: string;
  line: string;
}

export function dueStub(due: string | null, today: string): DueStub {
  if (!due) return { count: null, word: "", line: "Без срока" };
  const left = daysUntil(due, today);
  const date = formatDay(due, today);
  if (left < 0) return { count: null, word: "", line: `Срок был ${date}` };
  if (left === 0) return { count: null, word: "", line: "Срок сегодня" };
  return { count: left, word: daysWord(left), line: `до ${date}` };
}

/** Школьные четверти кончаются примерно в эти дни. */
const QUARTER_ENDS: ReadonlyArray<readonly [number, number]> = [
  [3, 20],
  [5, 25],
  [10, 25],
  [12, 28],
];

function nextDate(today: string, dates: ReadonlyArray<readonly [number, number]>): string {
  const year = Number(today.slice(0, 4));
  const pad = (value: number) => String(value).padStart(2, "0");
  for (const candidateYear of [year, year + 1]) {
    for (const [month, day] of dates) {
      const candidate = `${candidateYear}-${pad(month)}-${pad(day)}`;
      if (candidate > today) return candidate;
    }
  }
  return addDays(today, 365);
}

export function dueOptions(today: string): Array<{ label: string; date: string }> {
  return [
    { label: "Через неделю", date: addDays(today, 7) },
    { label: "Через месяц", date: addMonth(today) },
    { label: "К концу четверти", date: nextDate(today, QUARTER_ENDS) },
    { label: "К лету", date: nextDate(today, [[6, 1]]) },
  ];
}

/** Срок, который ставится, когда человек его не назвал. */
export function defaultDue(today: string): string {
  return addMonth(today);
}

/** «Законы Ньютона, сегодня в 17:15». */
export function nextStepText(title: string, startAt: string, now: Date = new Date()): string {
  const moment = new Date(startAt);
  const day = localDay(moment);
  const today = localDay(now);
  const when = day === today ? "сегодня" : day === addDays(today, 1) ? "завтра" : formatDay(day, today);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${title}, ${when} в ${pad(moment.getHours())}:${pad(moment.getMinutes())}`;
}

// ─────────────────────────── Связь привычек и целей ──────────────────────────

const THEMES: readonly RegExp[] = [
  /физик|механик|задач|алгебр|математ|геометр|уравнен|формул/,
  /англ|слов|язык/,
  /чита|книг|литератур/,
  /спать|сон|лечь|ложиться|встава|высып/,
  /заряд|спорт|бег|беж|трениров|отжим|здоров/,
  /истори/,
  /хими/,
  /биолог/,
];

/** К какой цели, похоже, ведёт привычка: у них общая тема. Главная цель в приоритете. */
export function suggestGoalFor<T extends Pick<Goal, "id" | "title" | "isMain">>(
  habitName: string,
  goals: readonly T[],
): T | null {
  const lower = habitName.toLowerCase();
  const themes = THEMES.filter((theme) => theme.test(lower));
  if (themes.length === 0) return null;
  const matching = goals.filter((goal) => themes.some((theme) => theme.test(goal.title.toLowerCase())));
  return matching.find((goal) => goal.isMain) ?? matching[0] ?? null;
}

/** Какие предметы упомянуты в названии цели: «Сдать физику» находит предмет «Физика 9». */
export function matchLessons<T extends { subject: string }>(title: string, lessons: readonly T[]): T[] {
  const lower = title.toLowerCase();
  return lessons.filter((lesson) => {
    const stem = lesson.subject.toLowerCase().split(/\s+/)[0].slice(0, 4);
    return stem.length === 4 && lower.includes(stem);
  });
}

/** Какие привычки предложить, если модель сама не предложила. */
export function habitIdeasFor(title: string, scope: GoalScope): string[] {
  if (scope === "general") return ["Каждый день по шагу"];
  if (/физик|алгебр|математ|геометр/.test(title.toLowerCase())) return ["Решать 3 задачи", "Повторять формулы"];
  return ["Повторять темы"];
}
