"use client";

import { hm } from "@/lib/pomodoro";
import { sumSeconds, type DayBar } from "@/lib/pomodoro.logic";

// Высота области столбиков внутри карточки, px.
const BAR_AREA_PX = 78;

interface WeekChartProps {
  bars: DayBar[];
}

export function WeekChart({ bars }: WeekChartProps) {
  const average = bars.length ? sumSeconds(bars) / bars.length : 0;

  return (
    <section className="overflow-hidden rounded-[20px] border border-[#ddd7cd] bg-[#fbfaf7]/95 shadow-[0_12px_40px_rgba(70,54,36,0.06)]">
      <header className="flex items-center justify-between border-b border-[#e2dcd3] bg-[#f5f1ea] px-[18px] py-3">
        <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#9b9186]">
          Последние 7 дней
        </span>
        <span className="text-[10px] text-[#9a9187]">
          в среднем {hm(average)} в день
        </span>
      </header>

      <div className="flex h-[132px] items-end justify-between gap-2 px-[18px] pb-3.5 pt-5">
        {bars.map((bar) => (
          <div
            key={bar.key}
            className="flex h-full flex-1 flex-col items-center justify-end gap-2"
            title={`${bar.tooltipSub} — ${bar.tooltipTitle}`}
          >
            <span className="text-[9px] tabular-nums text-[#a89e92]">
              {bar.seconds > 0 ? Math.round(bar.seconds / 60) : ""}
            </span>
            <div
              className={`w-full rounded-b-[3px] rounded-t-md ${
                bar.isToday
                  ? "bg-gradient-to-b from-[#c99a5a] to-[#a76b22]"
                  : "bg-[#e3dacc]"
              }`}
              style={{ height: `${Math.max(3, Math.round(bar.ratio * BAR_AREA_PX))}px` }}
            />
            <span
              className={`text-[10px] ${
                bar.isToday ? "text-[#8a6137]" : "text-[#a89e92]"
              }`}
            >
              {bar.label}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
