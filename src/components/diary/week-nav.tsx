"use client"

import { useState, useMemo } from "react"
import { ChevronLeftIcon, ChevronRightIcon, CalendarIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
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
        <PopoverContent className="w-56 p-1" align="center">
          <div className="max-h-72 overflow-y-auto">
            {weeks.map(ws => {
              const isSelected = ws === weekStart
              const isCurrent = ws === todayMonday
              return (
                <button
                  key={ws}
                  className={cn(
                    "w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors",
                    "hover:bg-muted",
                    isSelected && "bg-muted font-semibold",
                  )}
                  onClick={() => { onWeekSelect(ws); setOpen(false) }}
                >
                  <span>{formatRange(ws)}</span>
                  {isCurrent && (
                    <span className="ml-2 text-[10px] text-muted-foreground">Тек.</span>
                  )}
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
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onToday}>
          Сегодня
        </Button>
      )}
    </div>
  )
}
