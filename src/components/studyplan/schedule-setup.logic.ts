import { plural, t } from "../../lib/i18n";
import type { ScheduleSetupOption, ScheduleSetupSummary } from "../../lib/studyplan-api.ts";

export type NormalizedSetupAnswer =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function prepareScheduleSetupAnswer(
  questionId: string,
  rawValue: string,
  source: "option" | "other",
): NormalizedSetupAnswer {
  if (source === "option") {
    const value = rawValue.trim();
    return value
      ? { ok: true, value }
      : { ok: false, error: t("Выбери один из вариантов.") };
  }
  return normalizeScheduleSetupAnswer(questionId, rawValue);
}

const WEEKDAY_BY_TOKEN: Record<string, number> = {
  "0": 0,
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  пн: 0,
  понедельник: 0,
  вт: 1,
  вторник: 1,
  ср: 2,
  среда: 2,
  чт: 3,
  четверг: 3,
  пт: 4,
  пятница: 4,
  сб: 5,
  суббота: 5,
  вс: 6,
  воскресенье: 6,
  mon: 0,
  monday: 0,
  tue: 1,
  tuesday: 1,
  wed: 2,
  wednesday: 2,
  thu: 3,
  thursday: 3,
  fri: 4,
  friday: 4,
  sat: 5,
  saturday: 5,
  sun: 6,
  sunday: 6,
};

/**
 * Свободный ответ остаётся семантическим. Нормализация нужна, чтобы бэкенд
 * всегда получил свой компактный контракт, даже для привычного «пн, ср, пт».
 */
export function normalizeScheduleSetupAnswer(
  questionId: string,
  rawValue: string,
): NormalizedSetupAnswer {
  const value = rawValue.trim();
  if (!value) return { ok: false, error: t("Напиши короткий ответ.") };

  if (questionId === "weekdays") {
    const tokens = value
      .toLocaleLowerCase("ru")
      .replace(/\./g, "")
      .split(/[\s,;/]+/)
      .filter((token) => token && token !== "и" && token !== "and"); // i18n-skip
    const weekdays: number[] = [];
    for (const token of tokens) {
      const weekday = WEEKDAY_BY_TOKEN[token];
      if (weekday === undefined) {
        return { ok: false, error: t("Напиши дни так: пн, ср, пт.") };
      }
      weekdays.push(weekday);
    }
    if (weekdays.length === 0) {
      return { ok: false, error: t("Напиши дни так: пн, ср, пт.") };
    }
    return {
      ok: true,
      value: Array.from(new Set(weekdays))
        .sort((left, right) => left - right)
        .join(","),
    };
  }

  if (questionId === "start_time") {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value);
    if (!match) return { ok: false, error: t("Укажи время в формате 18:30.") };
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) {
      return { ok: false, error: t("Проверь часы и минуты.") };
    }
    return {
      ok: true,
      value: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
    };
  }

  if (questionId === "session_minutes") {
    if (!/^\d+$/.test(value)) {
      return { ok: false, error: t("Укажи целое число минут.") };
    }
    const minutes = Number(value);
    if (minutes < 15 || minutes > 120) {
      return { ok: false, error: t("Выбери длительность от 15 до 120 минут.") };
    }
    return { ok: true, value: String(minutes) };
  }

  if (value.length > 120) {
    return { ok: false, error: t("Сократи ответ до 120 символов.") };
  }
  return { ok: true, value };
}

export function scheduleSetupSummaryRows(
  summary: ScheduleSetupSummary,
): Array<{ label: string; value: string }> {
  return [
    { label: t("Программа"), value: summary.course_title },
    { label: t("Дни"), value: summary.weekday_labels.map((day) => t(day)).join(", ") },
    { label: t("Начало"), value: summary.start_time },
    { label: t("Занятие"), value: t("{n} мин", { n: summary.session_minutes }) },
    {
      label: t("В неделю"),
      value: `${sessionWord(summary.sessions_per_week)} · ${t("{n} мин", {
        n: summary.minutes_per_week,
      })}`,
    },
  ];
}

function sessionWord(count: number): string {
  return plural(count, "{n} занятие", "{n} занятия", "{n} занятий");
}

/** Вопрос «Для какой программы составить расписание?»: варианты — программы самого ученика. */
const PLAN_QUESTION = "course_plan_id";
/** Темп программы, как его пишет сервер (backend/studyplan/setup.py). */
const PLAN_PACE = /^(\d+) занятий в неделю, по (\d+) минут$/; // i18n-skip

/**
 * Подписи варианта на языке интерфейса. Название программы ученик дал сам, его не переводим,
 * иначе программа «Физика» стала бы «Physics». Темп сервер собирает из чисел, поэтому его
 * перевод идёт по шаблону, а остальные подписи — фиксированные фразы сервера из словаря.
 */
export function scheduleSetupOptionText(
  questionId: string,
  option: ScheduleSetupOption,
): { label: string; description?: string } {
  const isPlan = questionId === PLAN_QUESTION;
  const pace = isPlan && option.description ? PLAN_PACE.exec(option.description) : null;
  const description = pace
    ? t("{n} занятий в неделю, по {minutes} минут", { n: pace[1], minutes: pace[2] })
    : option.description
      ? t(option.description)
      : undefined;
  return { label: isPlan ? option.label : t(option.label), ...(description ? { description } : {}) };
}
