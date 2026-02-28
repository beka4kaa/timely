"use client"

import { ChevronLeftIcon, ChevronRightIcon, CalendarIcon, Settings2Icon } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"

interface WeekNavProps {
  label: string
  isCurrentWeek: boolean
  onPrev: () => void
  onNext: () => void
  onToday: () => void
}

export function WeekNav({ label, isCurrentWeek, onPrev, onNext, onToday }: WeekNavProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1">
        <button
          onClick={onPrev}
          className="p-1.5 rounded-md hover:bg-muted transition-colors"
          title="Предыдущая неделя"
        >
          <ChevronLeftIcon className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border bg-card text-sm min-w-[190px] justify-center">
          <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="font-medium">{label}</span>
        </div>

        <button
          onClick={onNext}
          className="p-1.5 rounded-md hover:bg-muted transition-colors"
          title="Следующая неделя"
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>

      {!isCurrentWeek && (
        <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onToday}>
          Сегодня
        </Button>
      )}

      <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" asChild>
        <Link href="/dashboard/diary/schedule">
          <Settings2Icon className="h-3.5 w-3.5" />
          Расписание
        </Link>
      </Button>
    </div>
  )
}
