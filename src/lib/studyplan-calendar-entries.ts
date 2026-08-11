import {
  type CalendarBlock,
  toInstant,
  weekdayOf,
} from "./studyplan-calendar.ts";
import { OCCUPIED_ACCENT } from "./studyplan-visuals.ts";

export type CalendarScheduleStatus =
  | "draft"
  | "proposed"
  | "confirmed"
  | "active"
  | "completed"
  | "archived";

export interface CalendarScheduleLike {
  id: string;
  course_plan: string;
  status: CalendarScheduleStatus;
  version: number;
  timezone: string;
  created_at: string;
  feasible?: boolean;
}

export interface FixedCommitmentLike {
  id: string;
  kind: string;
  title: string;
  weekday: number | null;
  start_time: string | null;
  duration_minutes: number;
  valid_from: string | null;
  valid_until: string | null;
  start_at: string | null;
  end_at: string | null;
  source: string;
  source_text?: string;
}

export interface CommitmentCalendarEntry extends CalendarBlock {
  calendar_entry: "commitment";
  commitment_id: string;
  commitment_kind: string;
  commitment_source: string;
}

export interface LearningCalendarEntryFields {
  calendar_entry: "learning_block";
  course_plan_title: string;
  schedule_status: CalendarScheduleStatus;
  schedule_version: number;
  schedule_timezone: string;
}

export type StudyCalendarEntry<T extends CalendarBlock = CalendarBlock> =
  | (T & LearningCalendarEntryFields)
  | CommitmentCalendarEntry;

export function isCommitmentEntry<T extends CalendarBlock>(
  entry: StudyCalendarEntry<T>,
): entry is CommitmentCalendarEntry {
  return entry.calendar_entry === "commitment";
}

/**
 * Выбирает ровно одну видимую версию расписания каждого курса.
 *
 * Новейшая выполнимая версия временно заменяет более старую в календаре.
 * Обычно это предложение поверх активного плана; невыполнимый черновик старый
 * рабочий календарь не прячет. Выбор совпадает с единой лентой бэкенда и не
 * даёт одинаковым занятиям лечь друг на друга.
 */
export function selectVisibleSchedules<T extends CalendarScheduleLike>(
  schedules: T[],
): T[] {
  const grouped = new Map<string, T[]>();
  for (const schedule of schedules) {
    if (schedule.status === "archived" || schedule.status === "completed") {
      continue;
    }
    const group = grouped.get(schedule.course_plan);
    if (group) group.push(schedule);
    else grouped.set(schedule.course_plan, [schedule]);
  }

  return Array.from(grouped.values())
    .map((group) => {
      const feasible = group.filter((schedule) => schedule.feasible !== false);
      const candidates = feasible.length > 0 ? feasible : group;
      return [...candidates].sort(compareCalendarSchedules)[0];
    })
    .sort((left, right) => left.course_plan.localeCompare(right.course_plan));
}

/** Единая зона календаря: зона самой свежей видимой программы. */
export function calendarTimeZone(
  schedules: CalendarScheduleLike[],
  fallback: string,
): string {
  const newest = [...schedules].sort(compareCalendarSchedules)[0];
  return newest?.timezone || fallback;
}

const SCHEDULE_STATUS_PRIORITY: Record<CalendarScheduleStatus, number> = {
  proposed: 4,
  draft: 3,
  active: 2,
  confirmed: 1,
  completed: 0,
  archived: 0,
};

/** Тот же детерминированный порядок, что использует backend calendar feed. */
export function compareCalendarSchedules<T extends CalendarScheduleLike>(
  left: T,
  right: T,
): number {
  const created = Date.parse(right.created_at) - Date.parse(left.created_at);
  if (Number.isFinite(created) && created !== 0) return created;

  const status =
    SCHEDULE_STATUS_PRIORITY[right.status] -
    SCHEDULE_STATUS_PRIORITY[left.status];
  if (status !== 0) return status;

  if (left.id === right.id) return 0;
  return left.id < right.id ? -1 : 1;
}

