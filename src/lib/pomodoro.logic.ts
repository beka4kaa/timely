// Чистые функции, которые превращают агрегаты бэкенда в данные для графиков.
// Вынесены отдельно от компонентов, чтобы покрыть тестами без рендера React.

import {
  DAY_GOAL_MIN,
  HEAT_WEEKS,
  RU_DAYS,
  type FocusSessionRow,
  type PomodoroPhase,
  dayKey,
  hm,
} from "./pomodoro";

/** Пять ступеней насыщенности календаря активности: классы `.h0`…`.h4`. */
export function heatLevel(seconds: number): number {
  if (!seconds) return 0;
  const minutes = seconds / 60;
  if (minutes < 30) return 1;
  if (minutes < 75) return 2;
  if (minutes < 135) return 3;
  return 4;
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
  level: number;
  isToday: boolean;
  isFuture: boolean;
  tooltipTitle: string;
  tooltipSub: string;
}

export interface HeatWeek {
  key: string;
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

  for (let week = 0; week < weeks; week += 1) {
    const days: HeatCell[] = [];

    for (let index = 0; index < 7; index += 1) {
      const date = new Date(cursor);
      const isFuture = date > todayStart;
      const seconds = isFuture ? 0 : secondsOn(daily, date);

      days.push({
        key: dayKey(date),
        date,
        seconds,
        level: heatLevel(seconds),
        isToday: dayKey(date) === todayKey,
        isFuture,
        tooltipTitle: seconds > 0 ? `${hm(seconds)} учёбы` : "Без занятий",
        tooltipSub: longDateLabel(date),
      });

      cursor = addDays(cursor, 1);
    }

    result.push({ key: days[0].key, days });
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

export function sumSeconds(bars: DayBar[]): number {
  return bars.reduce((total, bar) => total + bar.seconds, 0);
}

export interface HistoryRow {
  id: number;
  time: string;
  isFocus: boolean;
  startedAt: string;
  minutes: number;
  stoppedEarly: boolean;
}

/** Строки списка сессий — по убыванию времени начала. */
export function buildHistoryRows(sessions: FocusSessionRow[]): HistoryRow[] {
  return sessions
    .slice()
    .sort(
      (a, b) =>
        new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
    )
    .map((session) => ({
      id: session.id,
      time: clockTime(new Date(session.started_at)),
      isFocus: session.kind === "focus",
      startedAt: session.started_at,
      minutes: Math.round(session.seconds / 60),
      stoppedEarly: session.seconds < session.planned_seconds,
    }));
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

function minutesWord(count: number): string {
  const hundred = count % 100;
  const ten = hundred % 10;
  if (hundred > 10 && hundred < 20) return "минут";
  if (ten === 1) return "минута";
  if (ten >= 2 && ten <= 4) return "минуты";
  return "минут";
}

/** «16:55» в зоне браузера. */
export function clockTime(date: Date): string {
  return (
    String(date.getHours()).padStart(2, "0") +
    ":" +
    String(date.getMinutes()).padStart(2, "0")
  );
}

export interface DialTick {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
}

const DIAL_CENTER = 140;
const DIAL_OUTER = 136;
const DIAL_INNER = 118;
const DIAL_INNER_LONG = 111;

/**
 * Циферблат: одна чёрточка на минуту, каждая пятая длиннее. Чем минут больше, тем чёрточки
 * тоньше, чтобы они не слипались и в коротком перерыве, и в полуторачасовом марафоне.
 */
export function dialTicks(plannedSeconds: number): DialTick[] {
  const count = Math.max(1, Math.round(plannedSeconds / 60));
  const width = Number(Math.max(2.4, Math.min(6, 190 / count)).toFixed(1));
  const round = (value: number) => Number(value.toFixed(2));
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * 2 * Math.PI - Math.PI / 2;
    const inner = index % 5 === 0 ? DIAL_INNER_LONG : DIAL_INNER;
    return {
      x1: round(DIAL_CENTER + inner * Math.cos(angle)),
      y1: round(DIAL_CENTER + inner * Math.sin(angle)),
      x2: round(DIAL_CENTER + DIAL_OUTER * Math.cos(angle)),
      y2: round(DIAL_CENTER + DIAL_OUTER * Math.sin(angle)),
      width,
    };
  });
}

/** Прошедшие минуты гаснут, идущая дышит. */
export function tickClass(index: number, elapsedSeconds: number, remainingSeconds: number): string {
  const gone = Math.floor(elapsedSeconds / 60);
  if (index < gone) return "gone";
  return index === gone && remainingSeconds > 0 ? "now" : "";
}

/** Подпись под цифрами: когда закончится, на паузе, или сколько будет идти. */
export function dialSubtitle({
  phase,
  running,
  remaining,
  planned,
  now,
}: {
  phase: PomodoroPhase;
  running: boolean;
  remaining: number;
  planned: number;
  /** Момент, от которого считать конец, epoch ms. */
  now: number;
}): string {
  const end = clockTime(new Date(now + remaining * 1000));
  if (running) return phase === "break" ? `перерыв, до ${end}` : `до ${end}`;
  if (remaining < planned) return `пауза, до ${end}`;
  const minutes = Math.round(planned / 60);
  const length = `${minutes} ${minutesWord(minutes)}`;
  return phase === "break" ? `перерыв ${length}` : length;
}

/** Имя сессии хранится по моменту начала: сервер отдаёт его в другой записи, чем принял. */
export function sessionKey(startedAt: string): string {
  return String(new Date(startedAt).getTime());
}

/** Запоминает имя сессии. Старые забываются первыми, чтобы хранилище не росло вечно. */
export function withSessionName(
  names: Record<string, string>,
  startedAt: string,
  name: string,
  limit = 200,
): Record<string, string> {
  const key = sessionKey(startedAt);
  const clean = name.trim();
  if (!clean || names[key]) return names;
  const entries = Object.entries({ ...names, [key]: clean });
  if (entries.length <= limit) return Object.fromEntries(entries);
  entries.sort(([a], [b]) => Number(a) - Number(b));
  return Object.fromEntries(entries.slice(entries.length - limit));
}
