// «В план»: где в плане есть место под задание из дневника.
//
// Блоки плана создаёт только генератор расписания. Создать учебный блок напрямую
// нельзя, поэтому задание встаёт в план разовым занятым временем: тем же, чем становится
// «просто блок», если попросить о нём помощника (см. режим plan в бэкенде). Планировщик
// такое время обходит, план и главная его показывают, удаляется оно одной кнопкой.
//
// Модуль без React и без запросов, поэтому покрыт тестами (`diary-plan.test.ts`).
// Импорты с «.ts» — ради `node --test` без сборщика.

import { dayPhrase, daysBetween, parseClock } from "./now-feed.ts";
import { formatMinutes, shiftDateKey, toInstant, weekdayOf, zonedDateKey, zonedMinutes } from "./studyplan-calendar.ts";

/** Столько времени ставим на одно задание, как в согласованном прототипе. */
export const TASK_MINUTES = 30;
const STEP_MINUTES = 15;
/** Запас, чтобы не поставить занятие на уже идущую минуту. */
const LEAD_MINUTES = 5;
/** Если ритма нет или в нём нет места: вторая половина дня, после школы. */
const AFTERNOON = { start: 15 * 60, end: 21 * 60 };

export interface TimeSpan {
  start: number;
  end: number;
}

export interface RhythmWindow {
  /** 0 — понедельник. */
  weekday: number;
  start: number;
  minutes: number;
}

export interface PlanSlot {
  dateKey: string;
  start: Date;
  end: Date;
}

export interface SlotSearch {
  now: Date;
  timeZone: string;
  /** Окна ритма: только в них стоят занятия плана. */
  rhythm: RhythmWindow[];
  /** Занятое: блоки плана, занятость, уроки. */
  busy: TimeSpan[];
  /** Занятие должно закончиться до этого момента: начала урока, к которому задание. */
  deadline: Date;
  minutes?: number;
}

function overlaps(start: number, end: number, busy: TimeSpan[]): boolean {
  return busy.some((span) => span.start < end && span.end > start);
}

function search(
  input: SlotSearch,
  today: string,
  lastDay: string,
  windowsOf: (dateKey: string) => Array<{ start: number; end: number }>,
): PlanSlot | null {
  const minutes = input.minutes ?? TASK_MINUTES;
  const earliest = input.now.getTime() + LEAD_MINUTES * 60_000;
  const deadline = input.deadline.getTime();

  for (let day = today; day <= lastDay; day = shiftDateKey(day, 1)) {
    const windows = [...windowsOf(day)].sort((left, right) => left.start - right.start);
    for (const window of windows) {
      for (let at = window.start; at + minutes <= window.end; at += STEP_MINUTES) {
        const start = toInstant(day, at, input.timeZone).getTime();
        const end = start + minutes * 60_000;
        if (start < earliest) continue;
        if (end > deadline) return null;
        if (overlaps(start, end, input.busy)) continue;
        return { dateKey: day, start: new Date(start), end: new Date(end) };
      }
    }
  }
  return null;
}

/**
 * Первое свободное окно до сдачи.
 *
 * Сначала ищем в окнах ритма: это время ученик сам отвёл на занятия. Они часто заняты
 * программой целиком, и тогда берём вторую половину дня. `null` значит, что до сдачи
 * места нет, и говорить об этом нужно прямо, а не ставить задание после урока.
 */
export function firstFreeSlot(input: SlotSearch): PlanSlot | null {
  const today = zonedDateKey(input.now, input.timeZone);
  const lastDay = zonedDateKey(input.deadline, input.timeZone);
  if (lastDay < today) return null;

  if (input.rhythm.length) {
    const inRhythm = search(input, today, lastDay, (dateKey) =>
      input.rhythm
        .filter((window) => window.weekday === weekdayOf(dateKey))
        .map((window) => ({ start: window.start, end: window.start + window.minutes })),
    );
    if (inRhythm) return inRhythm;
  }
  return search(input, today, lastDay, () => [AFTERNOON]);
}

/** Уроки дня как занятое время: школу в занятость вносят не все. */
export function lessonSpans(
  date: string,
  lessons: Array<{ startTime: string; endTime: string }>,
  timeZone: string,
): TimeSpan[] {
  const spans: TimeSpan[] = [];
  for (const lesson of lessons) {
    const start = parseClock(lesson.startTime);
    const end = parseClock(lesson.endTime);
    if (start === null || end === null || end <= start) continue;
    spans.push({
      start: toInstant(date, start, timeZone).getTime(),
      end: toInstant(date, end, timeZone).getTime(),
    });
  }
  return spans;
}

/** Окна ритма из шаблона: `start_time` приходит как «17:00:00». */
export function rhythmWindows(
  slots: Array<{ weekday: number; start_time: string; duration_minutes: number }>,
): RhythmWindow[] {
  const windows: RhythmWindow[] = [];
  for (const slot of slots) {
    const start = parseClock(slot.start_time);
    if (start === null || slot.duration_minutes <= 0) continue;
    windows.push({ weekday: slot.weekday, start, minutes: slot.duration_minutes });
  }
  return windows;
}

// ───────────────────────── Связь задания с планом ────────────────────────────

/** Поле `title` у занятости ограничено 200 символами. */
const TITLE_LIMIT = 200;
/** Дальше этого связь задания с блоком в плане уже случайное совпадение текста. */
const LINK_HORIZON_DAYS = 21;

export function planTitle(taskTitle: string): string {
  return taskTitle.length > TITLE_LIMIT ? `${taskTitle.slice(0, TITLE_LIMIT - 1)}…` : taskTitle;
}

export interface PlannedEntry {
  id: string;
  title: string;
  start_at: string | null;
  weekday: number | null;
}

/**
 * Стоит ли задание в плане.
 *
 * Отдельной связи между дневником и занятостью в данных нет, поэтому сверяем название
 * и дату. Удалили блок на плане — задание снова можно поставить: подпись показывает то,
 * что есть на самом деле, а не то, что ученик когда-то нажал.
 */
export function plannedEntryFor<T extends PlannedEntry>(
  entries: T[],
  taskTitle: string,
  dueDate: string,
  timeZone: string,
): T | null {
  const title = planTitle(taskTitle);
  for (const entry of entries) {
    if (entry.weekday !== null || !entry.start_at || entry.title !== title) continue;
    const distance = daysBetween(zonedDateKey(entry.start_at, timeZone), dueDate);
    if (distance >= 0 && distance <= LINK_HORIZON_DAYS) return entry;
  }
  return null;
}

/** «сегодня в 17:15», «в пятницу в 16:00». */
export function planWhenLabel(start: Date | string, today: string, timeZone: string): string {
  const day = dayPhrase(zonedDateKey(start, timeZone), today);
  return `${day} в ${formatMinutes(zonedMinutes(start, timeZone))}`;
}
