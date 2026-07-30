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
    <section className="rounded-[20px] border border-[#ddd7cd] bg-[#fbfaf7]/95 px-5 pb-7 pt-8 shadow-[0_12px_40px_rgba(70,54,36,0.06)] sm:px-7">
      <div className="flex items-center justify-between gap-3">
        <span
          className={`inline-flex items-center gap-[7px] rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${
            isFocus
              ? "border-[#dec9ab] bg-[#fffaf1] text-[#8a5b24]"
              : "border-[#cbd7cc] bg-[#f2f5f1] text-[#54705b]"
          }`}
        >
          {isFocus ? (
            <Timer className="h-[13px] w-[13px]" />
          ) : (
            <Coffee className="h-[13px] w-[13px]" />
          )}
          {isFocus ? "Фокус" : "Перерыв"}
        </span>
        <span className="text-[11px] tabular-nums text-[#91887e]">
          Цикл {cycles + 1} · ритм {preset.focus}/{preset.brk}
        </span>
      </div>

      <div className="relative mx-auto mb-1 mt-5 aspect-square w-full max-w-[320px]">
        <svg
          viewBox="0 0 320 320"
          className="absolute inset-0 h-full w-full -rotate-90"
          aria-hidden="true"
        >
          <circle cx="160" cy="160" r="142" fill="none" stroke="#e8e1d6" strokeWidth="10" />
          <circle
            cx="160"
            cy="160"
            r="142"
            fill="none"
            stroke={isFocus ? "#b8823a" : "#7d9a83"}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={(RING_CIRCUMFERENCE * (1 - fraction)).toFixed(1)}
          />
          <circle cx="160" cy="160" r="126" fill="none" stroke="#efe9df" strokeWidth="1" />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
          <span
            className="font-serif text-[64px] font-medium leading-none tracking-[-0.045em] text-[#302b26] tabular-nums sm:text-[88px]"
            role="timer"
            aria-live="off"
          >
            {clockOf(remaining)}
          </span>
          <span className="text-[11px] uppercase tracking-[0.16em] text-[#a09587]">
            {isFocus ? "до перерыва" : "до возвращения"}
          </span>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex h-[46px] items-center gap-2.5 rounded-full border border-[#c99a5a] bg-[#fff8eb] px-6 text-sm font-semibold text-[#83561f] transition-colors hover:border-[#b98a48] hover:bg-[#fdf0d9]"
        >
          {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {running ? "Пауза" : hasStarted ? "Продолжить" : "Начать"}
        </button>

        <button
          type="button"
          onClick={onSkip}
          title="Следующая фаза"
          className="inline-flex h-[46px] items-center gap-2 rounded-full border border-[#d8d1c7] bg-[#fffdfa] px-[18px] text-[13px] text-[#5f584f] transition-colors hover:border-[#c7aa82] hover:bg-[#fff8ec] hover:text-[#312c27]"
        >
          <SkipForward className="h-[15px] w-[15px]" />
          Дальше
        </button>

        <button
          type="button"
          onClick={onReset}
          title="Сбросить"
          aria-label="Сбросить таймер"
          className="grid h-[46px] w-[46px] place-items-center rounded-full border border-[#d8d1c7] bg-[#fffdfa] text-[#5f584f] transition-colors hover:border-[#c7aa82] hover:bg-[#fff8ec] hover:text-[#312c27]"
        >
          <RotateCcw className="h-[15px] w-[15px]" />
        </button>
      </div>

      <p className="mt-[18px] text-center text-xs leading-5 text-[#8b8279]">
        {running
          ? isFocus
            ? "Идёт фокус — уберите телефон, вкладка может быть свёрнута, время всё равно считается."
            : "Встаньте, разомнитесь и выпейте воды."
          : "Нажмите «Начать». Сессии короче минуты в историю не попадают."}
      </p>
    </section>
  );
}
