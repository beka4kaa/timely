// Чистые функции, которые превращают агрегаты бэкенда в данные для графиков.
// Вынесены отдельно от компонентов, чтобы покрыть тестами без рендера React.

import {
  CHART_DAYS,
  DAY_GOAL_MIN,
  HEAT_WEEKS,
  RU_DAYS,
  RU_MONTHS,
  type FocusSessionRow,
  dayKey,
  hm,
  presetAt,
} from "./pomodoro";

/** Пять ступеней насыщенности календаря активности. */
export const HEAT_COLORS = [
  "#ece6db", // без занятий
  "#eed9b6", // < 30 мин
  "#d9ad70", // < 75 мин
  "#b8823a", // < 135 мин
  "#855c22", // больше
] as const;

export function heatLevel(seconds: number): number {
  if (!seconds) return 0;
  const minutes = seconds / 60;
  if (minutes < 30) return 1;
  if (minutes < 75) return 2;
  if (minutes < 135) return 3;
  return 4;
}

export function heatColor(seconds: number): string {
  return HEAT_COLORS[heatLevel(seconds)];
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function secondsOn(daily: Record<string, number>, date: Date): number {
  return daily[dayKey(date)] ?? 0;
}

export interface HeatCell {
  key: string;
  date: Date;
  seconds: number;
  color: string;
  isToday: boolean;
  isFuture: boolean;
  tooltipTitle: string;
  tooltipSub: string;
}

export interface HeatWeek {
  key: string;
  month: string;
  days: HeatCell[];
}

function longDateLabel(date: Date): string {
  return date.toLocaleDateString("ru-RU", {
    weekday: "short",
    day: "numeric",
    month: "long",
  });
}

/**
 * Сетка календаря активности: колонки — недели, строки — дни недели.
 * Сетка всегда начинается с понедельника, будущие дни остаются пустыми.
 */
export function buildHeatWeeks(
  daily: Record<string, number>,
  today: Date,
  weeks: number = HEAT_WEEKS,
): HeatWeek[] {
  const todayStart = startOfDay(today);
  const todayKey = dayKey(todayStart);

  // Сетка заканчивается воскресеньем текущей недели, поэтому последняя колонка
  // всегда содержит сегодняшний день (и до шести пустых дней вперёд), а первая
  // колонка при таком сдвиге ровно попадает на понедельник.
  const weekdayIndex = (todayStart.getDay() + 6) % 7; // пн = 0 … вс = 6
  const endOfWeek = addDays(todayStart, 6 - weekdayIndex);
  let cursor = addDays(endOfWeek, -(weeks * 7 - 1));

  const result: HeatWeek[] = [];
  let lastMonth = -1;

  for (let week = 0; week < weeks; week += 1) {
    const days: HeatCell[] = [];
    let month = "";

    for (let index = 0; index < 7; index += 1) {
      const date = new Date(cursor);
      const isFuture = date > todayStart;
      const seconds = isFuture ? 0 : secondsOn(daily, date);

      if (index === 0 && !isFuture && date.getMonth() !== lastMonth) {
        lastMonth = date.getMonth();
        month = RU_MONTHS[date.getMonth()];
      }

      days.push({
        key: dayKey(date),
        date,
        seconds,
        color: isFuture ? "transparent" : heatColor(seconds),
        isToday: dayKey(date) === todayKey,
        isFuture,
        tooltipTitle: seconds > 0 ? `${hm(seconds)} учёбы` : "Без занятий",
        tooltipSub: longDateLabel(date),
      });

      cursor = addDays(cursor, 1);
    }

    result.push({ key: days[0].key, month, days });
  }

  return result;
}

export interface HeatStats {
  activeDays: number;
  totalSeconds: number;
  best: { label: string; seconds: number } | null;
}

/** Итоговая строка под календарём: активные дни, всего, лучший день. */
export function summarizeHeat(weeks: HeatWeek[]): HeatStats {
  let activeDays = 0;
  let totalSeconds = 0;
  let best: HeatCell | null = null;

  // Обычный цикл, а не forEach: TypeScript не отслеживает присваивания внутри
  // колбэка и сузил бы тип `best` до `never`.
  for (const week of weeks) {
    for (const cell of week.days) {
      if (cell.isFuture) continue;
      totalSeconds += cell.seconds;
      if (cell.seconds === 0) continue;
      activeDays += 1;
      if (best === null || cell.seconds > best.seconds) best = cell;
    }
  }

  return {
    activeDays,
    totalSeconds,
    best: best
      ? {
          label: best.date.toLocaleDateString("ru-RU", {
            day: "numeric",
            month: "long",
          }),
          seconds: best.seconds,
        }
      : null,
  };
}

export interface DayBar {
  key: string;
  date: Date;
  seconds: number;
  /** Доля от максимума в наборе, 0..1 — компонент сам переводит в пиксели. */
  ratio: number;
  label: string;
  isToday: boolean;
  reachedGoal: boolean;
  tooltipTitle: string;
  tooltipSub: string;
}

function buildBars(
  daily: Record<string, number>,
  today: Date,
  days: number,
  label: (date: Date) => string,
  minMaxSeconds: number,
): DayBar[] {
  const todayStart = startOfDay(today);
  const rows = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = addDays(todayStart, -offset);
    rows.push({ date, seconds: secondsOn(daily, date), isToday: offset === 0 });
  }

  const max = Math.max(minMaxSeconds, ...rows.map((row) => row.seconds));

  return rows.map((row) => ({
    key: dayKey(row.date),
    date: row.date,
    seconds: row.seconds,
    ratio: max > 0 ? row.seconds / max : 0,
    label: label(row.date),
    isToday: row.isToday,
    reachedGoal: row.seconds >= DAY_GOAL_MIN * 60,
    tooltipTitle: row.seconds > 0 ? `${hm(row.seconds)} учёбы` : "Без занятий",
    tooltipSub: longDateLabel(row.date),
  }));
}

