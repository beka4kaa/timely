"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { NotebookPenIcon, Loader2, Settings2Icon, BarChart2Icon, RefreshCwIcon, KeyboardIcon } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { WeekNav } from "@/components/diary/week-nav"
import { DayTabs } from "@/components/diary/day-tabs"
import type { DiaryWeek, DayOfWeek } from "@/types/diary"
import { toast } from "sonner"
import { performUndo, performRedo, canUndo, canRedo, clearUndoHistory } from "@/lib/diary-undo"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

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
  return `${fmt(start)} \u2014 ${fmt(end)}`
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

function ShortcutRow({ keys, desc }: { keys: string[]; desc: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 border-b border-border/40 last:border-0">
      <span className="text-sm text-muted-foreground flex-1">{desc}</span>
      <div className="flex items-center gap-0.5 shrink-0">
        {keys.map((k, i) => (
          <span key={i} className="flex items-center gap-0.5">
            {i > 0 && <span className="text-muted-foreground/40 text-xs px-0.5">+</span>}
            <kbd className="px-2 py-0.5 rounded border border-border bg-muted text-xs font-mono font-semibold">{k}</kbd>
          </span>
        ))}
      </div>
    </div>
  )
}

async function patchGradeApi(weekId: string, dayId: string, lessonId: string, field: string, value: any) {
  await fetch("/api/diary/grade", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ weekId, dayId, lessonId, type: field, value }),
  })
}

export default function DiaryPage() {
  const [weekStart, setWeekStart] = useState(() => getMondayOfDate(new Date()))
  const [week, setWeek] = useState<DiaryWeek | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeDow, setActiveDow] = useState<DayOfWeek>(() => todayDow())
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [applyingTemplate, setApplyingTemplate] = useState(false)
  const weekStartRef = useRef(weekStart)
  weekStartRef.current = weekStart

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

  async function applyTemplate() {
    setApplyingTemplate(true)
    clearUndoHistory()
    try {
      const res = await fetch("/api/diary/week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart }),
      })
      if (!res.ok) throw new Error(await res.text())
      setWeek(await res.json())
      toast.success("Шаблон применён к текущей неделе", {
        description: "Оценки и заметки обнулены. История отмены очищена.",
      })
    } catch {
      toast.error("Не удалось применить шаблон")
    } finally {
      setApplyingTemplate(false)
    }
  }

  // Global keyboard shortcuts
  useEffect(() => {
    async function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === "INPUT" || tag === "TEXTAREA") return

      if (e.key === "?" && !e.ctrlKey && !e.metaKey) {
        setShortcutsOpen(true)
        return
      }

      if (e.key === "T" && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        e.preventDefault()
        if (!applyingTemplate) applyTemplate()
        return
      }

      if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault()
        if (!canUndo()) { toast.info("Нечего отменять"); return }
        const label = await performUndo(patchGradeApi)
        if (label) {
          toast.success("Отменено", { description: label })
          await loadWeek(weekStartRef.current)
        }
        return
      }

      if (
        ((e.key === "z" || e.key === "Z") && (e.ctrlKey || e.metaKey) && e.shiftKey) ||
        (e.key === "y" && (e.ctrlKey || e.metaKey) && !e.shiftKey)
      ) {
        e.preventDefault()
        if (!canRedo()) { toast.info("Нечего вернуть"); return }
        const label = await performRedo(patchGradeApi)
        if (label) {
          toast.success("Возвращено", { description: label })
          await loadWeek(weekStartRef.current)
        }
        return
      }

      if (e.key === "ArrowLeft" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault(); changeWeek(-1); return
      }
      if (e.key === "ArrowRight" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault(); changeWeek(1); return
      }
    }

    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyingTemplate])

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

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={applyTemplate}
            disabled={applyingTemplate || loading}
            title="Применить шаблон к этой неделе (Ctrl+Shift+T)"
            className="gap-1.5 text-muted-foreground hover:text-foreground"
          >
            {applyingTemplate
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCwIcon className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline text-xs">Шаблон</span>
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShortcutsOpen(true)}
            title="Горячие клавиши (?)"
            className="h-8 w-8 text-muted-foreground"
          >
            <KeyboardIcon className="h-4 w-4" />
          </Button>

          <WeekNav
            label={formatWeekRange(weekStart)}
            isCurrentWeek={isThisWeek(weekStart)}
            onPrev={() => changeWeek(-1)}
            onNext={() => changeWeek(1)}
            onToday={goToday}
          />
        </div>
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
        <DayTabs week={week!} activeDow={activeDow} today={today} onDayChange={setActiveDow} />
      )}

      {/* Grades link */}
      <div className="flex justify-center pt-2 pb-1">
        <Button variant="outline" size="sm" asChild className="gap-2 text-muted-foreground hover:text-foreground">
          <Link href="/dashboard/diary/grades">
            <BarChart2Icon className="h-3.5 w-3.5" />
            Итоговые оценки
          </Link>
        </Button>
      </div>

      {/* Keyboard shortcuts dialog */}
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyboardIcon className="h-5 w-5 text-primary" />
              Горячие клавиши — Дневник
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-1 mb-2">
            Работают только когда фокус не в поле ввода.
          </p>
          <div className="flex flex-col">
            <ShortcutRow keys={["Ctrl", "Z"]}           desc="Отменить последнее действие" />
            <ShortcutRow keys={["Ctrl", "Shift", "Z"]}  desc="Повторить отменённое действие" />
            <ShortcutRow keys={["Ctrl", "Shift", "T"]}  desc="Применить шаблон к текущей неделе" />
            <ShortcutRow keys={["Ctrl", "←"]}           desc="Перейти на предыдущую неделю" />
            <ShortcutRow keys={["Ctrl", "→"]}           desc="Перейти на следующую неделю" />
            <ShortcutRow keys={["?"]}                    desc="Открыть это окно с подсказками" />
          </div>
          <p className="text-xs text-muted-foreground mt-3 leading-relaxed border-t border-border pt-3">
            <strong>Ctrl+Z / Ctrl+Shift+Z</strong> отменяет/возвращает только оценки.
            Текст (описание, заметки) сохраняется автоматически без истории.
            При применении шаблона история отмены сбрасывается.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  )
}
