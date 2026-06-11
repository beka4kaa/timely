"use client"

import { useState, useMemo } from "react"
import { ChevronLeftIcon, ChevronRightIcon, CalendarIcon } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface WeekNavProps {
  weekStart: string          // ISO "YYYY-MM-DD" of the Monday
  label: string              // display string e.g. "16 мар. — 22 мар."
  isCurrentWeek: boolean
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onWeekSelect: (weekStart: string) => void
}

function addWeeksToIso(iso: string, n: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + n * 7)
  return d.toISOString().slice(0, 10)
}

function getMondayIso(): string {
  const d = new Date()
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

function formatRange(ws: string): string {
  const start = new Date(ws)
  const end = new Date(ws)
  end.setDate(start.getDate() + 6)
  const fmtDay = (d: Date) =>
    d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", "")
  return `${fmtDay(start)} — ${fmtDay(end)}`
}

export function WeekNav({ weekStart, label, isCurrentWeek, onPrev, onNext, onToday, onWeekSelect }: WeekNavProps) {
  const [open, setOpen] = useState(false)
  const todayMonday = getMondayIso()

  // Generate -20 weeks to +4 weeks from today, newest first
  const weeks = useMemo(() => {
    const result: string[] = []
    for (let i = 4; i >= -20; i--) {
      result.push(addWeeksToIso(todayMonday, i))
    }
    return result
  }, [todayMonday])

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onPrev}
        className="p-2 rounded-full bg-white/60 dark:bg-white/[0.06] backdrop-blur-xl border border-white/60 dark:border-white/10 shadow-sm hover:scale-105 active:scale-95 transition-transform"
        title="Предыдущая неделя"
      >
        <ChevronLeftIcon className="h-4 w-4" />
      </button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/60 dark:bg-white/[0.06] backdrop-blur-xl border border-white/60 dark:border-white/10 shadow-sm text-sm min-w-[200px] justify-center hover:scale-[1.02] active:scale-95 transition-transform cursor-pointer"
            title="Выбрать неделю"
          >
            <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="font-medium">{label}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-64 p-1.5 rounded-2xl border-white/60 dark:border-white/10 bg-white/80 dark:bg-[#13131a]/85 backdrop-blur-2xl shadow-[0_20px_50px_-12px_rgba(15,23,42,0.35)]"
          align="center"
        >
          <div className="px-2.5 pt-1.5 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Выбор недели
          </div>
          <div className="max-h-72 overflow-y-auto flex flex-col gap-0.5 pr-0.5">
            {weeks.map(ws => {
              const isSelected = ws === weekStart
              const isCurrent = ws === todayMonday
              return (
                <button
                  key={ws}
                  className={cn(
                    "group w-full flex items-center gap-2.5 text-left px-3 py-2 text-sm rounded-xl transition-colors",
                    isSelected
                      ? "bg-black/[0.06] dark:bg-white/10 font-semibold"
                      : "hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
                  )}
                  onClick={() => { onWeekSelect(ws); setOpen(false) }}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full shrink-0 transition-colors",
                      isCurrent ? "bg-violet-500" : "bg-transparent",
                    )}
                  />
                  <span>{formatRange(ws)}</span>
                </button>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>

      <button
        onClick={onNext}
        className="p-2 rounded-full bg-white/60 dark:bg-white/[0.06] backdrop-blur-xl border border-white/60 dark:border-white/10 shadow-sm hover:scale-105 active:scale-95 transition-transform"
        title="Следующая неделя"
      >
        <ChevronRightIcon className="h-4 w-4" />
      </button>

      {!isCurrentWeek && (
        <button
          onClick={onToday}
          className="ml-1 flex items-center gap-1.5 h-9 px-3.5 rounded-full text-xs font-semibold text-white bg-gradient-to-br from-orange-300 to-violet-400 shadow-[0_8px_20px_-6px_rgba(167,139,250,0.6)] hover:scale-105 active:scale-95 transition-transform"
          title="Вернуться к текущей неделе"
        >
          <CalendarIcon className="h-3.5 w-3.5" />
          Сегодня
        </button>
      )}
    </div>
  )
}
