"use client";

// Пилюля таймера в шапке дашборда. Показывает обратный отсчёт текущей фазы
// помодоро на любой странице, потому что состояние живёт в глобальном сторе.

import { Clock3, Pause, Play, RotateCcw } from "lucide-react";

import { clockOf } from "@/lib/pomodoro";
import {
  selectHasStarted,
  selectRemaining,
  usePomodoroStore,
} from "@/stores/pomodoro-store";

export function PomodoroHeaderPill() {
  const running = usePomodoroStore((state) => state.running);
  const phase = usePomodoroStore((state) => state.phase);
  const remaining = usePomodoroStore(selectRemaining);
  const hasStarted = usePomodoroStore(selectHasStarted);
  const toggle = usePomodoroStore((state) => state.toggle);
  const reset = usePomodoroStore((state) => state.reset);

  const phaseName = phase === "focus" ? "Фокус" : "Перерыв";

  return (
    <div className="hidden items-center sm:flex">
      <button
        type="button"
        onClick={toggle}
        title={hasStarted ? `${phaseName} · помодоро` : "Помодоро"}
        aria-label={
          running
            ? "Поставить помодоро на паузу"
            : hasStarted
              ? "Продолжить помодоро"
              : "Начать помодоро"
        }
        className={`flex h-8 items-center gap-2 rounded-full border px-3 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35 ${
          running
            ? "border-[#c99a5a] bg-[#fff8eb] text-[#83561f]"
            : "border-[#ddd9d1] bg-white/70 text-[#746f67] hover:border-[#c9c3b9] hover:bg-white"
        }`}
      >
        {running ? (
          <Pause className="h-3.5 w-3.5" />
        ) : hasStarted ? (
          <Play className="h-3.5 w-3.5" />
        ) : (
          <Clock3 className="h-3.5 w-3.5" />
        )}
        <span className={hasStarted ? "tabular-nums" : ""}>
          {hasStarted ? clockOf(remaining) : "Начать таймер"}
        </span>
      </button>

      {hasStarted && (
        <button
          type="button"
          onClick={reset}
          aria-label="Сбросить таймер"
          title="Сбросить таймер"
          className="-ml-1 grid h-8 w-7 place-items-center rounded-r-full text-[#9a9389] outline-none transition-colors hover:text-[#4c453d] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
