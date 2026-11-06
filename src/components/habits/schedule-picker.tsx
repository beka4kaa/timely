"use client";

// Как часто: три варианта, а под ними только то, что нужно выбранному. Пустых состояний нет:
// какой вариант ни открой, он сразу годится, и подтверждать его надо один раз.

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
  ["daily", "Каждый день"],
  ["weekdays", "По дням"],
  ["interval", "Раз в N дней"],
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
      <div className="tabs" role="group" aria-label="Как часто">
        {OPTIONS.map(([frequency, label]) => (
          <button
            key={frequency}
            type="button"
            aria-pressed={value.frequency === frequency}
            onClick={() => onChange(withFrequency(value, frequency))}
          >
            {label}
          </button>
        ))}
      </div>

      {value.frequency === "weekdays" ? (
        <>
          <div className="hs-days" role="group" aria-label="Дни недели">
            {DAY_NAMES.map((name, day) => (
              <button
                key={name}
                className="gs-chip hs-day"
                type="button"
                aria-label={DAY_FULL_NAMES[day]}
                aria-pressed={value.weekdays.includes(day)}
                onClick={() => onChange(toggleDay(value, day))}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="hs-more">
            <button type="button" onClick={() => onChange({ ...value, weekdays: [...WEEK_DAYS] })}>
              Будни
            </button>
            <button type="button" onClick={() => onChange({ ...value, weekdays: [...WEEKEND] })}>
              Выходные
            </button>
          </div>
        </>
      ) : null}

      {value.frequency === "interval" ? (
        <div className="hs-step">
          <span>Раз в</span>
          <button
            type="button"
            aria-label="На день меньше"
            disabled={days <= MIN_INTERVAL_DAYS}
            onClick={() => onChange({ ...value, intervalDays: days - 1 })}
          >
            −
          </button>
          <b aria-live="polite">{days}</b>
          <button
            type="button"
            aria-label="На день больше"
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
