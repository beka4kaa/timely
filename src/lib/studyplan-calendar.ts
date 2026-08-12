// Геометрия календаря: моменты времени ↔ пиксели сетки.
//
// Весь пересчёт зон живёт здесь и только здесь. Причина та же, что на бэкенде
// (`studyplan/scheduling/slots.py`): расписание хранится в UTC, но ритм задан
// СТЕННЫМИ часами ученика, и зона расписания не обязана совпадать с зоной
// браузера. Ученик из Алматы, открывший свой календарь в поездке, обязан
// увидеть те же 17:00, а не «19:00 по местному».
//
// Поэтому ни одна функция здесь не пользуется `Date#getHours()` и прочими
// методами локального времени: они молча берут зону браузера. Всё идёт через
// `Intl.DateTimeFormat` с явной зоной.

/** Высота часа в пикселях. Сорокапятиминутное занятие получает 42 px. */
export const HOUR_HEIGHT = 56;

/** Шаг притягивания при перетаскивании. Минута точности здесь ложная. */
export const SNAP_MINUTES = 5;

/** Короче этого блок не бывает — то же правило, что у бэкенда. */
export const MIN_BLOCK_MINUTES = 15;

const MINUTES_IN_DAY = 24 * 60;

/**
 * Шкала — всегда сутки целиком, 00:00–24:00.
 *
 * Раньше она подстраивалась под данные и экономила экран, но ломала главное
 * свойство календаря — постоянство. Одно и то же занятие оказывалось то у
 * верхнего края, то посередине; перетащить блок на семь утра было нельзя, пока
 * семи утра не было на шкале; а после отмены единственного вечернего занятия
 * сетка перестраивалась целиком. Пустые часы решаются прокруткой, а не
 * обрезкой суток.
 */
const FULL_DAY: VisibleRange = { startMinutes: 0, endMinutes: MINUTES_IN_DAY };

export interface CalendarBlock {
  id: string;
  title: string;
  /** ISO-момент в UTC, как его отдаёт DRF. */
  start_at: string;
  end_at: string;
  duration_minutes: number;
  activity_type: string;
  status: string;
  fixed: boolean;
  detail_level: string;
  source: string;
  topic: string | null;
  review_step: number | null;
  objective?: string;
}

export interface PositionedBlock<T extends CalendarBlock = CalendarBlock> {
  block: T;
  /** Отступ сверху в пикселях от начала видимой шкалы. */
  top: number;
  height: number;
  startMinutes: number;
  endMinutes: number;
  /** Дорожка при наложении и сколько их всего в этой группе. */
  lane: number;
  lanes: number;
}

export interface DayColumn<T extends CalendarBlock = CalendarBlock> {
  /** «2026-08-17» в зоне расписания. */
  dateKey: string;
  /** 0 — понедельник, как на бэкенде. */
  weekday: number;
  blocks: PositionedBlock<T>[];
}

export interface VisibleRange {
  startMinutes: number;
  endMinutes: number;
}

// ─────────────────────────── Зоны и ключи дней ───────────────────────────────

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let cached = partsCache.get(timeZone);
  if (!cached) {
    cached = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(timeZone, cached);
  }
  return cached;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatter(timeZone).formatToParts(instant);
  const pick = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  // `hour12: false` в некоторых зонах печатает полночь как 24 — приводим к 0,
  // иначе полночь оказалась бы концом суток вместо их начала.
  const hour = pick("hour") % 24;
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour,
    minute: pick("minute"),
    second: pick("second"),
  };
}

function pad(value: number, size = 2): string {
  return String(value).padStart(size, "0");
}

/** «2026-08-17» — календарная дата момента в заданной зоне. */
export function zonedDateKey(instant: Date | string, timeZone: string): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  const parts = zonedParts(date, timeZone);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** Минуты от полуночи в заданной зоне. */
export function zonedMinutes(instant: Date | string, timeZone: string): number {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  const parts = zonedParts(date, timeZone);
  return parts.hour * 60 + parts.minute;
}

/** День недели по-европейски: 0 — понедельник. */
export function zonedWeekday(instant: Date | string, timeZone: string): number {
  return weekdayOf(zonedDateKey(instant, timeZone));
}

function offsetMillis(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - instant.getTime();
}

/**
 * (дата + минуты от полуночи) в зоне расписания → момент времени.
 *
 * Обратное преобразование неоднозначно по своей природе, поэтому смещение
 * уточняется дважды: первая догадка берёт смещение «как будто это UTC», вторая
 * — смещение, действующее в полученный момент. Без второго шага перенос блока
 * в день перевода часов уезжал бы на час.
 */
