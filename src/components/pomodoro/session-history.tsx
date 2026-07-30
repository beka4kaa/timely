"use client";

import { Coffee, Timer } from "lucide-react";

import { hm } from "@/lib/pomodoro";
import type { HistoryRow } from "@/lib/pomodoro.logic";

interface SessionHistoryProps {
  rows: HistoryRow[];
  weekSeconds: number;
  clearing: boolean;
  onClearDay: () => void;
}

export function SessionHistory({
  rows,
  weekSeconds,
  clearing,
  onClearDay,
}: SessionHistoryProps) {
  return (
    <section className="mt-5 overflow-hidden rounded-[20px] border border-[#ddd7cd] bg-[#fbfaf7]/95 shadow-[0_12px_40px_rgba(70,54,36,0.06)]">
      <header className="flex items-center justify-between border-b border-[#e2dcd3] bg-[#f5f1ea] px-5 py-3">
        <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#9b9186]">
          История сессий
        </span>
        <span className="text-[10px] text-[#9a9187]">
          {rows.length} записей за сегодня
        </span>
      </header>

      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-[13px] text-[#8b8279]">
          Сегодня ещё нет завершённых сессий. Запустите таймер — записи появятся
          здесь.
        </p>
      ) : (
        <div>
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[64px_1fr_auto] items-center gap-3 border-t border-[#e8e2da] px-5 py-3.5 transition-colors hover:bg-[#f6f1e9] sm:grid-cols-[96px_1fr_130px_92px]"
            >
              <span className="text-[11px] tabular-nums text-[#91887e]">
                {row.time}
              </span>

              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className={`grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[10px] border ${
                    row.isFocus
                      ? "border-[#dec9ab] bg-[#fffaf1] text-[#9a6630]"
                      : "border-[#cfd8ce] bg-[#f1f4f0] text-[#5f7963]"
                  }`}
                >
                  {row.isFocus ? (
                    <Timer className="h-3.5 w-3.5" />
                  ) : (
                    <Coffee className="h-3.5 w-3.5" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-[#3a3530]">
                    {row.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-[#91887e]">
                    {row.meta}
                  </span>
                </span>
              </div>

              <div className="hidden gap-[3px] sm:flex">
                {[0, 1, 2, 3, 4].map((index) => (
                  <span
                    key={index}
                    className="h-3.5 w-[5px] rounded-[3px]"
                    style={{
                      background:
                        index < row.filledDots
                          ? row.isFocus
                            ? "#c08a45"
                            : "#a8bda9"
                          : "#e6dfd4",
                    }}
                  />
                ))}
              </div>

              <span className="text-right text-xs font-semibold tabular-nums text-[#8a6137]">
                {row.duration}
              </span>
            </div>
          ))}
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e8e2da] bg-[#f8f5ef] px-5 py-3">
        <span className="text-[11px] text-[#91887e]">
          Всего за неделю — {hm(weekSeconds)}
        </span>
        <button
          type="button"
          onClick={onClearDay}
          disabled={clearing || rows.length === 0}
          className="rounded-full border border-[#d8d1c7] bg-[#fffdfa] px-3.5 py-1.5 text-[11px] text-[#5f584f] transition-colors hover:border-[#c7aa82] hover:bg-[#fff8ec] hover:text-[#312c27] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {clearing ? "Очищаем…" : "Очистить день"}
        </button>
      </footer>
    </section>
  );
}
