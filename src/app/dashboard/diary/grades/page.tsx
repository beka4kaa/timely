"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { ArrowLeftIcon, GraduationCapIcon, TrendingUpIcon, ChevronLeftIcon, ChevronRightIcon, PlayCircleIcon, ClockIcon, CalendarIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useDiaryYearStats } from "@/hooks/use-diary-year-stats"
import { calcMonthStats } from "@/lib/diary-grades"
import { MONTH_SHORT } from "@/lib/diary-grades"
import { cn } from "@/lib/utils"

// Учебный год: сенавг
const SCHOOL_MONTHS: number[] = [8, 9, 10, 11, 0, 1, 2, 3, 4, 5, 6, 7]

function gradeClass(grade: number | null): string {
  if (grade === null) return "text-muted-foreground/30"
  if (grade >= 4.5) return "text-green-400 font-semibold"
  if (grade >= 3.5) return "text-blue-400 font-medium"
  if (grade >= 2.5) return "text-yellow-400"
  return "text-red-400"
}

function gradeBg(grade: number | null): string {
  if (grade === null) return ""
  if (grade >= 4.5) return "bg-green-500/10"
  if (grade >= 3.5) return "bg-blue-500/10"
  if (grade >= 2.5) return "bg-yellow-500/10"
  return "bg-red-500/10"
}

function yearlyBg(grade: number | null): string {
  if (grade === null) return "bg-muted/30 border-border"
  if (grade >= 4.5) return "bg-green-500/20 border-green-500/30"
  if (grade >= 3.5) return "bg-blue-500/20 border-blue-500/30"
  if (grade >= 2.5) return "bg-yellow-500/20 border-yellow-500/30"
  return "bg-red-500/20 border-red-500/30"
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

type View = "month" | "year" | "videos"

function getYoutubeId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("?")[0]
    if (u.hostname.includes("youtube.com")) return u.searchParams.get("v")
  } catch {}
  return null
}

