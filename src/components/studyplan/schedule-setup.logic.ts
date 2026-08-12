import type { ScheduleSetupSummary } from "../../lib/studyplan-api.ts";

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
      : { ok: false, error: "Выбери один из вариантов." };
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
  if (!value) return { ok: false, error: "Напиши короткий ответ." };

  if (questionId === "weekdays") {
    const tokens = value
      .toLocaleLowerCase("ru")
      .replace(/\./g, "")
      .split(/[\s,;/]+/)
      .filter((token) => token && token !== "и");
    const weekdays: number[] = [];
    for (const token of tokens) {
      const weekday = WEEKDAY_BY_TOKEN[token];
      if (weekday === undefined) {
        return { ok: false, error: "Напиши дни так: пн, ср, пт." };
      }
      weekdays.push(weekday);
    }
    if (weekdays.length === 0) {
      return { ok: false, error: "Напиши дни так: пн, ср, пт." };
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
    if (!match) return { ok: false, error: "Укажи время в формате 18:30." };
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) {
      return { ok: false, error: "Проверь часы и минуты." };
    }
    return {
      ok: true,
      value: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
    };
  }

  if (questionId === "session_minutes") {
    if (!/^\d+$/.test(value)) {
      return { ok: false, error: "Укажи целое число минут." };
    }
    const minutes = Number(value);
    if (minutes < 15 || minutes > 120) {
      return { ok: false, error: "Выбери длительность от 15 до 120 минут." };
    }
    return { ok: true, value: String(minutes) };
  }

  if (value.length > 120) {
    return { ok: false, error: "Сократи ответ до 120 символов." };
  }
  return { ok: true, value };
}

export function scheduleSetupSummaryRows(
  summary: ScheduleSetupSummary,
): Array<{ label: string; value: string }> {
  return [
    { label: "Программа", value: summary.course_title },
    { label: "Дни", value: summary.weekday_labels.join(", ") },
    { label: "Начало", value: summary.start_time },
    { label: "Занятие", value: `${summary.session_minutes} мин` },
    {
      label: "В неделю",
      value: `${summary.sessions_per_week} ${sessionWord(
        summary.sessions_per_week,
      )} · ${summary.minutes_per_week} мин`,
    },
  ];
}

function sessionWord(count: number): string {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return "занятий";
  const last = count % 10;
  if (last === 1) return "занятие";
  if (last >= 2 && last <= 4) return "занятия";
  return "занятий";
}
