// Правила календаря «Плана» без React: то, что проверяется таблицей.
//
// Сетка одна на неделю и на день, как в Google Календаре: день просто показывает
// одну колонку из той же сетки. Поэтому геометрия здесь считается в минутах, а не в
// пикселях: высоту часа знает CSS (`--hh`), а `HOUR_PX` нужен только там, где надо
// понять, сколько строк названия влезает в блок и куда указывает мышь.

import {
  shiftDateKey,
  weekdayOf,
  zonedDateKey,
  zonedMinutes,
} from "../../lib/studyplan-calendar.ts";
import type { ScheduleDiff } from "../../lib/studyplan-api.ts";
import { weekdayOnLabel } from "../../lib/studyplan-visuals.ts";

/** То же значение, что `--hh` у `.cal` в `grow.css`. */
export const HOUR_PX = 72;
/** Шаг при перетаскивании: так удобно в расписании. */
export const STEP_MINUTES = 15;
/** Длина нового занятия, как в быстром создании у прототипа. */
export const NEW_BLOCK_MINUTES = 30;
const DAY_MINUTES = 24 * 60;
/** Границы бэкенда: `MIN_PART_MINUTES` и `BlockPatchSerializer.duration_minutes`. */
const MIN_BLOCK_MINUTES = 15;
const MAX_BLOCK_MINUTES = 480;

const WEEKDAY_NAMES = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const WEEKDAY_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const MONTH_NAMES = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MONTHS_GENITIVE = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

// ─────────────────────────────── Подписи ─────────────────────────────────────

