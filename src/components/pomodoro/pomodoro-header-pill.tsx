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
    // На телефоне пилюля появляется, только когда таймер уже идёт: «Начать
    // таймер» там не помещается, а идущий отсчёт терять нельзя.
    <div className={`items-center sm:flex ${hasStarted ? "flex" : "hidden"}`}>
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
        className={`flex h-8 items-center gap-2 rounded-full border px-3 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-tm-accent/35 ${
          running
            ? "border-tm-accent bg-tm-bg text-tm-accent"
            : "border-tm-line bg-tm-surface/70 text-tm-muted hover:border-tm-line-strong hover:bg-tm-surface"
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
          className="-ml-1 hidden h-8 w-7 place-items-center rounded-r-full text-tm-faint outline-none transition-colors hover:text-tm-ink-2 focus-visible:ring-2 focus-visible:ring-tm-accent/30 sm:grid"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