export function toInstant(
  dateKey: string,
  minutes: number,
  timeZone: string,
): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const wallClock = Date.UTC(
    year,
    (month ?? 1) - 1,
    day ?? 1,
    0,
    Math.round(minutes),
  );

  const firstGuess = new Date(wallClock - offsetMillis(new Date(wallClock), timeZone));
  const corrected = wallClock - offsetMillis(firstGuess, timeZone);
  return new Date(corrected);
}

/** Понедельник = 0. Считается по календарной дате, без участия зоны. */
export function weekdayOf(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1)).getUTCDay();
  return (weekday + 6) % 7;
}

/** Сдвиг календарной даты на целые сутки. Зона не участвует — это арифметика дат. */
export function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, (month ?? 1) - 1, (day ?? 1) + days));
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(
    shifted.getUTCMonth() + 1,
  )}-${pad(shifted.getUTCDate())}`;
}

/** Семь дат недели, начиная с понедельника, в которую попадает `dateKey`. */
export function weekDays(dateKey: string): string[] {
  const monday = shiftDateKey(dateKey, -weekdayOf(dateKey));
  return Array.from({ length: 7 }, (_, index) => shiftDateKey(monday, index));
}

// ──────────────────────────────── Шкала ──────────────────────────────────────

/** Округление к шагу сетки. */
export function snapMinutes(minutes: number, step = SNAP_MINUTES): number {
  return Math.round(minutes / step) * step;
}

export function clampMinutes(minutes: number): number {
  return Math.min(MINUTES_IN_DAY, Math.max(0, minutes));
}

export function minutesToOffset(minutes: number, rangeStart: number): number {
  return ((minutes - rangeStart) / 60) * HOUR_HEIGHT;
}

export function offsetToMinutes(offset: number, rangeStart: number): number {
  return rangeStart + (offset / HOUR_HEIGHT) * 60;
}

export function formatMinutes(minutes: number): string {
  const normalized = ((Math.round(minutes) % MINUTES_IN_DAY) + MINUTES_IN_DAY) %
    MINUTES_IN_DAY;
  return `${pad(Math.floor(normalized / 60))}:${pad(normalized % 60)}`;
}

/**
 * Какие часы показывать.
 *
 * Считается по данным, а не задаётся константой: сутки целиком — это экран, на
 * три четверти состоящий из пустоты, и занятия в нём теряются. Полный день
 * всё равно достижим прокруткой, потому что диапазон расширяется под любой
 * блок, который в него не помещается.
 */
export function visibleRange(
  blocks: CalendarBlock[],
  timeZone: string,
): VisibleRange {
  // Аргументы больше не влияют на результат: шкала всегда сутки. Сигнатура
  // сохранена намеренно — её зовут четыре места, и превращать вызов в
  // константу пришлось бы в каждом, а смысл «какой отрезок суток показываем»
  // остаётся за этой функцией.
  void blocks;
  void timeZone;
  return { ...FULL_DAY };
}

export function hourMarks(range: VisibleRange): number[] {
  const marks: number[] = [];
  for (
    let minutes = Math.ceil(range.startMinutes / 60) * 60;
    minutes <= range.endMinutes;
    minutes += 60
  ) {
    marks.push(minutes);
  }
  return marks;
}

/**
 * Получасовые засечки — те же, что у часов, но между ними.
 *
 * Нужны, чтобы сорокапятиминутное занятие читалось по сетке, а не на глаз.
 * Отдаются отдельно от часов: рисуются они тоньше и светлее, и подписи у них
 * нет — вторая колонка цифр рядом с часами только мешала бы.
 */
export function halfHourMarks(range: VisibleRange): number[] {
  const marks: number[] = [];
  const first = Math.ceil((range.startMinutes - 30) / 60) * 60 + 30;
  for (let minutes = first; minutes < range.endMinutes; minutes += 60) {
    if (minutes > range.startMinutes) marks.push(minutes);
  }
  return marks;
}

// ─────────────────────────────── Раскладка ───────────────────────────────────

/**
 * Дорожки для пересекающихся блоков.
 *
 * Бэкенд пересечений не создаёт, но между предложением ревизии и её
 * подтверждением, а также при рассинхроне вкладок они появиться могут. Без
 * дорожек два блока просто наложились бы друг на друга, и ученик увидел бы
 * один вместо двух.
 */
function assignLanes<T extends CalendarBlock>(
  entries: { block: T; startMinutes: number; endMinutes: number }[],
): PositionedBlock<T>[] {
  const sorted = [...entries].sort(
    (a, b) => a.startMinutes - b.startMinutes || a.block.id.localeCompare(b.block.id),
  );

  const result: PositionedBlock<T>[] = [];
  let group: PositionedBlock<T>[] = [];
  let groupEnd = Number.NEGATIVE_INFINITY;

  const closeGroup = () => {
    const lanes = group.reduce((max, item) => Math.max(max, item.lane + 1), 1);
    for (const item of group) item.lanes = lanes;
    result.push(...group);
    group = [];
    groupEnd = Number.NEGATIVE_INFINITY;
  };

  for (const entry of sorted) {
    if (entry.startMinutes >= groupEnd && group.length > 0) closeGroup();

    const busy = new Set(
      group
        .filter((item) => item.endMinutes > entry.startMinutes)
        .map((item) => item.lane),
    );
    let lane = 0;
    while (busy.has(lane)) lane += 1;

    group.push({
      block: entry.block,
      startMinutes: entry.startMinutes,
      endMinutes: entry.endMinutes,
      lane,
      lanes: 1,
      top: 0,
      height: 0,
    });
    groupEnd = Math.max(groupEnd, entry.endMinutes);
  }
  if (group.length > 0) closeGroup();

  return result;
}

/** Разложить блоки по колонкам недели и посчитать их пиксельные габариты. */
export function layoutWeek<T extends CalendarBlock>(
  blocks: T[],
  options: { timeZone: string; days: string[]; range: VisibleRange },
): DayColumn<T>[] {
  const { timeZone, days, range } = options;
  const byDay = new Map<string, { block: T; startMinutes: number; endMinutes: number }[]>();

  for (const block of blocks) {
    const dateKey = zonedDateKey(block.start_at, timeZone);
    if (!days.includes(dateKey)) continue;
    const startMinutes = zonedMinutes(block.start_at, timeZone);
    const entry = {
      block,
      startMinutes,
      // Считаем по длительности, а не по `end_at`: занятие через полночь иначе
      // получило бы отрицательную высоту.
      endMinutes: startMinutes + block.duration_minutes,
    };
    const bucket = byDay.get(dateKey);
    if (bucket) bucket.push(entry);
    else byDay.set(dateKey, [entry]);
  }

  return days.map((dateKey) => {
    const positioned = assignLanes(byDay.get(dateKey) ?? []);
    for (const item of positioned) {
      item.top = minutesToOffset(item.startMinutes, range.startMinutes);
      item.height = Math.max(
        (MIN_BLOCK_MINUTES / 60) * HOUR_HEIGHT,
        ((item.endMinutes - item.startMinutes) / 60) * HOUR_HEIGHT,
      );
    }
    return { dateKey, weekday: weekdayOf(dateKey), blocks: positioned };
  });
}

/**
 * Положение метки «сейчас» на шкале. `null` — сегодня не в этой неделе или
 * текущее время за пределами видимого диапазона.
 */
export function currentTimeOffset(
  now: Date,
  options: { timeZone: string; days: string[]; range: VisibleRange },
): { dateKey: string; offset: number } | null {
  const dateKey = zonedDateKey(now, options.timeZone);
  if (!options.days.includes(dateKey)) return null;

  const minutes = zonedMinutes(now, options.timeZone);
  if (minutes < options.range.startMinutes || minutes > options.range.endMinutes) {
    return null;
  }
  return { dateKey, offset: minutesToOffset(minutes, options.range.startMinutes) };
}

/**
 * Куда встанет блок после перетаскивания.
 *
 * Возвращает момент времени, а не «сдвиг на N минут»: сдвиг в UTC пережил бы
 * перевод часов неправильно, а стенное время — правильно.
 */
export function dropTarget(options: {
  dateKey: string;
  offset: number;
  range: VisibleRange;
  timeZone: string;
  durationMinutes: number;
}): { startAt: Date; startMinutes: number } {
  const raw = offsetToMinutes(options.offset, options.range.startMinutes);
  const snapped = clampMinutes(
    Math.min(snapMinutes(raw), MINUTES_IN_DAY - options.durationMinutes),
  );
  return {
    startAt: toInstant(options.dateKey, snapped, options.timeZone),
    startMinutes: snapped,
  };
}

/** Новая длительность после растягивания за нижний край. */
export function resizeTarget(options: {
  startMinutes: number;
  offsetBottom: number;
  range: VisibleRange;
}): number {
  const end = offsetToMinutes(options.offsetBottom, options.range.startMinutes);
  const minutes = snapMinutes(end - options.startMinutes);
  return Math.max(MIN_BLOCK_MINUTES, Math.min(minutes, MINUTES_IN_DAY - options.startMinutes));
}
