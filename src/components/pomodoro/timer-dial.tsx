"use client";

// Циферблат: чёрточка на минуту вместо тонкой дуги и тёмного диска.
// Под цифрами точки цикла: сколько фокусов осталось до длинного перерыва.

import type { ReactNode } from "react";

import { clockOf, type TimerPhase } from "@/lib/pomodoro";
import type { CycleDot } from "@/lib/pomodoro-cycle";
import { dialSubtitle, dialTicks, tickClass } from "@/lib/pomodoro.logic";
import { cn } from "@/lib/utils";

// Кольцо одно и то же при любой длине таймера: считается один раз.
const TICKS = dialTicks();

interface TimerDialProps {
  phase: TimerPhase;
  remaining: number;
  planned: number;
  elapsed: number;
  running: boolean;
  /** Текущий момент из стора: подпись «до 16:55» на паузе ползёт вместе с часами. */
  now: number;
  cycle: { dots: CycleDot[]; label: string };
  /** Название идущего блока: стоит над цифрами, нажатие меняет его. */
  name?: string;
  onName?: () => void;
  /** Поле названия: встаёт на место названия, пока его пишут. */
  editor?: ReactNode;
}

export function TimerDial({ phase, remaining, planned, elapsed, running, now, cycle, name, onName, editor }: TimerDialProps) {
  const subtitle = dialSubtitle({ phase, running, remaining, planned, now });

  return (
    <div className="dial">
      <svg className={cn("dial-ticks", running && "is-running")} viewBox="0 0 280 280" aria-hidden="true">
        {TICKS.map((tick, index) => (
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
        {editor ?? (name ? (
          <button className="dial-name" type="button" title="Поменять название" onClick={onName}>
            {name}
          </button>
        ) : null)}
        <span className="dial-t" role="timer" aria-live="off">
          {clockOf(remaining)}
        </span>
        {/* Цифры стоят точно в центре кольца, а название сверху и подпись снизу —
            на равном расстоянии от них, как пара. */}
        <span className="dial-below">
          {subtitle ? <span className="dial-sub">{subtitle}</span> : null}
          <span className="fp-cycle" role="img" aria-label={cycle.label} title={cycle.label}>
            {cycle.dots.map((dot, index) => (
              <i key={index} data-dot={dot} />
            ))}
          </span>
        </span>
      </div>
    </div>
  );
}
