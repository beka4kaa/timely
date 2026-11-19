// Общие типы, пресеты и форматирование для помодоро-трекера.

import { msg, plural, t } from "./i18n";

/** Что хранит бэкенд: длинный перерыв уходит туда обычным перерывом. */
export type PomodoroPhase = "focus" | "break";

/** Фазы самого таймера. */
export type TimerPhase = "focus" | "break" | "long";

/** Ритм: фокус, перерыв и длинный перерыв в минутах, длинный после каждых `every` фокусов. */
export interface Rhythm {
  focus: number;
  brk: number;
  long: number;
  every: number;
}

export interface PomodoroPreset extends Rhythm {
  note: string;
  desc: string;
}

// Порядок не менять: выбранный ритм хранится в браузере индексом.
export const PRESETS: PomodoroPreset[] = [
  { focus: 25, brk: 5, long: 15, every: 4, note: msg("классика"), desc: msg("Короткие подходы, частые паузы") },
  { focus: 50, brk: 10, long: 30, every: 3, note: msg("глубоко"), desc: msg("Стандарт для длинных тем") },
  { focus: 60, brk: 10, long: 30, every: 3, note: msg("долго"), desc: msg("Час без отвлечений") },
  { focus: 90, brk: 20, long: 30, every: 2, note: msg("марафон"), desc: msg("Полный цикл концентрации") },
  { focus: 45, brk: 15, long: 30, every: 3, note: msg("мягко"), desc: msg("Умеренно, с большой паузой") },
];

export const DEFAULT_PRESET_INDEX = 1;

/** Индекс «Своё» в сторе: свой ритм лежит отдельно от пресетов. */
export const CUSTOM_PRESET = -1;

/** Цель дня в минутах чистого времени учёбы. */
export const DAY_GOAL_MIN = 180;

/** Сессии короче минуты в историю не попадают. */
export const MIN_LOGGED_SECONDS = 60;

export const HEAT_WEEKS = 52;

export const RU_DAYS = [msg("вс"), msg("пн"), msg("вт"), msg("ср"), msg("чт"), msg("пт"), msg("сб")];

/** Строка от бэкенда: одна завершённая фаза. */
export interface FocusSessionRow {
  id: number;
  kind: PomodoroPhase;
  started_at: string;
  seconds: number;
  planned_seconds: number;
  preset_focus_min: number;
  preset_break_min: number;
}

/** Тело запроса на создание сессии. */
export interface FocusSessionPayload {
  kind: PomodoroPhase;
  started_at: string;
  seconds: number;
  planned_seconds: number;
  preset_focus_min: number;
  preset_break_min: number;
}

/** Ответ `GET /api/pomodoro/sessions/summary/`. */
export interface PomodoroSummary {
  daily: Record<string, number>;
  streak: number;
  active_days: number;
  total_seconds: number;
  best_day: { date: string; seconds: number } | null;
}

export const EMPTY_SUMMARY: PomodoroSummary = {
  daily: {},
  streak: 0,
  active_days: 0,
  total_seconds: 0,
  best_day: null,
};

/** Ключ локального дня `YYYY-MM-DD` — совпадает с форматом бэкенда. */
export function dayKey(date: Date): string {
  return (
    date.getFullYear() +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0")
  );
}

/** «2 ч 40 м» или «40 м». */
export function hm(totalSeconds: number): string {
  const minutes = Math.round(Math.max(0, totalSeconds) / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0
    ? t("{h} ч {m} м", { h: hours, m: String(minutes % 60).padStart(2, "0") })
    : t("{m} м", { m: minutes });
}

/** «MM:SS» для циферблата. */
export function clockOf(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return (
    String(Math.floor(safe / 60)).padStart(2, "0") +
    ":" +
    String(safe % 60).padStart(2, "0")
  );
}

/** «1 день» / «3 дня» / «7 дней». */
export function streakLabel(days: number): string {
  return plural(days, "{n} день", "{n} дня", "{n} дней");
}

/** Смещение часового пояса для бэкенда (как `Date.getTimezoneOffset()`). */
export function timezoneOffsetMinutes(now: Date = new Date()): number {
  return now.getTimezoneOffset();
}

export function presetAt(index: number): PomodoroPreset {
  return PRESETS[index] ?? PRESETS[DEFAULT_PRESET_INDEX];
}

/**
 * Длинный ли это перерыв. Отдельного вида на сервере нет, но длина пресета у сессии
 * хранится, а длинный перерыв длиннее обычного в своём же ритме.
 */
export function isLongBreakRow(row: Pick<FocusSessionRow, "kind" | "planned_seconds" | "preset_break_min">): boolean {
  return row.kind === "break" && row.planned_seconds > row.preset_break_min * 60;
}
