// Как часто делать привычку: каждый день, по дням недели или раз в несколько дней.
//
// Что сегодня стоит по расписанию и какая серия, считает сервер. Здесь черновик для выбора
// и подписи на карточке. Без React и без сети, чтобы всё это проверялось тестами.

import { msg, t } from "../../lib/i18n";
import { plural, weekdayOf } from "./habit-days";

export type HabitFrequency = "daily" | "weekdays" | "interval";

export interface HabitSchedule {
  frequency: HabitFrequency;
  /** Понедельник это 0. */
  weekdays: number[];
  intervalDays: number;
}

/** Так частота выглядит в API. */
export interface SchedulePatch {
  frequency: HabitFrequency;
  weekdays: number[];
  interval_days: number;
}

export const MIN_INTERVAL_DAYS = 2;
export const MAX_INTERVAL_DAYS = 30;
export const WEEK_DAYS: readonly number[] = [0, 1, 2, 3, 4];
export const WEEKEND: readonly number[] = [5, 6];
export const DAY_NAMES = [msg("Пн"), msg("Вт"), msg("Ср"), msg("Чт"), msg("Пт"), msg("Сб"), msg("Вс")] as const;
export const DAY_FULL_NAMES = [msg("Понедельник"), msg("Вторник"), msg("Среда"), msg("Четверг"), msg("Пятница"), msg("Суббота"), msg("Воскресенье")] as const;

const BY_DAY = [msg("понедельникам"), msg("вторникам"), msg("средам"), msg("четвергам"), msg("пятницам"), msg("субботам"), msg("воскресеньям")];
const ON_DAY = [msg("в понедельник"), msg("во вторник"), msg("в среду"), msg("в четверг"), msg("в пятницу"), msg("в субботу"), msg("в воскресенье")];
/** С чего начать, когда ученик только открыл дни недели: одним нажатием уже годится. */
const FIRST_DAYS: readonly number[] = [0, 2, 4];

export const EVERY_DAY: HabitSchedule = { frequency: "daily", weekdays: [], intervalDays: MIN_INTERVAL_DAYS };

const tidy = (days: readonly number[]) => Array.from(new Set(days)).sort((a, b) => a - b);
const sameDays = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((day, i) => day === b[i]);

/** Из ответа сервера или предложения помощника. Старые записи про частоту не знают. */
export function scheduleOf(raw: Partial<SchedulePatch>): HabitSchedule {
  return {
    frequency: raw.frequency ?? "daily",
    weekdays: raw.weekdays ?? [],
    intervalDays: raw.interval_days ?? MIN_INTERVAL_DAYS,
  };
}

/** Для записи: от черновика остаётся только то, что нужно выбранному варианту. */
export function schedulePatch(schedule: HabitSchedule): SchedulePatch {
  const days = tidy(schedule.weekdays);
  if (schedule.frequency === "weekdays" && days.length > 0 && days.length < 7) {
    return { frequency: "weekdays", weekdays: days, interval_days: MIN_INTERVAL_DAYS };
  }
  if (schedule.frequency === "interval") {
    const interval_days = Math.min(MAX_INTERVAL_DAYS, Math.max(MIN_INTERVAL_DAYS, schedule.intervalDays));
    return { frequency: "interval", weekdays: [], interval_days };
  }
  return { frequency: "daily", weekdays: [], interval_days: MIN_INTERVAL_DAYS };
}

export function sameSchedule(a: HabitSchedule, b: HabitSchedule): boolean {
  const left = schedulePatch(a);
  const right = schedulePatch(b);
  return (
    left.frequency === right.frequency &&
    left.interval_days === right.interval_days &&
    sameDays(left.weekdays, right.weekdays)
  );
}

export function withFrequency(schedule: HabitSchedule, frequency: HabitFrequency): HabitSchedule {
  if (frequency === "weekdays" && schedule.weekdays.length === 0) {
    return { ...schedule, frequency, weekdays: [...FIRST_DAYS] };
  }
  return { ...schedule, frequency };
}

/** Последний выбранный день не снимается: привычка без дней никогда не наступит. */
export function toggleDay(schedule: HabitSchedule, day: number): HabitSchedule {
  const on = schedule.weekdays.includes(day);
  if (on && schedule.weekdays.length === 1) return schedule;
  const weekdays = on ? schedule.weekdays.filter((row) => row !== day) : tidy([...schedule.weekdays, day]);
  return { ...schedule, weekdays };
}

/** С большой буквы, как подпись. В середине фразы её опускает `toLowerCase`. */
export function scheduleLabel(schedule: HabitSchedule): string {
  const { frequency, weekdays, interval_days: days } = schedulePatch(schedule);
  if (frequency === "interval") {
    if (days === 2) return t("Через день");
    if (days === 7) return t("Раз в неделю");
    return t("Раз в {days} {word}", { days, word: plural(days, "день", "дня", "дней") });
  }
  if (frequency === "weekdays") {
    if (sameDays(weekdays, WEEK_DAYS)) return t("По будням");
    if (sameDays(weekdays, WEEKEND)) return t("По выходным");
    if (weekdays.length === 1) return t("По {day}", { day: t(BY_DAY[weekdays[0]]) });
    return weekdays.map((day, index) => (index ? t(DAY_NAMES[day]).toLowerCase() : t(DAY_NAMES[day]))).join(", ");
  }
  return t("Каждый день");
}

function daysBetween(from: string, to: string): number {
  const time = (iso: string) => {
    const [year, month, day] = iso.split("-").map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((time(to) - time(from)) / 86_400_000);
}

/** Когда в следующий раз, словами. Пусто, если это уже сегодня или дня нет. */
export function nextDayWord(next: string | null, today: string): string {
  if (!next) return "";
  const days = daysBetween(today, next);
  if (days <= 0) return "";
  if (days === 1) return t("завтра");
  if (days === 2) return t("послезавтра");
  if (days < 7) return t(ON_DAY[weekdayOf(next)]);
  return t("через {days} {word}", { days, word: plural(days, "день", "дня", "дней") });
}

export interface HabitWhen extends HabitSchedule {
  dueToday: boolean;
  doneToday: boolean;
  nextDue: string | null;
  today: string;
}

/** Подпись под названием. У ежедневной её нет: так выглядят почти все привычки. */
export function habitWhen(habit: HabitWhen): string {
  if (habit.frequency === "daily") return "";
  const label = scheduleLabel(habit);
  // Сегодня ещё ждёт, значит следующий раз ни к чему, а один день в неделю подпись уже назвала.
  const pending = habit.dueToday && !habit.doneToday;
  if (pending || (habit.frequency === "weekdays" && habit.weekdays.length === 1)) return label;
  const word = nextDayWord(habit.nextDue, habit.today);
  return word ? t("{label}, снова {word}", { label, word }) : label;
}
