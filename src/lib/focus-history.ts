// История занятий помодоро: дни и разбор одного дня.
//
// Всё считается из тех же записей, что пишет таймер: каждая завершённая фаза фокуса или
// отдыха длиной от минуты. День — местный день браузера, как у карточек на странице таймера.

import { dayKey, isLongBreakRow, type FocusSessionRow } from "./pomodoro";
import { clockTime } from "./pomodoro.logic";

export interface HistoryDay {
  key: string;
  focusSeconds: number;
  restSeconds: number;
  blocks: number;
}

/** Дни, когда человек занимался, от свежих к старым. Дни с одним отдыхом не считаются. */
export function buildHistoryDays(sessions: FocusSessionRow[]): HistoryDay[] {
  const days = new Map<string, HistoryDay>();
  for (const session of sessions) {
    const key = dayKey(new Date(session.started_at));
    const day = days.get(key) ?? { key, focusSeconds: 0, restSeconds: 0, blocks: 0 };
    if (session.kind === "focus") {
      day.focusSeconds += session.seconds;
      day.blocks += 1;
    } else {
      day.restSeconds += session.seconds;
    }
    days.set(key, day);
  }
  return Array.from(days.values())
    .filter((day) => day.blocks > 0)
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
}

export interface DayPart {
  id: number;
  kind: "focus" | "rest";
  /** Номер блока занятий по порядку. У отдыха его нет. */
  number: number | null;
  startedAt: string;
  start: string;
  end: string;
  seconds: number;
  long: boolean;
  stoppedEarly: boolean;
}

export interface DayDetail {
  key: string;
  focusSeconds: number;
  restSeconds: number;
  blocks: number;
  /** Блоки и отдых по порядку, с утра к вечеру. */
  parts: DayPart[];
  /** Начало первой фазы и конец последней, в мс: границы ленты дня. */
  from: number;
  to: number;
}

export function buildDayDetail(sessions: FocusSessionRow[], key: string): DayDetail | null {
  const own = sessions
    .filter((session) => dayKey(new Date(session.started_at)) === key)
    .sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
  if (!own.some((session) => session.kind === "focus")) return null;

  let number = 0;
  const parts = own.map<DayPart>((session) => {
    const begin = new Date(session.started_at);
    const finish = new Date(begin.getTime() + session.seconds * 1000);
    const focus = session.kind === "focus";
    if (focus) number += 1;
    return {
      id: session.id,
      kind: focus ? "focus" : "rest",
      number: focus ? number : null,
      startedAt: session.started_at,
      start: clockTime(begin),
      end: clockTime(finish),
      seconds: session.seconds,
      long: isLongBreakRow(session),
      stoppedEarly: session.seconds < session.planned_seconds,
    };
  });

  const from = new Date(own[0].started_at).getTime();
  const to = Math.max(...own.map((session) => new Date(session.started_at).getTime() + session.seconds * 1000));
  const sum = (kind: DayPart["kind"]) =>
    parts.filter((part) => part.kind === kind).reduce((total, part) => total + part.seconds, 0);

  return { key, focusSeconds: sum("focus"), restSeconds: sum("rest"), blocks: number, parts, from, to };
}

/** Где на ленте дня лежит фаза: отступ и ширина в процентах. */
export function ribbonSpan(part: Pick<DayPart, "startedAt" | "seconds">, from: number, to: number) {
  const total = Math.max(1, to - from);
  const start = new Date(part.startedAt).getTime() - from;
  const left = Math.max(0, Math.min(100, (start / total) * 100));
  const width = Math.max(0, Math.min(100 - left, ((part.seconds * 1000) / total) * 100));
  return { left, width };
}

function plural(count: number, one: string, few: string, many: string): string {
  const hundred = count % 100;
  const ten = count % 10;
  if (hundred >= 11 && hundred <= 14) return many;
  if (ten === 1) return one;
  if (ten >= 2 && ten <= 4) return few;
  return many;
}

/** «2 часа 40 минут», «50 минут», «1 час». Полными словами: так читается без расшифровки. */
export function durationWords(seconds: number): string {
  const minutes = Math.round(Math.max(0, seconds) / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourText = hours ? `${hours} ${plural(hours, "час", "часа", "часов")}` : "";
  const minuteText = rest || !hours ? `${rest} ${plural(rest, "минута", "минуты", "минут")}` : "";
  return [hourText, minuteText].filter(Boolean).join(" ");
}

export function blocksWord(count: number): string {
  return `${count} ${plural(count, "блок", "блока", "блоков")}`;
}

const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const WEEKDAYS = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];

function parseKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** «Сегодня», «Вчера» или «Вторник, 17 ноября»; год только у прошлых лет. */
export function dayTitle(key: string, today: Date = new Date()): string {
  const todayKey = dayKey(today);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (key === todayKey) return "Сегодня";
  if (key === dayKey(yesterday)) return "Вчера";
  const date = parseKey(key);
  const year = date.getFullYear() === today.getFullYear() ? "" : ` ${date.getFullYear()}`;
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]}${year}`;
}

/** Ключ дня из адреса: только настоящая дата `YYYY-MM-DD`. */
export function isDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return dayKey(parseKey(value)) === value;
}

/** Сколько дней истории нужно загрузить, чтобы день `key` попал в окно. */
export function daysBack(key: string, today: Date = new Date()): number {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diff = Math.round((start.getTime() - parseKey(key).getTime()) / 86_400_000);
  return Math.max(2, Math.min(400, diff + 2));
}
