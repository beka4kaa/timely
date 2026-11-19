"use client";

// Как часто: три варианта, а под ними только то, что нужно выбранному. Пустых состояний нет:
// какой вариант ни открой, он сразу годится, и подтверждать его надо один раз.

import { msg, t } from "@/lib/i18n";

import { plural } from "./habit-days";
import {
  DAY_FULL_NAMES,
  DAY_NAMES,
  MAX_INTERVAL_DAYS,
  MIN_INTERVAL_DAYS,
  toggleDay,
  WEEK_DAYS,
  WEEKEND,
  withFrequency,
  type HabitFrequency,
  type HabitSchedule,
} from "./habit-schedule";

const OPTIONS: ReadonlyArray<readonly [HabitFrequency, string]> = [
  ["daily", msg("Каждый день")],
  ["weekdays", msg("По дням")],
  ["interval", msg("Раз в N дней")],
];

export function SchedulePicker({
  value,
  onChange,
}: {
  value: HabitSchedule;
  onChange: (next: HabitSchedule) => void;
}) {
  const days = value.intervalDays;
  return (
    <div className="hs">
      <div className="tabs" role="group" aria-label={t("Как часто")}>
        {OPTIONS.map(([frequency, label]) => (
          <button
            key={frequency}
            type="button"
            aria-pressed={value.frequency === frequency}
            onClick={() => onChange(withFrequency(value, frequency))}
          >
            {t(label)}
          </button>
        ))}
      </div>

      {value.frequency === "weekdays" ? (
        <>
          <div className="hs-days" role="group" aria-label={t("Дни недели")}>
            {DAY_NAMES.map((name, day) => (
              <button
                key={name}
                className="gs-chip hs-day"
                type="button"
                aria-label={t(DAY_FULL_NAMES[day])}
                aria-pressed={value.weekdays.includes(day)}
                onClick={() => onChange(toggleDay(value, day))}
              >
                {t(name)}
              </button>
            ))}
          </div>
          <div className="hs-more">
            <button type="button" onClick={() => onChange({ ...value, weekdays: [...WEEK_DAYS] })}>
              {t("Будни")}
            </button>
            <button type="button" onClick={() => onChange({ ...value, weekdays: [...WEEKEND] })}>
              {t("Выходные")}
            </button>
          </div>
        </>
      ) : null}

      {value.frequency === "interval" ? (
        <div className="hs-step">
          <span>{t("Раз в")}</span>
          <button
            type="button"
            aria-label={t("На день меньше")}
            disabled={days <= MIN_INTERVAL_DAYS}
            onClick={() => onChange({ ...value, intervalDays: days - 1 })}
          >
            −
          </button>
          <b aria-live="polite">{days}</b>
          <button
            type="button"
            aria-label={t("На день больше")}
            disabled={days >= MAX_INTERVAL_DAYS}
            onClick={() => onChange({ ...value, intervalDays: days + 1 })}
          >
            +
          </button>
          <span>{plural(days, "день", "дня", "дней")}</span>
        </div>
      ) : null}
    </div>
  );
}
