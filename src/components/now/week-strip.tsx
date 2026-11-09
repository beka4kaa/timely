"use client";

// Неделя плитками в заголовке страницы: день недели и число, сегодня тёмная плитка.
// Дни ведут в «Неделю», точка отмечает день с контрольной.

import Link from "next/link";

import { longDateLabel, type WeekDay } from "@/lib/now-feed";

export function WeekStrip({ days }: { days: WeekDay[] }) {
  if (!days.length) return <span className="now-skel is-week" aria-hidden="true" />;
  return (
    <nav className="weekline" aria-label="Дни недели">
      {days.map((day) => {
        const date = longDateLabel(day.dateKey);
        const label = `${day.isToday ? `Сегодня, ${date.charAt(0).toLowerCase()}${date.slice(1)}` : date}${
          day.test ? `, ${day.test}` : ""
        }. Открыть неделю`;
        return (
          <Link
            key={day.dateKey}
            href="/dashboard/plan"
            className={day.test ? "has-test" : undefined}
            aria-current={day.isToday ? "date" : undefined}
            aria-label={label}
            title={day.test ?? undefined}
          >
            {day.weekday}
            <b>{day.day}</b>
          </Link>
        );
      })}
    </nav>
  );
}
