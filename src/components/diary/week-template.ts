// Неделя шаблона расписания: уроки по дням и всё, что с ними делает таблица. Без React и без
// запросов: страница `diary/schedule` хранит неделю и сохраняет её через `/api/diary/template`.
// Импорты с «.ts» и только типы через «@/»: ради `node --test` без сборщика.

import type { BlockType, DayOfWeek, TemplateLessonSlot } from "@/types/diary";

import { DAYS_ORDER } from "../../types/diary.ts";

/** Урок или блок шаблона. Тип и подпись есть всегда: у старых слотов их могло не быть. */
export interface SlotDraft extends TemplateLessonSlot {
  blockType: BlockType;
  label: string;
}

export type WeekDays = Record<DayOfWeek, SlotDraft[]>;

export interface SlotRef {
  day: DayOfWeek;
  id: string;
}

/** Что стоит на месте урока. Время принадлежит месту и при обмене не переезжает. */
export interface SlotContent {
  subjectId: string;
  blockType: BlockType;
  label: string;
}

export const BREAK_MINUTES = 10;
export const DEFAULT_MINUTES = 45;
export const DEFAULT_START = "08:30";
const DAY_END = 24 * 60;

export function toMinutes(clock: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec((clock ?? "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

export function toClock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** «08:05» → «8:05»: так время читается на карточках и в дневнике. */
export function shortClock(clock: string): string {
  return clock.replace(/^0(\d)/, "$1");
}

export function emptyWeek(): WeekDays {
  return Object.fromEntries(DAYS_ORDER.map((day) => [day, []])) as unknown as WeekDays;
}

/** Номер урока это его место в дне по времени: так считают редактор, дневник и тьютор. */
function ordered(day: SlotDraft[]): SlotDraft[] {
  return [...day]
    .sort(
      (left, right) =>
        (toMinutes(left.startTime) ?? DAY_END) - (toMinutes(right.startTime) ?? DAY_END) ||
        left.lessonNumber - right.lessonNumber,
    )
    .map((slot, index) => (slot.lessonNumber === index + 1 ? slot : { ...slot, lessonNumber: index + 1 }));
}

function withDay(week: WeekDays, day: DayOfWeek, slots: SlotDraft[]): WeekDays {
  return { ...week, [day]: ordered(slots) };
}

export function weekFrom(slots: TemplateLessonSlot[]): WeekDays {
  const week = emptyWeek();
  for (const slot of slots) {
    if (!week[slot.dayOfWeek]) continue;
    week[slot.dayOfWeek].push({ ...slot, blockType: slot.blockType || "lesson", label: slot.label ?? "" });
  }
  for (const day of DAYS_ORDER) week[day] = ordered(week[day]);
  return week;
}

export function slotsFrom(week: WeekDays): TemplateLessonSlot[] {
  return DAYS_ORDER.flatMap((day) =>
    ordered(week[day]).map((slot) => ({
      id: slot.id,
      dayOfWeek: day,
      lessonNumber: slot.lessonNumber,
      startTime: slot.startTime,
      endTime: slot.endTime,
      subjectId: slot.subjectId,
      blockType: slot.blockType,
      label: slot.label,
    })),
  );
}

export function sameWeek(left: WeekDays, right: WeekDays): boolean {
  return JSON.stringify(slotsFrom(left)) === JSON.stringify(slotsFrom(right));
}

export function dayRange(day: SlotDraft[]): string {
  if (!day.length) return "";
  return `${shortClock(day[0].startTime)}–${shortClock(day[day.length - 1].endTime)}`;
}

export function minutesOf(slot: Pick<SlotDraft, "startTime" | "endTime">): number {
  const start = toMinutes(slot.startTime);
  const end = toMinutes(slot.endTime);
  return start !== null && end !== null && end > start ? end - start : DEFAULT_MINUTES;
}

/** С чего чаще всего начинаются дни. Так первый урок нового дня встаёт туда, где его ждут. */
export function firstStart(week: WeekDays): string {
  const counts = new Map<string, number>();
  for (const day of DAYS_ORDER) {
    const first = week[day][0]?.startTime;
    if (first && toMinutes(first) !== null) counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  const best = Array.from(counts.entries()).sort(
    ([leftTime, leftCount], [rightTime, rightCount]) =>
      rightCount - leftCount || (toMinutes(leftTime) ?? 0) - (toMinutes(rightTime) ?? 0),
  )[0];
  return best?.[0] ?? DEFAULT_START;
}

/** Время следующего урока дня: через перемену после последнего, с его длительностью. */
function nextTimes(week: WeekDays, day: DayOfWeek, minutes?: number): { startTime: string; endTime: string } | null {
  const last = week[day][week[day].length - 1];
  const length = minutes ?? (last ? minutesOf(last) : DEFAULT_MINUTES);
  const start = last ? (toMinutes(last.endTime) ?? 0) + BREAK_MINUTES : (toMinutes(firstStart(week)) ?? 0);
  if (start + length >= DAY_END) return null;
  return { startTime: toClock(start), endTime: toClock(start + length) };
}

export function addLesson(
  week: WeekDays,
  day: DayOfWeek,
  content: SlotContent,
  newId: () => string,
): { week: WeekDays; id: string | null } {
  const times = nextTimes(week, day);
  if (!times) return { week, id: null };
  const id = newId();
  const slot: SlotDraft = { id, dayOfWeek: day, lessonNumber: week[day].length + 1, ...times, ...content };
  return { week: withDay(week, day, [...week[day], slot]), id };
}

function update(week: WeekDays, ref: SlotRef, change: (slot: SlotDraft) => SlotDraft): WeekDays {
  if (!week[ref.day].some((slot) => slot.id === ref.id)) return week;
  return withDay(week, ref.day, week[ref.day].map((slot) => (slot.id === ref.id ? change(slot) : slot)));
}

/**
 * Новое время урока. `shiftFollowing`: уроки, которые шли после него, сдвигаются на столько же,
 * на сколько сдвинулся его конец, и перемены между ними остаются прежними.
 */
export function retime(week: WeekDays, ref: SlotRef, startTime: string, endTime: string, shiftFollowing: boolean): WeekDays {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  const current = week[ref.day].find((slot) => slot.id === ref.id);
  if (!current || start === null || end === null || end <= start) return week;

  const oldEnd = toMinutes(current.endTime);
  const delta = oldEnd === null ? 0 : end - oldEnd;
  const shifted = (slot: SlotDraft): SlotDraft => {
    const from = toMinutes(slot.startTime);
    const to = toMinutes(slot.endTime);
    if (!shiftFollowing || !delta || oldEnd === null || from === null || to === null || from < oldEnd) return slot;
    if (from + delta < 0 || to + delta >= DAY_END) return slot;
    return { ...slot, startTime: toClock(from + delta), endTime: toClock(to + delta) };
  };
  return withDay(
    week,
    ref.day,
    week[ref.day].map((slot) =>
      slot.id === ref.id ? { ...slot, startTime: toClock(start), endTime: toClock(end) } : shifted(slot),
    ),
  );
}

export function setContent(week: WeekDays, ref: SlotRef, content: SlotContent): WeekDays {
  return update(week, ref, (slot) => ({ ...slot, ...content }));
}

export function removeLesson(week: WeekDays, ref: SlotRef): WeekDays {
  return withDay(week, ref.day, week[ref.day].filter((slot) => slot.id !== ref.id));
}

function contentOf(slot: SlotDraft): SlotContent {
  return { subjectId: slot.subjectId, blockType: slot.blockType, label: slot.label };
}

/** Два урока меняются местами: предмет и вид блока переезжают, время остаётся у мест. */
export function swapLessons(week: WeekDays, first: SlotRef, second: SlotRef): WeekDays {
  const a = week[first.day].find((slot) => slot.id === first.id);
  const b = week[second.day].find((slot) => slot.id === second.id);
  if (!a || !b || a === b) return week;
  return update(update(week, first, (slot) => ({ ...slot, ...contentOf(b) })), second, (slot) => ({ ...slot, ...contentOf(a) }));
}

/** Урок уходит в конец другого дня, через перемену после последнего урока, со своей длительностью. */
export function moveToDay(week: WeekDays, from: SlotRef, day: DayOfWeek): WeekDays {
  const slot = week[from.day].find((row) => row.id === from.id);
  if (!slot || from.day === day) return week;
  const times = nextTimes(week, day, minutesOf(slot));
  if (!times) return week;
  const moved: SlotDraft = { ...slot, dayOfWeek: day, ...times };
  return withDay(removeLesson(week, from), day, [...week[day], moved]);
}

/** Копия дня целиком заменяет выбранные дни. У копий свои идентификаторы. */
export function copyDay(week: WeekDays, from: DayOfWeek, to: DayOfWeek[], newId: () => string): WeekDays {
  let next = week;
  for (const day of to) {
    if (day === from) continue;
    next = withDay(next, day, week[from].map((slot) => ({ ...slot, id: newId(), dayOfWeek: day })));
  }
  return next;
}

export function clearDay(week: WeekDays, day: DayOfWeek): WeekDays {
  return { ...week, [day]: [] };
}
