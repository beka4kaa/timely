"use client";

// Неделя плитками в заголовке страницы: день недели и число, сегодня тёмная плитка.
// Дни ведут в «Неделю», точка отмечает день с контрольной.

import Link from "next/link";

import { t } from "@/lib/i18n";
import { longDateLabel, type WeekDay } from "@/lib/now-feed";

export function WeekStrip({ days }: { days: WeekDay[] }) {
  if (!days.length) return <span className="now-skel is-week" aria-hidden="true" />;
  return (
    <nav className="weekline" aria-label={t("Дни недели")}>
      {days.map((day) => {
        const date = longDateLabel(day.dateKey);
        const dayLabel = day.isToday
          ? t("Сегодня, {date}", { date: `${date.charAt(0).toLowerCase()}${date.slice(1)}` })
          : date;
        const label = t("{day}. Открыть неделю", { day: day.test ? `${dayLabel}, ${day.test}` : dayLabel });
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