/** «8:00», «16:05». Без ведущего нуля, как в сетке прототипа. */
export function clock(minutes: number): string {
  const safe = ((Math.round(minutes) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${hours}:${rest < 10 ? "0" : ""}${rest}`;
}

/** «16:05–16:35». */
export function clockRange(start: number, duration: number): string {
  return `${clock(start)}–${clock(start + duration)}`;
}

/** Нагрузка дня в шапке: «45 мин», «1 ч 15», «2 ч». */
export function loadLabel(minutes: number): string {
  if (minutes <= 0) return "свободно";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} мин`;
  return rest ? `${hours} ч ${rest}` : `${hours} ч`;
}

export function dayShort(dateKey: string): string {
  return WEEKDAY_SHORT[weekdayOf(dateKey)] ?? "";
}

function dayMonth(dateKey: string): string {
  const [, month, day] = dateKey.split("-").map(Number);
  return `${day} ${MONTHS_GENITIVE[(month ?? 1) - 1] ?? ""}`.trim();
}

/** «Вторник, 3 ноября». */
export function fullDayLabel(dateKey: string): string {
  return `${WEEKDAY_NAMES[weekdayOf(dateKey)] ?? ""}, ${dayMonth(dateKey)}`;
}

/** «Ноябрь 2026». */
export function monthTitle(dateKey: string): string {
  const [year, month] = dateKey.split("-").map(Number);
  return `${MONTH_NAMES[(month ?? 1) - 1] ?? ""} ${year}`;
}

export interface MonthCell {
  dateKey: string;
  day: number;
  /** День соседнего месяца: виден, чтобы неделя не обрывалась. */
  out: boolean;
}

/** Месяц целыми неделями, с понедельника. Строк столько, сколько нужно месяцу. */
export function monthCells(dateKey: string): MonthCell[] {
  const [year, month] = dateKey.split("-").map(Number);
  const prefix = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  const first = `${prefix}-01`;
  const daysInMonth = new Date(Date.UTC(year, month ?? 1, 0)).getUTCDate();
  const last = `${prefix}-${String(daysInMonth).padStart(2, "0")}`;
  const start = shiftDateKey(first, -weekdayOf(first));
  const end = shiftDateKey(last, 6 - weekdayOf(last));
  const cells: MonthCell[] = [];
  for (let key = start; key <= end; key = shiftDateKey(key, 1)) {
    cells.push({ dateKey: key, day: Number(key.slice(-2)), out: !key.startsWith(prefix) });
  }
  return cells;
}

// ─────────────────────────────── Геометрия ───────────────────────────────────

export function snapToStep(minutes: number): number {
  return Math.round(minutes / STEP_MINUTES) * STEP_MINUTES;
}

/** Куда встанет начало при переносе: на шаге сетки и в пределах суток. */
export function movedStart(originStart: number, delta: number, duration: number): number {
  return Math.max(0, Math.min(DAY_MINUTES - duration, snapToStep(originStart + delta)));
}

/** Длина после растягивания за нижний край. */
export function resizedDuration(originDuration: number, delta: number, start: number): number {
  const snapped = snapToStep(originDuration + delta);
  return Math.max(MIN_BLOCK_MINUTES, Math.min(MAX_BLOCK_MINUTES, DAY_MINUTES - start, snapped));
}

/**
 * Где начнётся новое занятие после нажатия на пустое место: курсор оказывается в его
 * верхней части, а не на нижнем краю.
 */
export function slotStart(pointerMinutes: number): number {
  return Math.max(0, Math.min(DAY_MINUTES - NEW_BLOCK_MINUTES, snapToStep(pointerMinutes - STEP_MINUTES / 2)));
}

export interface BlockFit {
  /** Сколько строк названия помещается. */
  lines: number;
  /** Есть место на отдельную строку времени. */
  hasTime: boolean;
  tiny: boolean;
}

/**
 * Подпись и то, сколько строк названия помещается в блок: обрезанных букв быть не
 * должно. Числа те же, что у `fit()` в прототипе.
 */
export function blockFit(durationMinutes: number, options: { lanes?: number; hourPx?: number } = {}): BlockFit {
  const { lanes = 1, hourPx = HOUR_PX } = options;
  const room = (durationMinutes / 60) * hourPx - 6;
  // В узкой дорожке время всё равно не прочитать: всё место названию.
  const roomy = room >= 41 && lanes < 3;
  return {
    lines: Math.max(1, Math.min(4, Math.floor((room - (roomy ? 13 : 0)) / 14))),
    hasTime: roomy,
    tiny: room < 14,
  };
}

/** Дальше дорожки не режем: четвёртая стала бы полоской, в которой не читается ничего. */
const MAX_LANES = 3;

/** Положение блока при наложении. `null` — наложения нет, блок на всю колонку. */
export function laneBox(lane: number, lanes: number): { left: string; width: string } | null {
  if (lanes <= 1) return null;
  const visible = Math.min(lanes, MAX_LANES);
  const index = Math.min(lane, visible - 1);
  const percent = 100 / visible;
  const shift = lane >= MAX_LANES ? (lane - MAX_LANES + 1) * 6 : 0;
  return {
    left: `calc(${(index * percent).toFixed(3)}% + ${2 + shift}px)`,
    width: `calc(${percent.toFixed(3)}% - ${3 + shift}px)`,
  };
}

// ─────────────────────────────── Состояния ───────────────────────────────────

const DONE = new Set(["completed", "partially_completed", "skipped"]);
const OPEN = new Set(["scheduled", "ready", "paused"]);
/** Те же, что `_IMMOVABLE_STATUSES` на бэкенде, плюс освобождённые. */
const IMMOVABLE = new Set(["completed", "partially_completed", "in_progress", "cancelled", "rescheduled"]);

export interface BlockState {
  /** Уже прошло или сделано: блок гаснет. */
  past: boolean;
  /** Идёт сейчас: тёмный блок. */
  onNow: boolean;
  done: boolean;
  missed: boolean;
  /** Сервер примет перенос: помощник может предложить новое время. */
  reschedulable: boolean;
  /** Можно тянуть мышью. Идущее сейчас нельзя: оно под рукой, а не лишнее. */
  movable: boolean;
}

export function lessonState(
  block: { start_at: string; duration_minutes: number; status: string; fixed: boolean },
  nowMs: number,
): BlockState {
  const start = Date.parse(block.start_at);
  const end = start + block.duration_minutes * 60_000;
  const running = block.status === "in_progress" || (OPEN.has(block.status) && nowMs >= start && nowMs < end);
  const done = DONE.has(block.status);
  const reschedulable = !block.fixed && !IMMOVABLE.has(block.status);
  return {
    past: !running && (done || end <= nowMs),
    onNow: running,
    done,
    missed: block.status === "missed",
    reschedulable,
    movable: reschedulable && !running,
  };
}

// ─────────────────────────── Занятия из своих рук ────────────────────────────

/**
 * Свой блок: разовая запись, которую ученик поставил нажатием на пустое место.
 *
 * Занятие программы создать напрямую нельзя, оно приходит из планировщика, поэтому
 * такой блок живёт как разовое занятое время. То же самое создаёт и помощник на просьбу
 * «поставь просто блок». Рисуется и двигается он как обычное занятие; школа и секции
 * остаются штриховкой.
 */
export function isOwnEvent(commitment: {
  kind: string;
  source: string;
  weekday: number | null;
  start_at: string | null;
  end_at: string | null;
}): boolean {
  return (
    commitment.weekday == null &&
    Boolean(commitment.start_at && commitment.end_at) &&
    commitment.kind === "other" &&
    commitment.source === "manual"
  );
}

// ─────────────────────────── Предпросмотр и перенос ──────────────────────────

interface EntryLike {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  duration_minutes: number;
}

export interface RevisionPreview<T> {
  entries: T[];
  /** Старое место переносимого занятия. */
  leaving: Set<string>;
  /** Где оно окажется. */
  ghosts: Set<string>;
  resizing: Set<string>;
}

export const GHOST_PREFIX = "ghost:";

/**
 * Что покажет сетка, пока предложение помощника ждёт ответа: старое место зачёркнуто,
 * новое обведено, у сокращённого уже новая длина. Календарь при этом не меняется, и
 * «Не надо» просто снимает предпросмотр.
 *
 * Занятия может не быть на экране (оно на другой неделе), а новое место есть: тогда
 * блок собирается из самого предложения. Нажать на него нельзя, поэтому остальных полей
 * ему не нужно.
 */
export function applyRevisionPreview<T extends EntryLike>(
  entries: readonly T[],
  diff: Partial<ScheduleDiff> | null | undefined,
): RevisionPreview<T> {
  const result: RevisionPreview<T> = {
    entries: [...entries],
    leaving: new Set(),
    ghosts: new Set(),
    resizing: new Set(),
  };
  if (!diff) return result;

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const ghost = (
    item: { block_id: string; title: string; to: { start_at: string; end_at: string; duration_minutes: number } },
  ) => {
    const id = `${GHOST_PREFIX}${item.block_id}`;
    const base = byId.get(item.block_id);
    result.ghosts.add(id);
    result.entries.push({
      ...(base ?? { calendar_entry: "learning_block", activity_type: "theory", status: "scheduled", fixed: false }),
      id,
      title: item.title,
      start_at: item.to.start_at,
      end_at: item.to.end_at,
      duration_minutes: item.to.duration_minutes,
    } as unknown as T);
  };

  const moved = new Set<string>();
  for (const item of diff.moved ?? []) {
    moved.add(item.block_id);
    if (byId.has(item.block_id)) result.leaving.add(item.block_id);
    ghost(item);
  }
  for (const item of [...(diff.shortened ?? []), ...(diff.extended ?? [])]) {
    // Перенесённый и укороченный уже нарисован с новой длиной на новом месте.
    if (moved.has(item.block_id)) continue;
    const base = byId.get(item.block_id);
    if (!base) continue;
    result.resizing.add(item.block_id);
    result.entries = result.entries.map((entry) =>
      entry.id === item.block_id
        ? { ...entry, end_at: item.to.end_at, duration_minutes: item.to.duration_minutes }
        : entry,
    );
  }
  for (const item of diff.created ?? []) ghost(item);
  for (const item of diff.removed ?? []) {
    if (byId.has(item.block_id)) result.leaving.add(item.block_id);
  }
  return result;
}

export interface DragOverride {
  id: string;
  startAt: string;
  durationMinutes: number;
}

/** Блок под мышью, а затем в ожидании ответа сервера, стоит там, куда его поставили. */
export function applyDragOverride<T extends EntryLike>(entries: readonly T[], override: DragOverride | null): T[] {
  if (!override) return [...entries];
  return entries.map((entry) =>
    entry.id === override.id
      ? {
          ...entry,
          start_at: override.startAt,
          end_at: new Date(Date.parse(override.startAt) + override.durationMinutes * 60_000).toISOString(),
          duration_minutes: override.durationMinutes,
        }
      : entry,
  );
}

// ─────────────────────────────── Сроки ───────────────────────────────────────

export interface Due {
  id: string;
  title: string;
  dateKey: string;
  /** Минуты от полуночи. `null` — срок на весь день. */
  minutes: number | null;
  href: string;
}

const CLOSED_GOALS = new Set(["done", "archived"]);

/**
 * Сроки из того, что ученик уже завёл: контрольные в дневнике, цели с датой, контесты,
 * экзамены. Ничего не придумывается: нет источника, нет и строки.
 */
export function buildDeadlines(input: {
  tests?: ReadonlyArray<{ dateKey: string; title: string }>;
  goals?: ReadonlyArray<{ id: string | number; title: string; status?: string; endDate?: string | null; dueDate?: string | null }>;
  contests?: ReadonlyArray<{ id: number | string; title: string; start_time: string }>;
  exams?: ReadonlyArray<{ id: string; title: string; start_at: string | null }>;
  timeZone: string;
}): Due[] {
  const list: Due[] = [];
  for (const test of input.tests ?? []) {
    list.push({ id: `test:${test.dateKey}:${test.title}`, title: test.title, dateKey: test.dateKey, minutes: null, href: "/dashboard/plan" });
  }
  for (const goal of input.goals ?? []) {
    const date = goal.dueDate || goal.endDate;
    if (!date || CLOSED_GOALS.has(goal.status ?? "")) continue;
    list.push({ id: `goal:${goal.id}`, title: goal.title, dateKey: date.slice(0, 10), minutes: null, href: "/dashboard/goals" });
  }
  for (const contest of input.contests ?? []) {
    list.push({
      id: `contest:${contest.id}`,
      title: contest.title,
      dateKey: zonedDateKey(contest.start_time, input.timeZone),
      minutes: zonedMinutes(contest.start_time, input.timeZone),
      href: "/dashboard/arena/solve",
    });
  }
  for (const exam of input.exams ?? []) {
    if (!exam.start_at) continue;
    list.push({
      id: `exam:${exam.id}`,
      title: exam.title,
      dateKey: zonedDateKey(exam.start_at, input.timeZone),
      minutes: zonedMinutes(exam.start_at, input.timeZone),
      href: "/dashboard/plan",
    });
  }
  return list.sort(
    (left, right) =>
      left.dateKey.localeCompare(right.dateKey) || (left.minutes ?? -1) - (right.minutes ?? -1) || left.title.localeCompare(right.title, "ru"),
  );
}

/** Карточка «Скоро»: только то, что ещё впереди. */
export function upcomingDeadlines(all: readonly Due[], todayKey: string, nowMinutes: number, limit = 4): Due[] {
  return all
    .filter((due) => due.dateKey > todayKey || (due.dateKey === todayKey && (due.minutes == null || due.minutes >= nowMinutes)))
    .slice(0, limit);
}

/** «завтра», «в пятницу, 6 ноября», «в субботу, в 11:00», «25 мая». */
export function soonWhen(due: Pick<Due, "dateKey" | "minutes">, todayKey: string): string {
  const at = due.minutes == null ? "" : `в ${clock(due.minutes)}`;
  if (due.dateKey === todayKey) return at ? `сегодня, ${at}` : "сегодня";
  if (due.dateKey === shiftDateKey(todayKey, 1)) return at ? `завтра, ${at}` : "завтра";
  if (due.dateKey < shiftDateKey(todayKey, 7)) {
    return `${weekdayOnLabel(weekdayOf(due.dateKey))}, ${at || dayMonth(due.dateKey)}`;
  }
  return dayMonth(due.dateKey);
}
