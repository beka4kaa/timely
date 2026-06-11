"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { NotebookPenIcon, Loader2, Settings2Icon, BarChart2Icon, RefreshCwIcon, KeyboardIcon, AlertTriangleIcon } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { WeekNav } from "@/components/diary/week-nav"
import { DayTabs } from "@/components/diary/day-tabs"
import { AmbientBackground } from "@/components/ambient-bg"
import type { DiaryWeek, DayOfWeek } from "@/types/diary"
import { toast } from "sonner"
import { useDiaryHeader } from "@/contexts/diary-header-ctx"
import {
  performUndo, performRedo, canUndo, canRedo, clearUndoHistory,
  pushTemplateUndo, subscribeHistory,
} from "@/lib/diary-undo"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
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

async function restoreWeekApi(_weekId: string, snapshot: any) {
  await fetch("/api/diary/week", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snapshot),
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
  const [confirmTemplateOpen, setConfirmTemplateOpen] = useState(false)
  const [undoAvail, setUndoAvail] = useState(false)
  const [redoAvail, setRedoAvail] = useState(false)
  const { register, unregister } = useDiaryHeader()

  // Track undo/redo availability reactively
  useEffect(() => {
    return subscribeHistory(() => {
      setUndoAvail(canUndo())
      setRedoAvail(canRedo())
    })
  }, [])

  // Register diary actions in the site header context
  useEffect(() => {
    register({
      onTemplate: handleTemplateClick,
      onShortcuts: () => setShortcutsOpen(true),
      onUndo: async () => {
        if (!canUndo()) return
        const label = await performUndo(patchGradeApi, restoreWeekApi)
        if (label) { toast.success("Отменено", { description: label }); await loadWeek(weekStartRef.current) }
      },
      onRedo: async () => {
        if (!canRedo()) return
        const label = await performRedo(patchGradeApi, restoreWeekApi)
        if (label) { toast.success("Возвращено", { description: label }); await loadWeek(weekStartRef.current) }
      },
      canUndo: undoAvail,
      canRedo: redoAvail,
      applyingTemplate,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyingTemplate, undoAvail, redoAvail])

  // Unregister when leaving the diary page
  useEffect(() => () => unregister(), [unregister])
  const weekStartRef = useRef(weekStart)
  weekStartRef.current = weekStart
  const weekRef = useRef(week)
  weekRef.current = week

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

    // Fetch the latest week state from the server before snapshotting —
    // DiaryPage.week is stale (grade changes update local state, not week state here)
    let weekSnapshot: any = null
    let freshWeekId: string = weekRef.current?.id ?? weekStartRef.current
    try {
      const freshRes = await fetch(`/api/diary/week?weekStart=${weekStartRef.current}`)
      if (freshRes.ok) {
        const freshWeek = await freshRes.json()
        weekSnapshot = freshWeek           // store FULL week for reliable undo
        freshWeekId = freshWeek.id         // real UUID
      }
    } catch {
      // snapshot stays null — undo won't restore grades (acceptable fallback)
    }

    try {
      const res = await fetch("/api/diary/week", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart }),
      })
      if (!res.ok) throw new Error(await res.text())
      const newWeek = await res.json()
      setWeek(newWeek)

      clearUndoHistory()
      if (weekSnapshot) {
        pushTemplateUndo({
          weekId: freshWeekId,
          weekSnapshot,  // full DiaryWeek before template was applied
          label: `Шаблон применён к неделе ${formatWeekRange(weekStartRef.current)}`,
        })
      }

      toast.success("Шаблон применён к текущей неделе", {
        description: "Оценки и заметки обнулены. Нажмите Ctrl+Z чтобы отменить.",
      })
    } catch {
      toast.error("Не удалось применить шаблон")
    } finally {
      setApplyingTemplate(false)
    }
  }

  function handleTemplateClick() {
    setConfirmTemplateOpen(true)
  }

  async function handleTemplateConfirm() {
    setConfirmTemplateOpen(false)
    await applyTemplate()
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
        if (!applyingTemplate) handleTemplateClick()
        return
      }

      if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault()
        if (!canUndo()) { toast.info("Нечего отменять"); return }
        const label = await performUndo(patchGradeApi, restoreWeekApi)
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
        const label = await performRedo(patchGradeApi, restoreWeekApi)
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
    <div className="relative min-h-full">
      <AmbientBackground />
      <div className="relative z-10 flex flex-col gap-4 p-4 md:p-6 max-w-5xl mx-auto w-full">
      {/* Week navigation */}
      <div className="flex items-center justify-center">
        <WeekNav
          weekStart={weekStart}
          label={formatWeekRange(weekStart)}
          isCurrentWeek={isThisWeek(weekStart)}
          onPrev={() => changeWeek(-1)}
          onNext={() => changeWeek(1)}
          onToday={goToday}
          onWeekSelect={(ws) => { setWeekStart(ws); setActiveDow(isThisWeek(ws) ? todayDow() : "monday") }}
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
        <div className="flex flex-col items-center justify-center rounded-[24px] border border-dashed border-foreground/15 bg-white/40 dark:bg-white/[0.04] backdrop-blur-xl min-h-[350px] gap-4 text-center px-8 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
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

      {/* Template confirmation dialog */}
      <Dialog open={confirmTemplateOpen} onOpenChange={setConfirmTemplateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangleIcon className="h-5 w-5 text-amber-500" />
              Применить шаблон?
            </DialogTitle>
            <DialogDescription className="pt-1">
              Это действие сбросит все оценки и домашние задания за текущую неделю
              и заполнит её уроками из шаблона расписания.
              <br />
              <span className="text-foreground/80 font-medium mt-2 block">
                Вы сможете отменить это через Ctrl+Z.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setConfirmTemplateOpen(false)}
            >
              Отмена
            </Button>
            <Button
              onClick={handleTemplateConfirm}
              disabled={applyingTemplate}
              className="gap-1.5"
            >
              {applyingTemplate
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <RefreshCwIcon className="h-4 w-4" />}
              Применить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <ShortcutRow keys={["Ctrl", "Z"]} desc="Отменить последнее действие" />
            <ShortcutRow keys={["Ctrl", "Shift", "Z"]} desc="Повторить отменённое действие" />
            <ShortcutRow keys={["Ctrl", "Shift", "T"]} desc="Применить шаблон к текущей неделе" />
            <ShortcutRow keys={["Ctrl", "←"]} desc="Перейти на предыдущую неделю" />
            <ShortcutRow keys={["Ctrl", "→"]} desc="Перейти на следующую неделю" />
            <ShortcutRow keys={["?"]} desc="Открыть это окно с подсказками" />
          </div>
          <p className="text-xs text-muted-foreground mt-3 leading-relaxed border-t border-border pt-3">
            <strong>Ctrl+Z / Ctrl+Shift+Z</strong> отменяет/возвращает как оценки, так и применение шаблона.
            Текст (описание, заметки) сохраняется автоматически без истории.
          </p>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  )
}
