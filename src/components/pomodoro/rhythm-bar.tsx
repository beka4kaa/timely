"use client";

import { Check, ChevronDown, ChevronUp, Settings2, Timer } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { PRESETS } from "@/lib/pomodoro";

interface RhythmBarProps {
  presetIdx: number;
  onSelect: (index: number) => void;
}

export function RhythmBar({ presetIdx, onSelect }: RhythmBarProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const current = PRESETS[presetIdx] ?? PRESETS[0];

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="mb-5 flex flex-col items-start justify-between gap-3 rounded-[18px] border border-tm-line bg-tm-surface p-3 shadow-[0_8px_28px_rgba(67,50,31,0.05)] sm:flex-row sm:items-center sm:px-3.5">
      <div className="flex items-center gap-3.5">
        <span className="text-[10px] uppercase tracking-[0.14em] text-tm-faint">
          Ритм
        </span>

        <div className="relative" ref={containerRef}>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-haspopup="listbox"
            className={`flex min-w-[190px] items-center justify-between gap-2.5 rounded-2xl border px-3.5 py-2 text-left shadow-[0_4px_14px_rgba(70,54,36,0.05)] transition-colors ${
              open
                ? "border-tm-accent bg-tm-bg"
                : "border-tm-line bg-tm-surface"
            }`}
          >
            <span className="flex flex-col items-start gap-px">
              <span className="text-sm font-semibold tabular-nums text-tm-ink">
                {current.focus} / {current.brk} мин
              </span>
              <span className="text-[9px] uppercase tracking-[0.1em] text-tm-faint">
                {current.note}
              </span>
            </span>
            {open ? (
              <ChevronUp className="ml-1.5 h-[15px] w-[15px] text-tm-faint" />
            ) : (
              <ChevronDown className="ml-1.5 h-[15px] w-[15px] text-tm-faint" />
            )}
          </button>

          {open && (
            <div
              role="listbox"
              className="absolute left-0 top-[calc(100%+8px)] z-40 w-[268px] rounded-[18px] border border-tm-line bg-tm-surface p-1.5 shadow-[0_18px_48px_rgba(70,54,36,0.14)]"
            >
              {PRESETS.map((preset, index) => {
                const active = index === presetIdx;
                return (
                  <button
                    key={preset.note}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onSelect(index);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-2.5 rounded-[13px] border px-3 py-2.5 text-left transition-colors ${
                      active
                        ? "border-tm-accent-line bg-tm-accent-soft text-tm-accent"
                        : "border-transparent text-tm-ink-2 hover:bg-tm-surface-2"
                    }`}
                  >
                    <span className="flex flex-col items-start gap-0.5">
                      <span className="text-[13px] font-semibold tabular-nums">
                        {preset.focus} / {preset.brk} мин
                      </span>
                      <span className="text-[10px] text-tm-faint">
                        {preset.desc}
                      </span>
                    </span>
                    {active ? (
                      <Check className="h-[15px] w-[15px]" />
                    ) : (
                      <Timer className="h-[15px] w-[15px] opacity-25" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 pr-1 text-[10px] uppercase tracking-[0.12em] text-tm-faint">
        <Settings2 className="h-[13px] w-[13px]" />
        Фокус / перерыв, мин
      </div>
    </div>
  );
}
