// Как контест выглядит для ученика: что идёт, что впереди, какого он цвета и чем кончился.
// Здесь нет React и нет сети, поэтому всё проверяется тестами.

import { dateLocale, msg, plural, t } from "./i18n";
import type {
  AdminContest,
  Contest,
  ContestArtName,
  ContestState,
  ContestTask,
  ContestTier,
  MyTaskResult,
  Submission,
} from "./contest-api";

/** Русское число: `ru(3, "день", "дня", "дней")` даёт «дня». */
export function ru(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

/** «Контест по физике 42» даёт номер 42 и вид «По физике». */
export function contestParts(title: string): { number: string | null; kind: string } {
  const clean = title.trim();
  const match = clean.match(/^(.*?)[\s№#]*(\d+)$/);
  const head = match && match[1] ? match[1] : match ? "" : clean;
  const kind = head.replace(/контест/i, " ").replace(/\s+/g, " ").trim();
  const shown = kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : t("Контест");
  return { number: match ? match[2] : null, kind: shown };
}

export interface ContestGroups {
  running: Contest[];
  upcoming: Contest[];
  past: Contest[];
}

const ms = (iso: string) => new Date(iso).getTime();

export function splitContests(contests: readonly Contest[], now: Date): ContestGroups {
  const at = now.getTime();
  const running: Contest[] = [];
  const upcoming: Contest[] = [];
  const past: Contest[] = [];
  for (const contest of contests) {
    if (ms(contest.end_time) <= at) past.push(contest);
    else if (ms(contest.start_time) <= at) running.push(contest);
    else upcoming.push(contest);
  }
  running.sort((a, b) => ms(a.end_time) - ms(b.end_time));
  upcoming.sort((a, b) => ms(a.start_time) - ms(b.start_time));
  past.sort((a, b) => ms(b.start_time) - ms(a.start_time));
  return { running, upcoming, past };
}

/** Что осталось: самые крупные две единицы. «3 дня 18 ч», «2 ч 14 мин», «5 мин». */
export function countdown(to: string, now: Date): Array<{ value: number; unit: string }> {
  const minutes = Math.max(0, Math.ceil((ms(to) - now.getTime()) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) {
    const parts = [{ value: days, unit: plural(days, "день", "дня", "дней") }];
    if (hours > 0) parts.push({ value: hours, unit: t("ч") });
    return parts;
  }
  const rest = minutes % 60;
  if (hours > 0) {
    const parts = [{ value: hours, unit: t("ч") }];
    if (rest > 0) parts.push({ value: rest, unit: t("мин") });
    return parts;
  }
  return [{ value: rest, unit: t("мин") }];
}

/** «4 задачи, 90 минут». Без задач только длительность: придумывать число нельзя. */
export function contestRules(contest: Contest): string {
  const parts: string[] = [];
  const count = contest.tasks.length;
  if (count) parts.push(plural(count, "{n} задача", "{n} задачи", "{n} задач"));
  const minutes = Math.round((ms(contest.end_time) - ms(contest.start_time)) / 60_000);
  if (minutes >= 2880) {
    const days = Math.round(minutes / 1440);
    parts.push(plural(days, "{n} день", "{n} дня", "{n} дней"));
  } else if (minutes > 0) {
    parts.push(plural(minutes, "{n} минута", "{n} минуты", "{n} минут"));
  }
  return parts.join(", ");
}

/** «Суббота, 7 ноября, 11:00» в часовом поясе браузера. */
export function contestDate(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  const weekday = new Intl.DateTimeFormat(dateLocale(), { weekday: "long", timeZone }).format(date);
  const day = new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "long", timeZone }).format(date);
  const time = new Intl.DateTimeFormat(dateLocale(), { hour: "2-digit", minute: "2-digit", timeZone }).format(date);
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${day}, ${time}`;
}

/** «7 ноября». */
export function shortDate(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "long", timeZone }).format(new Date(iso));
}

/**
 * Только решения самого ученика. Администратору `/api/submissions/` отдаёт решения всех,
 * и без этого чужие задачи попали бы в его результаты и счётчики.
 */
export function ownSubmissions(rows: readonly Submission[], meId: number | null | undefined): Submission[] {
  return rows.filter((row) => row.student === meId);
}

export interface ContestResult {
  total: number;
  solved: number;
  pending: number;
  /** Сколько баллов принесли принятые решения: столько же начислил сервер. */
  points: number;
  tookPart: boolean;
}

/**
 * Результат считается только по решениям, отправленным во время контеста: та же задача,
 * решённая на другой день, к нему не относится.
 */
export function contestResult(contest: Contest, submissions: readonly Submission[]): ContestResult {
  const tasks = new Set(contest.tasks);
  const start = ms(contest.start_time);
  const end = ms(contest.end_time);
  const inside = submissions.filter((row) => {
    const at = ms(row.created_at);
    return tasks.has(row.task) && at >= start && at <= end;
  });
  const approved = new Map<number, number>();
  const pending = new Set<number>();
  for (const row of inside) {
    if (row.status === "approved") approved.set(row.task, row.task_points);
    else if (row.status === "pending") pending.add(row.task);
  }
  approved.forEach((_, task) => pending.delete(task));
  let points = 0;
  approved.forEach((value) => {
    points += value;
  });
  return {
    total: contest.tasks.length,
    solved: approved.size,
    pending: pending.size,
    points,
    tookPart: inside.length > 0,
  };
}

/** Сколько условий помещается в вопрос тьютору: остальное он попросит сам. */
const REVIEW_LIMIT = 1800;

/**
 * Вопрос тьютору после контеста. Условия идут с ним: без них ему не о чем говорить.
 * У задач в PDF это текст, вынутый из файла, у старых задач их текст.
 */
export function reviewPrompt(contest: Contest): string {
  const lines = contest.task_details.map((task, index) => {
    const number = task.number ?? index + 1;
    const condition = (task.review_text || task.condition_text || "").trim();
    return `${number}. ${task.title || t("Задача {number}", { number })}${condition ? `: ${condition}` : ""}`;
  });
  let tasks = lines.join("\n");
  if (tasks.length > REVIEW_LIMIT) tasks = `${tasks.slice(0, REVIEW_LIMIT).trimEnd()}…`;
  return `${t("Разбери со мной контест «{title}». Вот задачи:", { title: contest.title })}\n${tasks}`;
}


/** Состояние по часам браузера. Сервер всё равно решает сам, это только для вида. */
export function contestStateAt(contest: Pick<Contest, "start_time" | "end_time">, now: Date): ContestState {
  const moment = now.getTime();
  if (moment < ms(contest.start_time)) return "upcoming";
  if (moment < ms(contest.end_time)) return "running";
  return "ended";
}

export type TaskRow = ContestTask & { mine: MyTaskResult | null };

/** Задачи вместе со своими попытками ученика. */
export function taskRows(contest: Contest): TaskRow[] {
  const mine = new Map((contest.mine ?? []).map((row) => [row.task, row]));
  return contest.task_details.map((task) => ({ ...task, mine: mine.get(task.id) ?? null }));
}

/** Страница одной задачи: по её номеру в контесте, а не по id, чтобы адрес был понятным. */
export function taskPath(contestId: number, number: number): string {
  return `/dashboard/arena/solve/${contestId}/task/${number}`;
}

/** Задача по номеру из адреса и её соседи для «Предыдущая» и «Следующая». */
export function taskByNumber(
  rows: TaskRow[],
  raw: string | undefined,
): { task: TaskRow; previous: TaskRow | null; next: TaskRow | null } | null {
  const number = Number(raw);
  if (!Number.isInteger(number)) return null;
  const index = rows.findIndex((row) => row.number === number);
  if (index < 0) return null;
  return { task: rows[index], previous: rows[index - 1] ?? null, next: rows[index + 1] ?? null };
}

/** Время попытки от начала контеста: часы и минуты, «1:05». */
export function attemptClock(seconds: number): string {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
}

const ANSWER_ERRORS: Record<string, string> = {
  no_profile: msg("Войди в аккаунт, чтобы отвечать."),
  admin: msg("Админы не отвечают в контестах."),
  bad_task: msg("Такой задачи в контесте нет."),
  not_running: msg("Контест сейчас не идёт."),
  empty: msg("Впиши ответ."),
  too_long: msg("Ответ длиннее 100 знаков."),
  already_solved: msg("Эта задача уже решена."),
  too_many: msg("Попыток по этой задаче больше нет."),
  too_fast: msg("Подожди пару секунд."),
  no_answer: msg("У задачи нет ответа."),
};

export function answerErrorText(code: string): string {
  const known = ANSWER_ERRORS[code];
  return known ? t(known) : t("Не получилось проверить. Попробуй ещё раз.");
}

function dayStart(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Метка на плашке в админке: черновик, когда начнётся, идёт или прошёл. */
export function adminBadge(contest: AdminContest, now: Date): string {
  if (!contest.is_published) return t("Черновик");
  const people = plural(contest.participants, "{n} участник", "{n} участника", "{n} участников");
  const state = contestStateAt(contest, now);
  if (state === "running") return t("Идёт, {people}", { people });
  if (state === "ended") return t("Прошёл, {people}", { people });
  const start = new Date(contest.start_time);
  const days = Math.round((dayStart(start) - dayStart(now)) / 86_400_000);
  if (days <= 0) {
    const time = new Intl.DateTimeFormat(dateLocale(), { hour: "2-digit", minute: "2-digit" }).format(start);
    return t("Сегодня в {time}", { time });
  }
  if (days === 1) return t("Завтра");
  return plural(days, "Через {n} день", "Через {n} дня", "Через {n} дней");
}


/** То, что нужно плашке: одинаково у контеста ученика и у контеста админки. */
export interface Plaque {
  id: number;
  title: string;
  description: string;
  start_time: string;
  end_time: string;
  tier: ContestTier;
  art: ContestArtName;
  taskCount: number;
  /** Сколько баллов можно получить за все задачи. */
  points: number;
}

export function plaqueOf(contest: Contest | AdminContest): Plaque {
  const taskCount = "task_count" in contest ? contest.task_count : contest.tasks.length;
  return {
    id: contest.id,
    title: contest.title,
    description: contest.description,
    start_time: contest.start_time,
    end_time: contest.end_time,
    tier: contest.tier,
    art: contest.art,
    taskCount,
    points: contest.points_total,
  };
}

/** «4 задачи, 3 часа, до 750 баллов». Без задач только длительность: придумывать число нельзя. */
export function plaqueRules(plaque: Plaque, { duration = true }: { duration?: boolean } = {}): string {
  const parts: string[] = [];
  if (plaque.taskCount) parts.push(plural(plaque.taskCount, "{n} задача", "{n} задачи", "{n} задач"));
  if (duration) {
    const minutes = Math.round((ms(plaque.end_time) - ms(plaque.start_time)) / 60_000);
    if (minutes >= 2880) {
      const days = Math.round(minutes / 1440);
      parts.push(plural(days, "{n} день", "{n} дня", "{n} дней"));
    } else if (minutes >= 60 && minutes % 60 === 0) {
      const hours = minutes / 60;
      parts.push(plural(hours, "{n} час", "{n} часа", "{n} часов"));
    } else if (minutes > 0) {
      parts.push(plural(minutes, "{n} минута", "{n} минуты", "{n} минут"));
    }
  }
  if (plaque.points > 0) parts.push(plural(plaque.points, "до {n} балла", "до {n} баллов", "до {n} баллов"));
  return parts.join(", ");
}