/** Разворачивает повторяющуюся занятость только на показанные дни недели. */
export function expandCommitments(
  commitments: FixedCommitmentLike[],
  days: string[],
  timeZone: string,
): CommitmentCalendarEntry[] {
  const entries: CommitmentCalendarEntry[] = [];

  for (const commitment of commitments) {
    if (
      commitment.weekday != null &&
      commitment.start_time &&
      commitment.duration_minutes > 0
    ) {
      const startMinutes = parseClockMinutes(commitment.start_time);
      if (startMinutes == null) continue;

      for (const day of days) {
        if (weekdayOf(day) !== commitment.weekday) continue;
        if (commitment.valid_from && day < commitment.valid_from) continue;
        if (commitment.valid_until && day > commitment.valid_until) continue;

        const start = toInstant(day, startMinutes, timeZone);
        entries.push(
          commitmentEntry(
            commitment,
            `${commitment.id}:${day}`,
            start,
            commitment.duration_minutes,
          ),
        );
      }
      continue;
    }

    if (!commitment.start_at || !commitment.end_at) continue;
    const start = new Date(commitment.start_at);
    const end = new Date(commitment.end_at);
    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end <= start
    ) {
      continue;
    }

    // Разовое событие может пересечь полночь или границу недели. Режем его на
    // видимые дневные фрагменты, чтобы воскресенье 23:00–понедельник 01:00 не
    // исчезло только потому, что началось за пределами текущей недели.
    for (const day of days) {
      const dayStart = toInstant(day, 0, timeZone);
      const dayEnd = toInstant(day, 24 * 60, timeZone);
      const visibleStart = new Date(Math.max(start.getTime(), dayStart.getTime()));
      const visibleEnd = new Date(Math.min(end.getTime(), dayEnd.getTime()));
      const duration = Math.round(
        (visibleEnd.getTime() - visibleStart.getTime()) / 60_000,
      );
      if (duration <= 0) continue;
      entries.push(
        commitmentEntry(
          commitment,
          `${commitment.id}:${day}`,
          visibleStart,
          duration,
        ),
      );
    }
  }

  return entries.sort(
    (left, right) =>
      Date.parse(left.start_at) - Date.parse(right.start_at) ||
      left.id.localeCompare(right.id),
  );
}

function parseClockMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function commitmentEntry(
  commitment: FixedCommitmentLike,
  occurrenceId: string,
  start: Date,
  durationMinutes: number,
): CommitmentCalendarEntry {
  return {
    id: `commitment:${occurrenceId}`,
    calendar_entry: "commitment",
    commitment_id: commitment.id,
    commitment_kind: commitment.kind,
    commitment_source: commitment.source,
    title: commitment.title,
    objective: commitment.source_text || "",
    start_at: start.toISOString(),
    end_at: new Date(start.getTime() + durationMinutes * 60_000).toISOString(),
    duration_minutes: durationMinutes,
    activity_type: `commitment_${commitment.kind}`,
    status: "scheduled",
    fixed: true,
    detail_level: "detailed",
    source: commitment.source,
    topic: null,
    review_step: null,
  };
}

const COURSE_ACCENTS = [
  "#8a5b24",
  "#4f6d5a",
  "#5c668f",
  "#8a5361",
  "#57717a",
  "#756246",
] as const;

/** Узкий маркер курса; заливка блока по-прежнему обозначает тип занятия. */
export function courseAccent(coursePlanId: string): string {
  let hash = 2166136261;
  for (let index = 0; index < coursePlanId.length; index += 1) {
    hash ^= coursePlanId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return COURSE_ACCENTS[(hash >>> 0) % COURSE_ACCENTS.length];
}

/**
 * Раздаёт цвета программам по порядку, а не по хешу.
 *
 * `courseAccent` берёт хеш по модулю шести, и у любой пары курсов примерно один
 * шанс из шести оказаться одного цвета. Для подписи в списке это терпимо, но
 * когда цветом кодируется предмет в календаре, два одинаковых курса ломают всё
 * правило. По списку программ цвета гарантированно различаются, пока курсов не
 * больше шести.
 */
export function buildCourseAccents(coursePlanIds: string[]): Map<string, string> {
  const accents = new Map<string, string>();
  for (const id of coursePlanIds) {
    if (accents.has(id)) continue;
    accents.set(id, COURSE_ACCENTS[accents.size % COURSE_ACCENTS.length]);
  }
  return accents;
}

/**
 * Цвет записи календаря: курс — своим, занятое время — нейтральным.
 *
 * Один источник на всех, кто красит записи: блок в сетке, строка в дневном
 * списке и лента нагрузки под числом дня. Считай кто-то из них цвет сам —
 * полоска под днём рано или поздно разошлась бы с самим блоком.
 *
 * Без карты цветов откатывается на хеш: календарь должен рисоваться и до того,
 * как список программ доехал.
 */
export function entryAccent<T extends CalendarBlock & { course_plan: string }>(
  entry: StudyCalendarEntry<T>,
  accents?: Map<string, string>,
): string {
  if (isCommitmentEntry(entry)) return OCCUPIED_ACCENT;
  return accents?.get(entry.course_plan) ?? courseAccent(entry.course_plan);
}

export function commitmentKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    school: "Школа",
    tutor: "Репетитор",
    exam: "Экзамен",
    family: "Семейное",
    other: "Занятое время",
  };
  return labels[kind] ?? "Занятое время";
}
