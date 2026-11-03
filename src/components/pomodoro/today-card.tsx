"use client";

import { DAY_GOAL_MIN, hm } from "@/lib/pomodoro";
import type { TodayStats } from "@/lib/pomodoro.logic";

interface TodayCardProps {
  stats: TodayStats;
}

export function TodayCard({ stats }: TodayCardProps) {
  const todayLabel = new Date().toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });

  return (
    <section className="overflow-hidden rounded-[20px] border border-tm-line bg-tm-surface/95 shadow-[0_12px_40px_rgba(70,54,36,0.06)]">
      <header className="flex items-center justify-between border-b border-tm-line bg-tm-surface-2 px-[18px] py-3">
        <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-tm-faint">
          Сегодня
        </span>
        <span className="text-[10px] text-tm-faint">{todayLabel}</span>
      </header>

      <div className="px-5 pb-[18px] pt-[22px]">
        <p className="font-serif text-[46px] font-medium leading-none tracking-[-0.04em] text-tm-ink tabular-nums">
          {hm(stats.focusSeconds)}
        </p>
        <p className="mt-2 text-xs text-tm-muted">
          чистого времени учёбы за день
        </p>

        <div className="mt-[18px] grid grid-cols-2 gap-2.5">
          <div className="rounded-[14px] border border-tm-line bg-tm-surface px-3.5 py-3">
            <p className="text-[9px] uppercase tracking-[0.12em] text-tm-faint">
              Помодоро
            </p>
            <p className="mt-[5px] text-lg font-semibold tabular-nums text-tm-ink">
              {stats.focusCount}
            </p>
          </div>
          <div className="rounded-[14px] border border-tm-line bg-tm-surface px-3.5 py-3">
            <p className="text-[9px] uppercase tracking-[0.12em] text-tm-faint">
              Перерывы
            </p>
            <p className="mt-[5px] text-lg font-semibold tabular-nums text-tm-ink">
              {stats.breakCount}
            </p>
          </div>
        </div>

        <div className="mt-[18px]">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-[0.12em] text-tm-faint">
              Цель дня
            </span>
            <span className="text-[11px] tabular-nums text-tm-accent">
              {Math.round(stats.focusSeconds / 60)} / {DAY_GOAL_MIN} мин
            </span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-tm-surface-3"
            role="progressbar"
            aria-valuenow={stats.goalPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Прогресс дневной цели"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-tm-accent/70 to-tm-accent transition-[width] duration-500"
              style={{ width: `${stats.goalPercent}%` }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