export default function GradesPage() {
  const now = new Date()
  const defaultSchoolYear = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1
  const [schoolYearStart, setSchoolYearStart] = useState(defaultSchoolYear)
  const [view, setView] = useState<View>("month")

  // Текущий месяц в пределах учебного года
  const initMonth = now.getMonth() // 0-11
  const initYear = now.getFullYear()
  const [viewYear, setViewYear] = useState(initYear)
  const [viewMonth, setViewMonth] = useState(initMonth)

  // Данные учебного года Y1 (sep-dec) и Y2 (jan-aug)
  const { stats: statsY1, weeks: weeksY1, loading: l1 } = useDiaryYearStats(schoolYearStart)
  const { stats: statsY2, weeks: weeksY2, loading: l2 } = useDiaryYearStats(schoolYearStart + 1)
  const loading = l1 || l2
  const allWeeks = useMemo(() => [...weeksY1, ...weeksY2], [weeksY1, weeksY2])

  // Годовые строки
  const yearRows = useMemo(() => {
    const ids = Array.from(new Set([...statsY1.map(s => s.subjectId), ...statsY2.map(s => s.subjectId)]))
    return ids.map(id => {
      const s1 = statsY1.find(s => s.subjectId === id)
      const s2 = statsY2.find(s => s.subjectId === id)
      const ref = s1 ?? s2!
      const monthlyGrades: (number | null)[] = SCHOOL_MONTHS.map(m =>
        m >= 8 ? (s1?.monthlyGrades[m] ?? null) : (s2?.monthlyGrades[m] ?? null)
      )
      const filled = monthlyGrades.filter((v): v is number => v !== null)
      const yearlyGrade = filled.length === 0
        ? null
        : Math.round(filled.reduce((a, b) => a + b, 0) / filled.length * 10) / 10
      return { ...ref, monthlyGrades, yearlyGrade }
    })
  }, [statsY1, statsY2])

  // Месячные строки
  const monthStats = useMemo(
    () => calcMonthStats(allWeeks, viewYear, viewMonth),
    [allWeeks, viewYear, viewMonth]
  )

  const totalDays = daysInMonth(viewYear, viewMonth)
  const dayNumbers = Array.from({ length: totalDays }, (_, i) => i + 1)

  function isoDay(d: number): string {
    return `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear((y: number) => y - 1) }
    else setViewMonth((m: number) => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear((y: number) => y + 1) }
    else setViewMonth((m: number) => m + 1)
  }

  const monthLabel = `${MONTH_SHORT[viewMonth]} ${viewYear}`

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 max-w-6xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link href="/dashboard/diary"><ArrowLeftIcon className="h-4 w-4" /></Link>
        </Button>
        <GraduationCapIcon className="h-6 w-6 text-primary shrink-0" />
        <div className="flex-1">
          <h1 className="text-xl font-bold tracking-tight leading-none">Итоговые оценки</h1>
          <p className="text-muted-foreground text-xs mt-0.5">Таблица успеваемости</p>
        </div>

        {/* View switcher */}
        <div className="flex items-center gap-1 rounded-lg border border-border p-1">
          <Button
            variant={view === "month" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={() => setView("month")}
          >
            По месяцу
          </Button>
          <Button
            variant={view === "year" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={() => setView("year")}
          >
            За год
          </Button>
          <Button
            variant={view === "videos" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={() => setView("videos")}
          >
            Видео
          </Button>
        </div>
      </div>

      {/* Navigation bar */}
      {view === "month" || view === "videos" ? (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevMonth}>
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
          {/* Month tabs (учебный год) */}
          <div className="flex gap-1 overflow-x-auto flex-1">
            {SCHOOL_MONTHS.map(m => {
              const y = m >= 8 ? schoolYearStart : schoolYearStart + 1
              const active = m === viewMonth && y === viewYear
              return (
                <button
                  key={m}
                  onClick={() => { setViewMonth(m); setViewYear(y) }}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  {MONTH_SHORT[m]}
                </button>
              )
            })}
          </div>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextMonth}>
            <ChevronRightIcon className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={() => setSchoolYearStart(y => y - 1)}>
            <ChevronLeftIcon className="h-4 w-4 mr-1" />{schoolYearStart - 1}/{schoolYearStart}
          </Button>
          <span className="font-semibold">{schoolYearStart}  {schoolYearStart + 1}</span>
          <Button variant="outline" size="sm" onClick={() => setSchoolYearStart(y => y + 1)}>
            {schoolYearStart + 1}/{schoolYearStart + 2}<ChevronRightIcon className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}

      {/* Legend (grades only) */}
      {view !== "videos" && <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {[
          { label: "Отлично ( 4.5)", bg: "bg-green-500/20 border-green-500/30" },
          { label: "Хорошо (3.54.4)", bg: "bg-blue-500/20 border-blue-500/30" },
          { label: "Удовл. (2.53.4)", bg: "bg-yellow-500/20 border-yellow-500/30" },
          { label: "Плохо (< 2.5)", bg: "bg-red-500/20 border-red-500/30" },
        ].map(({ label, bg }) => (
          <span key={label} className="flex items-center gap-1.5">
            <span className={cn("w-3 h-3 rounded-sm border inline-block", bg)} />
            {label}
          </span>
        ))}
      </div>}

      {loading ? (
        <div className="flex items-center justify-center min-h-[280px] text-muted-foreground text-sm">
          Загрузка данных
        </div>
      ) : view === "month" ? (
        /*  МЕСЯЧНЫЙ ВИД  */
        monthStats.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 min-h-[260px] gap-3 text-center px-8">
            <TrendingUpIcon className="h-10 w-10 text-muted-foreground/30" />
            <p className="font-semibold text-muted-foreground">{monthLabel}  нет оценок</p>
            <p className="text-sm text-muted-foreground/60">Заполняйте оценки в дневнике, и они появятся здесь.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "140px" }} />
                {dayNumbers.map(d => <col key={d} style={{ width: "26px" }} />)}
                <col style={{ width: "48px" }} />
              </colgroup>
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left pl-3 pr-1 py-2 font-semibold text-xs">Предмет</th>
                  {dayNumbers.map(d => (
                    <th key={d} className="py-2 text-center text-[10px] font-normal text-muted-foreground/70 leading-none">
                      {d}
                    </th>
                  ))}
                  <th className="py-2 text-center text-xs font-semibold border-l border-border">Итог</th>
                </tr>
              </thead>
              <tbody>
                {monthStats.map((row, i) => (
                  <tr key={row.subjectId} className={cn("border-b border-border/50", i % 2 !== 0 && "bg-muted/10")}>
                    <td className="pl-3 pr-1 py-2 text-xs font-medium truncate" title={row.subjectName}>
                      <span className="mr-1 leading-none">{row.subjectEmoji}</span>
                      {row.subjectName}
                    </td>
                    {dayNumbers.map(d => {
                      const g = row.byDay[isoDay(d)] ?? null
                      return (
                        <td key={d} className={cn("py-2 text-center tabular-nums", gradeBg(g))}>
                          <span className={cn("text-[10px] leading-none font-medium", gradeClass(g))}>
                            {g !== null ? g.toFixed(1) : ""}
                          </span>
                        </td>
                      )
                    })}
                    <td className="py-2 text-center border-l border-border">
                      <span className={cn("text-xs font-bold tabular-nums", gradeClass(row.monthGrade))}>
                        {row.monthGrade === null ? "—" : row.monthGrade.toFixed(1)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : view === "videos" ? (
        /*  ВИДЕОЗАПИСИ  */
        (() => {
          const isoPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-`
          const videos: { url: string; label?: string; durationMin?: number; date: string; dayName: string }[] = []
          for (const week of allWeeks) {
            for (const day of week.days) {
              if (!day.date.startsWith(isoPrefix)) continue
              const d = new Date(day.date)
              const dayName = d.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric" })
              for (const link of (day.youtubeLinks ?? [])) {
                videos.push({ url: link.url, label: link.label, durationMin: link.durationMin, date: day.date, dayName })
              }
            }
          }
          const totalMin = videos.reduce((s, v) => s + (v.durationMin ?? 0), 0)
          const monthLabel2 = `${MONTH_SHORT[viewMonth]} ${viewYear}`
          if (videos.length === 0) {
            return (
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 min-h-[260px] gap-3 text-center px-8">
                <PlayCircleIcon className="h-10 w-10 text-muted-foreground/30" />
                <p className="font-semibold text-muted-foreground">{monthLabel2} — нет видео</p>
                <p className="text-sm text-muted-foreground/60">Добавляйте YouTube-ссылки в уроках дневника, и они появятся здесь.</p>
              </div>
            )
          }
          return (
            <div className="flex flex-col gap-4">
              {/* Summary bar */}
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <PlayCircleIcon className="h-4 w-4" />
                  {videos.length} {videos.length === 1 ? "видео" : videos.length < 5 ? "видео" : "видео"}
                </span>
                {totalMin > 0 && (
                  <span className="flex items-center gap-1.5">
                    <ClockIcon className="h-4 w-4" />
                    {Math.floor(totalMin / 60) > 0 ? `${Math.floor(totalMin / 60)} ч ` : ""}{totalMin % 60} мин
                  </span>
                )}
              </div>
              {/* Video cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {videos.map((v, i) => {
                  const vid = getYoutubeId(v.url)
                  return (
                    <a
                      key={i}
                      href={v.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group rounded-xl border border-border bg-card hover:border-primary/50 transition-all overflow-hidden flex flex-col"
                    >
                      {/* Thumbnail */}
                      <div className="relative w-full aspect-video bg-muted overflow-hidden">
                        {vid ? (
                          <img
                            src={`https://img.youtube.com/vi/${vid}/mqdefault.jpg`}
                            alt={v.label ?? "YouTube"}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <PlayCircleIcon className="h-10 w-10 text-muted-foreground/40" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 rounded-full p-2">
                            <PlayCircleIcon className="h-6 w-6 text-white" />
                          </div>
                        </div>
                        {v.durationMin != null && v.durationMin > 0 && (
                          <span className="absolute bottom-1.5 right-1.5 bg-black/80 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
                            {Math.floor(v.durationMin / 60) > 0 ? `${Math.floor(v.durationMin / 60)}:` : ""}{String(v.durationMin % 60).padStart(2, "0")}
                          </span>
                        )}
                      </div>
                      {/* Info */}
                      <div className="p-3 flex flex-col gap-1.5 flex-1">
                        <p className="text-sm font-medium line-clamp-2 leading-snug">
                          {v.label ?? "YouTube видео"}
                        </p>
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-auto">
                          <CalendarIcon className="h-3 w-3" />
                          {v.dayName}
                        </div>
                      </div>
                    </a>
                  )
                })}
              </div>
            </div>
          )
        })()
      ) : (
        /*  ГОДОВОЙ ВИД  */
        yearRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 min-h-[260px] gap-3 text-center px-8">
            <TrendingUpIcon className="h-10 w-10 text-muted-foreground/30" />
            <p className="font-semibold text-muted-foreground">Нет данных за {schoolYearStart}{schoolYearStart + 1}</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="sticky left-0 z-10 bg-muted/60 backdrop-blur text-left px-4 py-3 font-semibold min-w-[170px]">Предмет</th>
                  {SCHOOL_MONTHS.map(m => (
                    <th key={m} className="px-3 py-3 text-center font-medium text-muted-foreground min-w-[56px] text-xs whitespace-nowrap">
                      {MONTH_SHORT[m]}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center font-semibold border-l border-border min-w-[72px]">Год</th>
                </tr>
              </thead>
              <tbody>
                {yearRows.map((row, i) => (
                  <tr key={row.subjectId} className={cn("border-b border-border/50 hover:bg-muted/20 transition-colors", i % 2 !== 0 && "bg-muted/10")}>
                    <td className="sticky left-0 z-10 bg-background px-4 py-3 font-medium whitespace-nowrap border-r border-border/30" style={{ backgroundColor: "hsl(var(--background))" }}>
                      <span className="mr-2 text-base leading-none">{row.subjectEmoji}</span>
                      {row.subjectName}
                    </td>
                    {row.monthlyGrades.map((grade, mi) => (
                      <td key={mi} className={cn("px-3 py-3 text-center tabular-nums", gradeBg(grade))}>
                        <span className={cn("text-sm", gradeClass(grade))}>
                          {grade === null ? "" : grade.toFixed(1)}
                        </span>
                      </td>
                    ))}
                    <td className="px-4 py-3 text-center border-l border-border">
                      <span className={cn("inline-flex items-center justify-center rounded-md px-2.5 py-1 text-sm font-bold tabular-nums border", yearlyBg(row.yearlyGrade), gradeClass(row.yearlyGrade))}>
                        {row.yearlyGrade === null ? "" : row.yearlyGrade.toFixed(1)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/40">
                  <td className="sticky left-0 z-10 bg-muted/60 backdrop-blur px-4 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">Среднее</td>
                  {SCHOOL_MONTHS.map((_, mi) => {
                    const vals = yearRows.map(r => r.monthlyGrades[mi]).filter((v): v is number => v !== null)
                    const avg = vals.length === 0 ? null : Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10
                    return (
                      <td key={mi} className={cn("px-3 py-3 text-center tabular-nums", gradeBg(avg))}>
                        <span className={cn("text-xs font-semibold", gradeClass(avg))}>{avg === null ? "" : avg.toFixed(1)}</span>
                      </td>
                    )
                  })}
                  <td className="px-4 py-3 text-center border-l border-border">
                    {(() => {
                      const all = yearRows.map(r => r.yearlyGrade).filter((v): v is number => v !== null)
                      const avg = all.length === 0 ? null : Math.round(all.reduce((a, b) => a + b, 0) / all.length * 10) / 10
                      return <span className={cn("text-sm font-bold tabular-nums", gradeClass(avg))}>{avg === null ? "" : avg.toFixed(1)}</span>
                    })()}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}
    </div>
  )
}
