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
    <section className="mt-5 overflow-hidden rounded-[20px] border border-tm-line bg-tm-surface/95 shadow-[0_12px_40px_rgba(70,54,36,0.06)]">
      <header className="flex items-center justify-between border-b border-tm-line bg-tm-surface-2 px-5 py-3">
        <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-tm-faint">
          История сессий
        </span>
        <span className="text-[10px] text-tm-faint">
          {rows.length} записей за сегодня
        </span>
      </header>

      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-[13px] text-tm-muted">
          Сегодня ещё нет завершённых сессий. Запустите таймер — записи появятся
          здесь.
        </p>
      ) : (
        <div>
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[64px_1fr_auto] items-center gap-3 border-t border-tm-line px-5 py-3.5 transition-colors hover:bg-tm-surface-2 sm:grid-cols-[96px_1fr_130px_92px]"
            >
              <span className="text-[11px] tabular-nums text-tm-faint">
                {row.time}
              </span>

              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className={`grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[10px] border ${
                    row.isFocus
                      ? "border-tm-accent-line bg-tm-bg text-tm-accent"
                      : "border-tm-line bg-[#f1f4f0] text-[#5f7963] dark:bg-tm-mint dark:text-tm-ink-2"
                  }`}
                >
                  {row.isFocus ? (
                    <Timer className="h-3.5 w-3.5" />
                  ) : (
                    <Coffee className="h-3.5 w-3.5" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-semibold text-tm-ink">
                    {row.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-tm-faint">
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
                            ? "rgb(var(--tm-accent))"
                            : "#a8bda9"
                          : "rgb(var(--tm-line))",
                    }}
                  />
                ))}
              </div>

              <span className="text-right text-xs font-semibold tabular-nums text-tm-accent">
                {row.duration}
              </span>
            </div>
          ))}
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-tm-line bg-tm-bg px-5 py-3">
        <span className="text-[11px] text-tm-faint">
          Всего за неделю — {hm(weekSeconds)}
        </span>
        <button
          type="button"
          onClick={onClearDay}
          disabled={clearing || rows.length === 0}
          className="rounded-full border border-tm-line bg-tm-surface px-3.5 py-1.5 text-[11px] text-tm-ink-2 transition-colors hover:border-tm-accent hover:bg-tm-bg hover:text-tm-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {clearing ? "Очищаем…" : "Очистить день"}
        </button>
      </footer>
    </section>
  );
}
