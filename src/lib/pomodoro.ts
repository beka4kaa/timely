// Общие типы, пресеты и форматирование для помодоро-трекера.

export type PomodoroPhase = "focus" | "break";

export interface PomodoroPreset {
  focus: number;
  brk: number;
  note: string;
  desc: string;
}

export const PRESETS: PomodoroPreset[] = [
  { focus: 25, brk: 5, note: "классика", desc: "Короткие подходы, частые паузы" },
  { focus: 50, brk: 10, note: "глубоко", desc: "Стандарт для длинных тем" },
  { focus: 60, brk: 10, note: "долго", desc: "Час без отвлечений" },
  { focus: 90, brk: 20, note: "марафон", desc: "Полный цикл концентрации" },
  { focus: 45, brk: 15, note: "мягко", desc: "Умеренно, с большой паузой" },
];

export const DEFAULT_PRESET_INDEX = 1;

/** Цель дня в минутах чистого времени учёбы. */
export const DAY_GOAL_MIN = 180;

/** Сессии короче минуты в историю не попадают. */
export const MIN_LOGGED_SECONDS = 60;

export const HEAT_WEEKS = 52;
export const CHART_DAYS = 21;

export const RU_MONTHS = [
  "янв", "фев", "мар", "апр", "май", "июн",
  "июл", "авг", "сен", "окт", "ноя", "дек",
];

export const RU_DAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

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
    ? `${hours} ч ${String(minutes % 60).padStart(2, "0")} м`
    : `${minutes} м`;
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
  const mod100 = days % 100;
  const mod10 = days % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${days} дней`;
  if (mod10 === 1) return `${days} день`;
  if (mod10 >= 2 && mod10 <= 4) return `${days} дня`;
  return `${days} дней`;
}

/** Смещение часового пояса для бэкенда (как `Date.getTimezoneOffset()`). */
export function timezoneOffsetMinutes(now: Date = new Date()): number {
  return now.getTimezoneOffset();
}

export function presetAt(index: number): PomodoroPreset {
  return PRESETS[index] ?? PRESETS[DEFAULT_PRESET_INDEX];
}

/** Длина фазы в секундах для выбранного пресета. */
export function phaseDurationSeconds(
  presetIndex: number,
  phase: PomodoroPhase,
): number {
  const preset = presetAt(presetIndex);
  return (phase === "focus" ? preset.focus : preset.brk) * 60;
}
