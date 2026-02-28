"use client"

import { useEffect, useState, useCallback } from "react"
import { NotebookPenIcon, Loader2, Settings2Icon, BarChart2Icon } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { WeekNav } from "@/components/diary/week-nav"
import { DayTabs } from "@/components/diary/day-tabs"
import type { DiaryWeek, DayOfWeek } from "@/types/diary"

function getMondayOfDate(d: Date): string {
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const m = new Date(d)
  m.setDate(m.getDate() + diff)
  return m.toISOString().slice(0, 10)
}

function addWeeks(iso: string, delta: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + delta * 7)
  return d.toISOString().slice(0, 10)
}

function formatWeekRange(weekStart: string): string {
  const start = new Date(weekStart)
  const end = new Date(weekStart)
  end.setDate(end.getDate() + 6)
  const fmt = (d: Date) => d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" })
  return `${fmt(start)} ${"\u2014"} ${fmt(end)}`
}

function isThisWeek(weekStart: string): boolean {
  return weekStart === getMondayOfDate(new Date())
}

function getTodayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function todayDow(): DayOfWeek {
  const map: DayOfWeek[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
  return map[new Date().getDay()]
}

export default function DiaryPage() {
  const [weekStart, setWeekStart] = useState(() => getMondayOfDate(new Date()))
  const [week, setWeek] = useState<DiaryWeek | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeDow, setActiveDow] = useState<DayOfWeek>(() => todayDow())

  const loadWeek = useCallback(async (ws: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/diary/week?weekStart=${ws}`)
      if (!res.ok) throw new Error(await res.text())
      setWeek(await res.json())
    } catch (e: any) {
      setError(e.message || "Ошибка загрузки")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadWeek(weekStart) }, [weekStart, loadWeek])

  function changeWeek(delta: number) {
    const ws = addWeeks(weekStart, delta)
    setWeekStart(ws)
    setActiveDow(isThisWeek(ws) ? todayDow() : "monday")
  }

  function goToday() {
    const ws = getMondayOfDate(new Date())
    setWeekStart(ws)
    setActiveDow(todayDow())
  }

  const today = getTodayIso()
  const hasAnyLessons = week?.days.some(d => d.lessons.length > 0) ?? false

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 max-w-5xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <NotebookPenIcon className="h-6 w-6 text-primary shrink-0" />
          <div>
            <h1 className="text-xl font-bold tracking-tight leading-none">Дневник</h1>
            <p className="text-muted-foreground text-xs mt-0.5">Школьный дневник</p>
          </div>
        </div>

        <WeekNav
          label={formatWeekRange(weekStart)}
          isCurrentWeek={isThisWeek(weekStart)}
          onPrev={() => changeWeek(-1)}
          onNext={() => changeWeek(1)}
          onToday={goToday}
        />
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center min-h-[320px]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center gap-3 min-h-[300px] text-center">
          <p className="text-destructive text-sm">{error}</p>
          <Button variant="outline" size="sm" onClick={() => loadWeek(weekStart)}>
            Повторить
          </Button>
        </div>
      ) : !hasAnyLessons ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 min-h-[350px] gap-4 text-center px-8">
          <NotebookPenIcon className="h-12 w-12 text-muted-foreground/30" />
          <div>
            <p className="font-semibold text-muted-foreground">Расписание не настроено</p>
            <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">
              Настройте шаблон расписания, чтобы уроки появились в дневнике.
            </p>
          </div>
          <Button size="sm" asChild>
            <Link href="/dashboard/diary/schedule">
              <Settings2Icon className="h-3.5 w-3.5 mr-1.5" />
              Настроить расписание
            </Link>
          </Button>
        </div>
      ) : (
        <DayTabs
          week={week!}
          activeDow={activeDow}
          today={today}
          onDayChange={setActiveDow}
        />
      )}

      {/* Grades link — always visible at the bottom */}
      <div className="flex justify-center pt-2 pb-1">
        <Button variant="outline" size="sm" asChild className="gap-2 text-muted-foreground hover:text-foreground">
          <Link href="/dashboard/diary/grades">
            <BarChart2Icon className="h-3.5 w-3.5" />
            Итоговые оценки
          </Link>
        </Button>
      </div>
    </div>
  )
}
