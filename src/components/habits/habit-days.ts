// Что считается на карточке привычки: день ученика, квадратики, серия, цвет и значок.
// Без React и без сети, чтобы всё это проверялось тестами.

import type { IconName } from "@/components/shell/icons";

export interface CalDay {
  date: string;
  done: boolean;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  return b >= 2 && b <= 4 ? few : many;
}

export function streakWord(n: number): string {
  return `${plural(n, "день", "дня", "дней")} подряд`;
}

/** Сегодняшний день там, где сейчас ученик. `toISOString` дал бы день по UTC. */
export function localDay(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Понедельник это 0: неделя на карточке идёт сверху вниз с понедельника. */
function weekdayOf(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

export interface DayCell {
  key: string;
  /** Квадратик настоящего дня. Остальные пустые: неделя ещё не кончилась. */
  real: boolean;
  done: boolean;
  today: boolean;
}

/**
 * Календарь в столбцы по неделям.
 *
 * Сервер отдаёт ровно N дней, поэтому самая старая неделя обычно неполная: она срезается,
 * иначе столбец начинался бы не с понедельника. Последний день в календаре это сегодня.
 */
export function weekCells(calendar: readonly CalDay[]): DayCell[] {
  if (calendar.length === 0) return [];
  const skip = (7 - weekdayOf(calendar[0].date)) % 7;
  const days = calendar.length > skip ? calendar.slice(skip) : calendar;
  const lastIndex = days.length - 1;
  const cells: DayCell[] = [];
  for (let blank = weekdayOf(days[0].date); blank > 0; blank -= 1) {
    cells.push({ key: `before-${blank}`, real: false, done: false, today: false });
  }
  days.forEach((day, index) => {
    cells.push({ key: day.date, real: true, done: day.done, today: index === lastIndex });
  });
  for (let rest = 6 - weekdayOf(days[lastIndex].date); rest > 0; rest -= 1) {
    cells.push({ key: `after-${rest}`, real: false, done: false, today: false });
  }
  return cells;
}

/**
 * Серия так же, как считает сервер: идём назад от сегодня или вчера, а пропуски
 * закрывают «щиты» из `freezeBudget`. Нужна, чтобы число перекатилось сразу после
 * нажатия, не дожидаясь ответа.
 */
function chainOf(calendar: readonly CalDay[], freezeBudget: number): number {
  let cursor = calendar.length - 1;
  if (cursor >= 0 && !calendar[cursor].done) cursor -= 1;
  if (cursor < 0 || !calendar[cursor].done) return 0;
  const oldest = calendar.findIndex((day) => day.done);
  let streak = 0;
  let shields = 0;
  while (cursor >= oldest) {
    if (calendar[cursor].done) streak += 1;
    else if (shields < freezeBudget) shields += 1;
    else break;
    cursor -= 1;
  }
  return streak;
}

export interface MarkedDays {
  calendar: CalDay[];
  streak: number;
}

/**
 * Отметка за сегодня до ответа сервера. Серию меняем на разницу, а не считаем заново:
 * настоящая серия может быть длиннее окна календаря.
 */
export function markToday(
  calendar: readonly CalDay[],
  streak: number,
  freezeBudget: number,
  done: boolean,
): MarkedDays {
  const next = calendar.map((day, index) => (index === calendar.length - 1 ? { ...day, done } : day));
  const delta = chainOf(next, freezeBudget) - chainOf(calendar, freezeBudget);
  return { calendar: next, streak: Math.max(0, streak + delta) };
}

const ICONS: Array<[RegExp, IconName]> = [
  [/чита|книг/, "book"],
  [/слов|англ|язык/, "languages"],
  [/задач|математ|алгебр|физик/, "sigma"],
  [/спать|сон|лечь|ложиться|встава/, "moon"],
  [/заряд|спорт|бег|трениров|отжим|зал/, "dumbbell"],
  [/повтор/, "target"],
];

/** Значок по названию. Подошло несколько: берём последнее, как в прототипе. `null`: покажем эмодзи. */
export function habitIcon(name: string): IconName | null {
  const lower = name.toLowerCase();
  let icon: IconName | null = null;
  for (const [pattern, candidate] of ICONS) {
    if (pattern.test(lower)) icon = candidate;
  }
  return icon;
}

const PALETTE: ReadonlyArray<readonly [string, string]> = [
  ["#8f7dff", "#4a2bd6"],
  ["#ff7ab8", "#b92fd0"],
  ["#45c6ff", "#2b66f5"],
  ["#3fe0a2", "#07907a"],
  ["#7f8dff", "#27286b"],
  ["#ffa144", "#f0442f"],
  ["#c6e84f", "#4aa53a"],
];

/**
 * Два конца заливки. В `Habit.color` хранится один цвет: для своей палитры второй известен,
 * у старых привычек он получается затемнением.
 */
export function habitColors(color: string, id: number): { h1: string; h2: string } {
  const valid = /^#[0-9a-f]{6}$/i.test(color);
  const h1 = valid ? color.toLowerCase() : PALETTE[Math.abs(id) % PALETTE.length][0];
  const pair = PALETTE.find(([first]) => first === h1);
  return { h1, h2: pair ? pair[1] : `color-mix(in srgb, ${h1} 62%, #0b0a2a)` };
}

/** Цвет для новой привычки: сначала тот, которого ещё нет на странице. */
export function nextHabitColor(taken: readonly string[]): string {
  const used = new Set(taken.map((color) => color.toLowerCase()));
  const free = PALETTE.find(([first]) => !used.has(first));
  return (free ?? PALETTE[taken.length % PALETTE.length])[0];
}
