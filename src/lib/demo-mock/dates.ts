// Сдвиг дат в снятых данных демо, чтобы «сегодня» снимка стало сегодняшним днём.
//
// Расписание (уроки, блоки учёбы) сдвигается целыми неделями: так понедельник
// остаётся понедельником, а школа не уезжает на выходные. Всё остальное — на число
// дней от дня съёмки: серия привычки обрывается вчера, тема к повторению ждёт
// сегодня, контест начнётся через те же пять дней.

// Не `\b`: в «2026-11-10T15:00:00Z» между «10» и «T» границы слова нет.
const DATE = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
const MS_PER_DAY = 86_400_000;

function utcDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Дата YYYY-MM-DD плюс `days` календарных дней. */
export function addDays(iso: string, days: number): string {
  return formatDay(utcDay(iso) + days * MS_PER_DAY);
}

/** Сколько дней от `from` до `to` (обе YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcDay(to) - utcDay(from)) / MS_PER_DAY);
}

/** Понедельник недели, в которую попадает дата. */
export function mondayOf(iso: string): string {
  const weekday = new Date(utcDay(iso)).getUTCDay(); // 0 — воскресенье
  return addDays(iso, -((weekday + 6) % 7));
}

/** Сегодняшняя дата YYYY-MM-DD в указанном часовом поясе. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export interface DemoShift {
  /** На сколько дней сдвигать всё, кроме расписания. */
  days: number;
  /** На сколько дней (кратно 7) сдвигать расписание. */
  weeks: number;
}

export function computeShift(capturedToday: string, today: string): DemoShift {
  return {
    days: daysBetween(capturedToday, today),
    weeks: daysBetween(mondayOf(capturedToday), mondayOf(today)),
  };
}

/** Сдвигает все даты внутри строки: и «2026-11-10», и «2026-11-10T15:00:00Z». */
export function shiftString(value: string, days: number): string {
  if (!days) return value;
  return value.replace(DATE, (match) => {
    const shifted = addDays(match, days);
    return Number.isNaN(Date.parse(shifted)) ? match : shifted;
  });
}

/** Глубокая копия с датами, сдвинутыми на `days`, в значениях и в ключах. */
export function shiftDates<T>(value: T, days: number): T {
  if (!days) return value;
  if (typeof value === "string") return shiftString(value, days) as T;
  if (Array.isArray(value)) return value.map((item) => shiftDates(item, days)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[shiftString(key, days)] = shiftDates(item, days);
    }
    return out as T;
  }
  return value;
}
