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
    <div className="relative flex items-center gap-1">
      <button
        onClick={onPrev}
        className="rounded-full border border-[#ddd8d0] bg-[#fbfaf7]/90 p-2 text-[#6f6961] shadow-sm backdrop-blur-xl transition-all duration-150 hover:border-[#cfc4b5] hover:bg-white active:scale-95"
        title="Предыдущая неделя"
      >
        <ChevronLeftIcon className="h-4 w-4" />
      </button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className="flex min-w-[200px] cursor-pointer items-center justify-center gap-2 rounded-full border border-[#ddd8d0] bg-[#fbfaf7]/90 px-4 py-2 text-sm shadow-sm backdrop-blur-xl transition-all duration-150 hover:border-[#cfc4b5] hover:bg-white active:scale-95"
            title="Выбрать неделю"
          >
            <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="font-medium">{label}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-64 rounded-2xl border-[#ded8cf] bg-[#fbfaf7]/95 p-1.5 shadow-[0_20px_50px_-12px_rgba(66,50,32,0.24)] backdrop-blur-2xl"
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
                      ? "bg-[#efe7db] font-semibold text-[#70491f]"
                      : "hover:bg-[#f2eee7]",
                  )}
                  onClick={() => { onWeekSelect(ws); setOpen(false) }}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full shrink-0 transition-colors",
                      isCurrent ? "bg-[#b77a32]" : "bg-transparent",
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
        className="rounded-full border border-[#ddd8d0] bg-[#fbfaf7]/90 p-2 text-[#6f6961] shadow-sm backdrop-blur-xl transition-all duration-150 hover:border-[#cfc4b5] hover:bg-white active:scale-95"
        title="Следующая неделя"
      >
        <ChevronRightIcon className="h-4 w-4" />
      </button>

      {!isCurrentWeek && (
        <button
          onClick={onToday}
          className="absolute left-full top-1/2 -translate-y-1/2 ml-2 p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors duration-150"
          title="Вернуться к текущей неделе"
          aria-label="Сегодня"
        >
          <CalendarIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
