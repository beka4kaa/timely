"use client";

// Год по дням: чем темнее клетка, тем больше занимался.

import { useEffect, useRef } from "react";

import { hm } from "@/lib/pomodoro";
import { summarizeHeat, type HeatWeek } from "@/lib/pomodoro.logic";
import { cn } from "@/lib/utils";

function daysWord(count: number): string {
  const hundred = count % 100;
  const ten = hundred % 10;
  if (hundred > 10 && hundred < 20) return "дней";
  if (ten === 1) return "день";
  if (ten >= 2 && ten <= 4) return "дня";
  return "дней";
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
      <h2 className="sec">Год</h2>
      <div ref={wrapRef} className="heat-wrap" tabIndex={0} aria-label="Активность за год по дням">
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
            ? `${heat.activeDays} ${daysWord(heat.activeDays)} с занятиями, всего ${hm(heat.totalSeconds)}. Лучший день: ${heat.best.label}, ${hm(heat.best.seconds)}.`
            : "Каждый день с занятиями закрасится здесь."}
        </p>
      )}
    </section>
  );
}
