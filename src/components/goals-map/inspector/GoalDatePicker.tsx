"use client"

import React, { useEffect, useState } from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ACCENT_GRADIENT } from '@/components/habits/lib'
import {
  MONTHS_RU, MONTHS_RU_SHORT, WEEKDAYS_RU,
  monthMatrix, parseISO, toISO, todayISO, isToday, monthOf,
} from '../utils/dateRange'

interface Props {
  /** Selected date as "YYYY-MM-DD" (undefined = nothing chosen). */
  value?: string
  onChange: (iso: string | undefined) => void
  placeholder?: string
  /** Pink-accented trigger — use for the deadline field. */
  accent?: boolean
  className?: string
}

function formatTrigger(iso: string): string {
  const d = parseISO(iso)
  return `${d.getDate()} ${MONTHS_RU_SHORT[d.getMonth()]} ${d.getFullYear()}`
}

/**
 * Minimal, on-brand date picker — adaptive liquid-glass calendar in a Radix popover.
 * Portals to <body> so it escapes the inspector's overflow/blur clipping.
 */
export function GoalDatePicker({ value, onChange, placeholder = 'Выбрать дату', accent, className }: Props) {
  const [open, setOpen] = useState(false)
  // Which month the grid is showing (anchored to the value or today).
  const [viewISO, setViewISO] = useState(value ?? todayISO())

  // Re-anchor the visible month each time the popover opens or the value changes.
  useEffect(() => {
    if (open) setViewISO(value ?? todayISO())
  }, [open, value])

  const matrix = monthMatrix(viewISO)
  const curMonth = monthOf(viewISO)
  const view = parseISO(viewISO)

  const shiftMonth = (delta: number) => {
    const d = parseISO(viewISO)
    d.setMonth(d.getMonth() + delta)
    setViewISO(toISO(d))
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className={cn(
            'w-full inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] outline-none transition-colors',
            accent
              ? 'bg-pink-500/[0.06] dark:bg-pink-400/[0.06] border border-pink-500/25 dark:border-pink-400/25 text-foreground hover:border-pink-500/45 dark:hover:border-pink-400/45 data-[state=open]:border-pink-500/55'
              : 'bg-foreground/[0.04] border border-foreground/[0.08] text-foreground/80 hover:border-foreground/20 data-[state=open]:border-foreground/25',
            className,
          )}
        >
          <CalendarIcon className={cn('w-3.5 h-3.5 shrink-0', accent ? 'text-pink-500/80 dark:text-pink-300/80' : 'text-muted-foreground/60')} />
          <span className={cn('truncate', !value && 'text-muted-foreground/45')}>
            {value ? formatTrigger(value) : placeholder}
          </span>
        </button>
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={8}
          className="z-[60] w-[270px] rounded-2xl bg-white/95 dark:bg-[#0e0e14]/[0.97] border border-black/[0.07] dark:border-white/[0.12] backdrop-blur-2xl max-sm:backdrop-blur-none shadow-[0_16px_48px_-8px_rgba(15,23,42,0.35)] dark:shadow-[0_12px_48px_rgba(0,0,0,0.6)] p-3 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
        >
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-2.5">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-[13px] font-semibold text-foreground tabular-nums">
              {MONTHS_RU[view.getMonth()]} {view.getFullYear()}
            </span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Weekday header */}
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {WEEKDAYS_RU.map(w => (
              <div key={w} className="text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/45">
                {w}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-0.5">
            {matrix.flat().map(iso => {
              const d = parseISO(iso)
              const out = d.getMonth() !== curMonth
              const today = isToday(iso)
              const selected = value === iso
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => { onChange(iso); setOpen(false) }}
                  className={cn(
                    'h-8 rounded-lg text-[12px] flex items-center justify-center transition-colors',
                    out && 'opacity-30',
                    selected
                      ? 'text-white font-semibold'
                      : today
                        ? 'text-foreground font-semibold ring-1 ring-pink-500/60 dark:ring-pink-400/60 hover:bg-foreground/[0.06]'
                        : 'text-foreground/80 hover:bg-foreground/[0.06]',
                  )}
                  style={selected ? { background: ACCENT_GRADIENT } : undefined}
                >
                  {d.getDate()}
                </button>
              )
            })}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-foreground/[0.08]">
            <button
              type="button"
              onClick={() => { onChange(todayISO()); setOpen(false) }}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Сегодня
            </button>
            {value && (
              <button
                type="button"
                onClick={() => { onChange(undefined); setOpen(false) }}
                className="text-[11px] text-muted-foreground/70 hover:text-rose-500 dark:hover:text-rose-300 transition-colors"
              >
                Очистить
              </button>
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
