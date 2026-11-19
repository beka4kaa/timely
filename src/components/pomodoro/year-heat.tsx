"use client";

// Год по дням: чем темнее клетка, тем больше занимался.

import { useEffect, useRef } from "react";

import { plural, t } from "@/lib/i18n";
import { hm } from "@/lib/pomodoro";
import { summarizeHeat, type HeatWeek } from "@/lib/pomodoro.logic";
import { cn } from "@/lib/utils";

function daysWord(count: number): string {
  return plural(count, "день", "дня", "дней");
}

export function YearHeat({ weeks, loading }: { weeks: HeatWeek[]; loading: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const heat = summarizeHeat(weeks);

  // На телефоне год не помещается: сразу показываем свежие недели, а не прошлую зиму.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (wrap) wrap.scrollLeft = wrap.scrollWidth;
  }, []);

  return (
    <section className="fp-year">
      <h2 className="sec">{t("Год")}</h2>
      <div ref={wrapRef} className="heat-wrap" tabIndex={0} aria-label={t("Активность за год по дням")}>
        <div className="heat">
          {weeks.flatMap((week) =>
            week.days.map((cell) => (
              <i
                key={cell.key}
                className={cn(`h${cell.level}`, cell.isFuture && "future", cell.isToday && "today")}
                title={cell.isFuture ? undefined : `${cell.tooltipSub}: ${cell.tooltipTitle.toLowerCase()}`}
              />
            )),
          )}
        </div>
      </div>
      {loading ? null : (
        <p className="small-note fp-year-note">
          {heat.best
            ? t("{days} {word} с занятиями, всего {total}. Лучший день: {day}, {best}.", {
                days: heat.activeDays,
                word: daysWord(heat.activeDays),
                total: hm(heat.totalSeconds),
                day: heat.best.label,
                best: hm(heat.best.seconds),
              })
            : t("Каждый день с занятиями закрасится здесь.")}
        </p>
      )}
    </section>
  );
}
