"use client";

import { Coffee, Pause, Play, RotateCcw, SkipForward, Timer } from "lucide-react";

import { clockOf, presetAt, type PomodoroPhase } from "@/lib/pomodoro";

// Длина окружности радиуса 142 — сюда упирается stroke-dasharray кольца.
const RING_CIRCUMFERENCE = 892.2;

interface TimerDialProps {
  phase: PomodoroPhase;
  remaining: number;
  planned: number;
  running: boolean;
  hasStarted: boolean;
  cycles: number;
  presetIdx: number;
  onToggle: () => void;
  onSkip: () => void;
  onReset: () => void;
}

export function TimerDial({
  phase,
  remaining,
  planned,
  running,
  hasStarted,
  cycles,
  presetIdx,
  onToggle,
  onSkip,
  onReset,
}: TimerDialProps) {
  const isFocus = phase === "focus";
  const preset = presetAt(presetIdx);
  const fraction = planned > 0 ? Math.max(0, Math.min(1, remaining / planned)) : 0;

  return (
    <section className="rounded-[20px] border border-tm-line bg-tm-surface/95 px-5 pb-7 pt-8 shadow-[0_12px_40px_rgba(70,54,36,0.06)] sm:px-7">
      <div className="flex items-center justify-between gap-3">
        <span
          className={`inline-flex items-center gap-[7px] rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
            isFocus
              ? "border-tm-accent-line bg-tm-bg text-tm-accent"
              : "border-[#cbd7cc] bg-[#f2f5f1] text-[#54705b] dark:border-tm-line dark:bg-tm-mint dark:text-tm-ink-2"
          }`}
        >
          {isFocus ? (
            <Timer className="h-[13px] w-[13px]" />
          ) : (
            <Coffee className="h-[13px] w-[13px]" />
          )}
          {isFocus ? "Фокус" : "Перерыв"}
        </span>
        <span className="text-[11px] tabular-nums text-tm-faint">
          Цикл {cycles + 1} · ритм {preset.focus}/{preset.brk}
        </span>
      </div>

      <div className="relative mx-auto mb-1 mt-5 aspect-square w-full max-w-[320px]">
        <svg
          viewBox="0 0 320 320"
          className="absolute inset-0 h-full w-full -rotate-90"
          aria-hidden="true"
        >
          <circle cx="160" cy="160" r="142" fill="none" stroke="rgb(var(--tm-line))" strokeWidth="10" />
          <circle
            cx="160"
            cy="160"
            r="142"
            fill="none"
            stroke={isFocus ? "rgb(var(--tm-accent))" : "#7d9a83"}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={(RING_CIRCUMFERENCE * (1 - fraction)).toFixed(1)}
          />
          <circle cx="160" cy="160" r="126" fill="none" stroke="rgb(var(--tm-surface-2))" strokeWidth="1" />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
          <span
            className="font-serif text-[64px] font-medium leading-none tracking-[-0.045em] text-tm-ink tabular-nums sm:text-[88px]"
            role="timer"
            aria-live="off"
          >
            {clockOf(remaining)}
          </span>
          <span className="text-[11px] uppercase tracking-[0.16em] text-tm-faint">
            {isFocus ? "до перерыва" : "до возвращения"}
          </span>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex h-[46px] items-center gap-2.5 rounded-full border border-tm-accent bg-tm-bg px-6 text-sm font-semibold text-tm-accent transition-colors hover:border-tm-accent hover:bg-tm-accent-soft"
        >
          {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {running ? "Пауза" : hasStarted ? "Продолжить" : "Начать"}
        </button>

        <button
          type="button"
          onClick={onSkip}
          title="Следующая фаза"
          className="inline-flex h-[46px] items-center gap-2 rounded-full border border-tm-line bg-tm-surface px-[18px] text-[13px] text-tm-ink-2 transition-colors hover:border-tm-accent hover:bg-tm-bg hover:text-tm-ink"
        >
          <SkipForward className="h-[15px] w-[15px]" />
          Дальше
        </button>

        <button
          type="button"
          onClick={onReset}
          title="Сбросить"
          aria-label="Сбросить таймер"
          className="grid h-[46px] w-[46px] place-items-center rounded-full border border-tm-line bg-tm-surface text-tm-ink-2 transition-colors hover:border-tm-accent hover:bg-tm-bg hover:text-tm-ink"
        >
          <RotateCcw className="h-[15px] w-[15px]" />
        </button>
      </div>

      <p className="mt-[18px] text-center text-xs leading-5 text-tm-muted">
        {running
          ? isFocus
            ? "Идёт фокус — уберите телефон, вкладка может быть свёрнута, время всё равно считается."
            : "Встаньте, разомнитесь и выпейте воды."
          : "Нажмите «Начать». Сессии короче минуты в историю не попадают."}
      </p>
    </section>
  );
}