/** Последние 7 дней — подписи днями недели. */
export function buildWeekBars(
  daily: Record<string, number>,
  today: Date,
): DayBar[] {
  return buildBars(daily, today, 7, (date) => RU_DAYS[date.getDay()], 60 * 60);
}

/** Последний 21 день — подписи числами месяца. */
export function buildChartBars(
  daily: Record<string, number>,
  today: Date,
  days: number = CHART_DAYS,
): DayBar[] {
  return buildBars(daily, today, days, (date) => String(date.getDate()), 60 * 60);
}

export function sumSeconds(bars: DayBar[]): number {
  return bars.reduce((total, bar) => total + bar.seconds, 0);
}

export interface HistoryRow {
  id: number;
  time: string;
  title: string;
  meta: string;
  duration: string;
  isFocus: boolean;
  /** Сколько из пяти делений заполнено — доля выполненной фазы. */
  filledDots: number;
}

/** Строки таблицы «История сессий» — по убыванию времени начала. */
export function buildHistoryRows(sessions: FocusSessionRow[]): HistoryRow[] {
  return sessions
    .slice()
    .sort(
      (a, b) =>
        new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
    )
    .map((session) => {
      const date = new Date(session.started_at);
      const isFocus = session.kind === "focus";
      const planned = session.planned_seconds || session.seconds || 1;
      const completed = session.seconds >= session.planned_seconds;

      return {
        id: session.id,
        time:
          String(date.getHours()).padStart(2, "0") +
          ":" +
          String(date.getMinutes()).padStart(2, "0"),
        title: isFocus ? "Фокус-сессия" : "Перерыв",
        meta:
          `${session.preset_focus_min}/${session.preset_break_min} · ` +
          (completed ? "завершено полностью" : "остановлено раньше"),
        duration: hm(session.seconds),
        isFocus,
        filledDots: Math.max(
          1,
          Math.min(5, Math.round((session.seconds / planned) * 5)),
        ),
      };
    });
}

export interface TodayStats {
  focusSeconds: number;
  focusCount: number;
  breakCount: number;
  goalPercent: number;
}

/** Карточка «Сегодня». `liveSeconds` — незавершённая текущая фаза фокуса. */
export function buildTodayStats(
  sessions: FocusSessionRow[],
  liveSeconds: number = 0,
): TodayStats {
  const focus = sessions.filter((session) => session.kind === "focus");
  const focusSeconds =
    focus.reduce((total, session) => total + session.seconds, 0) + liveSeconds;

  return {
    focusSeconds,
    focusCount: focus.length,
    breakCount: sessions.length - focus.length,
    goalPercent: Math.min(
      100,
      Math.round((focusSeconds / (DAY_GOAL_MIN * 60)) * 100),
    ),
  };
}

/** Подпись ритма для текущей сессии, например «50/10». */
export function presetLabel(presetIndex: number): string {
  const preset = presetAt(presetIndex);
  return `${preset.focus}/${preset.brk}`;
}
