"use client";

// Циферблат: чёрточка на минуту вместо тонкой дуги и тёмного диска.
// Под цифрами точки цикла: сколько фокусов осталось до длинного перерыва.

import { useMemo } from "react";

import { clockOf, type TimerPhase } from "@/lib/pomodoro";
import type { CycleDot } from "@/lib/pomodoro-cycle";
import { dialSubtitle, dialTicks, tickClass } from "@/lib/pomodoro.logic";
import { cn } from "@/lib/utils";

interface TimerDialProps {
  phase: TimerPhase;
  remaining: number;
  planned: number;
  elapsed: number;
  running: boolean;
  /** Текущий момент из стора: подпись «до 16:55» на паузе ползёт вместе с часами. */
  now: number;
  cycle: { dots: CycleDot[]; label: string };
}

export function TimerDial({ phase, remaining, planned, elapsed, running, now, cycle }: TimerDialProps) {
  const ticks = useMemo(() => dialTicks(planned), [planned]);

  return (
    <div className="dial">
      <svg className={cn("dial-ticks", running && "is-running")} viewBox="0 0 280 280" aria-hidden="true">
        {ticks.map((tick, index) => (
          <line
            key={index}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            strokeWidth={tick.width}
            className={tickClass(index, elapsed, remaining) || undefined}
          />
        ))}
      </svg>
      <div className="dial-mid">
        <span className="dial-t" role="timer" aria-live="off">
          {clockOf(remaining)}
        </span>
        <span className="dial-sub">{dialSubtitle({ phase, running, remaining, planned, now })}</span>
        <span className="fp-cycle" role="img" aria-label={cycle.label} title={cycle.label}>
          {cycle.dots.map((dot, index) => (
            <i key={index} data-dot={dot} />
          ))}
        </span>
      </div>
    </div>
  );
}
