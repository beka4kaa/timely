"use client";

import { useState } from "react";

import { hm, streakLabel } from "@/lib/pomodoro";
import {
  HEAT_COLORS,
  summarizeHeat,
  sumSeconds,
  type DayBar,
  type HeatWeek,
} from "@/lib/pomodoro.logic";

// Высота области столбиков диаграммы, px.
const CHART_AREA_PX = 176;

interface Tooltip {
  x: number;
  y: number;
  title: string;
  sub: string;
}

interface ActivityPanelProps {
  weeks: HeatWeek[];
  bars: DayBar[];
}

export function ActivityPanel({ weeks, bars }: ActivityPanelProps) {
  const [panel, setPanel] = useState<"calendar" | "chart">("calendar");
  const [tip, setTip] = useState<Tooltip | null>(null);

  const heat = summarizeHeat(weeks);
  const barsTotal = sumSeconds(bars);

  function showTip(event: React.MouseEvent<HTMLElement>, title: string, sub: string) {
    const rect = event.currentTarget.getBoundingClientRect();
    setTip({
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top - 8),
      title,
      sub,
    });
  }

  function tabClass(active: boolean) {
    return `bg-transparent p-0 text-sm transition-colors ${
      active ? "font-semibold text-tm-ink" : "text-tm-faint hover:text-tm-muted"
    }`;
  }

  return (
    <section className="mt-8">
      <header className="mb-[18px] flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-serif text-xl font-medium tracking-[-0.025em] text-tm-ink">
          Активность учёбы
        </h2>
        <div className="flex items-baseline gap-5">
          <button
            type="button"
            onClick={() => {
              setPanel("calendar");
              setTip(null);
            }}
            className={tabClass(panel === "calendar")}
          >
            Календарь
          </button>
          <button
            type="button"
            onClick={() => {
              setPanel("chart");
              setTip(null);
            }}
            className={tabClass(panel === "chart")}
          >
            Диаграмма
          </button>
        </div>
      </header>

      {panel === "calendar" ? (
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="flex gap-[3px]">
              {weeks.map((week) => (
                <div key={week.key} className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  {week.days.map((cell) => (
                    <span
                      key={cell.key}
                      onMouseEnter={
                        cell.isFuture
                          ? undefined
                          : (event) => showTip(event, cell.tooltipTitle, cell.tooltipSub)
                      }
                      onMouseLeave={() => setTip(null)}
                      className={`aspect-square w-full rounded-[3px] ${
                        cell.isFuture ? "cursor-default" : "cursor-pointer"
                      }`}
                      style={{
                        background: cell.color,
                        boxShadow: cell.isToday ? "0 0 0 1px rgb(var(--tm-bg)), 0 0 0 2.5px rgb(var(--tm-accent))" : undefined,
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>

            <div className="mt-2.5 flex gap-[3px]">
              {weeks.map((week) => (
                <span
                  key={`${week.key}-month`}
                  className="min-w-0 flex-1 whitespace-nowrap text-[11px] text-tm-faint"
                >
                  {week.month}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-[18px] flex flex-wrap items-center justify-between gap-3 border-t border-tm-line pt-3.5">
            <span className="text-[11px] text-tm-faint">
              {heat.activeDays} активных дней · всего {hm(heat.totalSeconds)}
              {heat.best
                ? ` · лучший день ${heat.best.label} (${hm(heat.best.seconds)})`
                : ""}
            </span>
            <div className="flex items-center gap-1.5 text-[10px] text-tm-faint">
              меньше
              {HEAT_COLORS.map((color) => (
                <span
                  key={color}
                  className="h-3 w-3 rounded-[3px]"
                  style={{ background: color }}
                />
              ))}
              больше
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex h-[220px] items-end gap-1.5 border-b border-tm-line">
            {bars.map((bar) => (
              <div
                key={bar.key}
                onMouseEnter={(event) => showTip(event, bar.tooltipTitle, bar.tooltipSub)}
                onMouseLeave={() => setTip(null)}
                className="flex h-full min-w-0 flex-1 cursor-default flex-col items-center justify-end gap-1.5"
              >
                <span className="text-[9px] tabular-nums text-tm-faint">
                  {bar.seconds > 0 ? Math.round(bar.seconds / 60) : ""}
                </span>
                <div
                  className="w-full rounded-b-[2px] rounded-t-md"
                  style={{
                    height: `${Math.max(3, Math.round(bar.ratio * CHART_AREA_PX))}px`,
                    background: bar.isToday
                      ? "linear-gradient(180deg, rgb(var(--tm-accent) / 0.7), rgb(var(--tm-accent)))"
                      : bar.reachedGoal
                        ? "rgb(var(--tm-accent) / 0.75)"
                        : "rgb(var(--tm-line-strong))",
                  }}
                />
              </div>
            ))}
          </div>

          <div className="flex gap-1.5 pt-2">
            {bars.map((bar) => (
              <span
                key={`${bar.key}-label`}
                className={`min-w-0 flex-1 text-center text-[9px] tabular-nums ${
                  bar.isToday ? "text-tm-accent" : "text-tm-faint"
                }`}
              >
                {bar.label}
              </span>
            ))}
          </div>

          <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3 border-t border-tm-line pt-3.5">
            <span className="text-[11px] text-tm-faint">
              За {streakLabel(bars.length)} — {hm(barsTotal)}
            </span>
            <div className="flex items-center gap-1.5 text-[10px] text-tm-faint">
              <span className="h-0.5 w-[22px] bg-tm-accent" />
              среднее {hm(bars.length ? barsTotal / bars.length : 0)}
            </div>
          </div>
        </div>
      )}

      {tip && (
        <div
          className="pointer-events-none fixed z-[200] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[10px] border border-tm-strong bg-tm-strong px-2.5 py-[7px] text-[11px] leading-[1.35] text-tm-on-strong shadow-[0_10px_24px_rgba(48,45,42,0.28)]"
          style={{ left: `${tip.x}px`, top: `${tip.y}px` }}
        >
          <span className="block font-semibold">{tip.title}</span>
          <span className="block text-[10px] text-tm-on-strong/70">{tip.sub}</span>
        </div>
      )}
    </section>
  );
}
