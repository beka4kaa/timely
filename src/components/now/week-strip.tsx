"use client";

// Неделя одной строкой: нагрузка по дням и отметка теста.
//
// Это не второй календарь: дни ведут в «План недели», где неделю и правят.
// Здесь — ответ на вопрос «тяжёлая ли неделя и где контрольная».

import Link from "next/link";

import { durationLabel } from "@/lib/studyplan-visuals";
import { longDateLabel, type WeekDay } from "@/lib/now-feed";

import styles from "./now.module.css";

export function WeekStrip({ days, compact = false }: { days: WeekDay[]; compact?: boolean }) {
  if (!days.length) return null;
  return (
    <nav aria-label="Неделя" className={compact ? styles.weekHeader : undefined}>
      <ol className={styles.week}>
        {days.map((day) => {
          const load = day.minutes ? `${durationLabel(day.minutes)} занятий` : "занятий нет";
          const date = longDateLabel(day.dateKey);
          const label = `${day.isToday ? `Сегодня, ${date.charAt(0).toLowerCase()}${date.slice(1)}` : date}: ${load}${
            day.test ? `, ${day.test}` : ""
          }`;
          return (
            <li key={day.dateKey}>
              <Link
                href="/dashboard/plan"
                className={`${styles.weekDay} ${day.isToday ? styles.today : ""} ${
                  day.isWeekend ? styles.weekend : ""
                }`}
                aria-current={day.isToday ? "date" : undefined}
                aria-label={label}
                title={label}
              >
                <span className={styles.weekDow} aria-hidden="true">
                  {day.weekday}
                </span>
                <span className={styles.weekNum} aria-hidden="true">
                  {day.day}
                </span>
                {day.test ? (
                  <span className={styles.weekFlag} aria-hidden="true">
                    {flagText(day.test)}
                  </span>
                ) : (
                  <span className={styles.weekLoad} aria-hidden="true">
                    <i style={{ width: `${Math.round(day.ratio * 100)}%` }} />
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** «СОР по физике» → «СОР»; длинное название без аббревиатуры → «тест». */
function flagText(title: string): string {
  const first = title.trim().split(/[\s:]+/)[0] ?? "";
  return first.length <= 4 && first === first.toUpperCase() && /[А-ЯA-Z]/.test(first)
    ? first
    : "тест";
}
