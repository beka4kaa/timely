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
    <section className="overflow-hidden rounded-[20px] border border-[#ddd7cd] bg-[#fbfaf7]/95 shadow-[0_12px_40px_rgba(70,54,36,0.06)]">
      <header className="flex items-center justify-between border-b border-[#e2dcd3] bg-[#f5f1ea] px-[18px] py-3">
        <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#9b9186]">
          Сегодня
        </span>
        <span className="text-[10px] text-[#9a9187]">{todayLabel}</span>
      </header>

      <div className="px-5 pb-[18px] pt-[22px]">
        <p className="font-serif text-[46px] font-medium leading-none tracking-[-0.04em] text-[#302b26] tabular-nums">
          {hm(stats.focusSeconds)}
        </p>
        <p className="mt-2 text-xs text-[#8b8279]">
          чистого времени учёбы за день
        </p>

        <div className="mt-[18px] grid grid-cols-2 gap-2.5">
          <div className="rounded-[14px] border border-[#e4ded4] bg-[#fffdfa] px-3.5 py-3">
            <p className="text-[9px] uppercase tracking-[0.12em] text-[#a09587]">
              Помодоро
            </p>
            <p className="mt-[5px] text-lg font-semibold tabular-nums text-[#3a3530]">
              {stats.focusCount}
            </p>
          </div>
          <div className="rounded-[14px] border border-[#e4ded4] bg-[#fffdfa] px-3.5 py-3">
            <p className="text-[9px] uppercase tracking-[0.12em] text-[#a09587]">
              Перерывы
            </p>
            <p className="mt-[5px] text-lg font-semibold tabular-nums text-[#3a3530]">
              {stats.breakCount}
            </p>
          </div>
        </div>

        <div className="mt-[18px]">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-[0.12em] text-[#a09587]">
              Цель дня
            </span>
            <span className="text-[11px] tabular-nums text-[#8a6137]">
              {Math.round(stats.focusSeconds / 60)} / {DAY_GOAL_MIN} мин
            </span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-[#ece5da]"
            role="progressbar"
            aria-valuenow={stats.goalPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Прогресс дневной цели"
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#c99a5a] to-[#a76b22] transition-[width] duration-500"
              style={{ width: `${stats.goalPercent}%` }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
