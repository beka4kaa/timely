"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { GradeCell } from "./grade-cell"
import type { DiaryLesson, Grade, LessonGrades } from "@/types/diary"
import { isTestBlock, isLessonBlock } from "@/types/diary"
import { cn } from "@/lib/utils"

interface Subject { id: string; name: string; emoji: string }

interface LessonDetailDialogProps {
  lesson: DiaryLesson | null
  weekId: string
  dayId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate: (updated: DiaryLesson) => void
}

async function patchGrade(weekId: string, dayId: string, lessonId: string, type: keyof LessonGrades, value: Grade) {
  await fetch("/api/diary/grade", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ weekId, dayId, lessonId, type, value }),
  })
}

async function patchField(weekId: string, dayId: string, lessonId: string, field: "homework" | "notes", value: string) {
  await fetch("/api/diary/grade", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ weekId, dayId, lessonId, field, value }),
  })
}

async function patchLinkedSubjects(weekId: string, dayId: string, lessonId: string, linkedSubjectIds: string[]) {
  await fetch("/api/diary/grade", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ weekId, dayId, lessonId, linkedSubjectIds }),
  })
}

const GRADE_COLORS: Record<number, string> = {
  5: "text-emerald-500",
  4: "text-blue-500",
  3: "text-amber-400",
  2: "text-red-500",
  1: "text-red-700",
}

export function LessonDetailDialog({
  lesson,
  weekId,
  dayId,
  open,
  onOpenChange,
  onUpdate,
}: LessonDetailDialogProps) {
  const [localLesson, setLocalLesson] = useState<DiaryLesson | null>(lesson)
  const [hwTimer, setHwTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [notesTimer, setNotesTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [subjects, setSubjects] = useState<Subject[]>([])

  const isLesson = isLessonBlock(localLesson?.blockType)
  const isTest = isTestBlock(localLesson?.blockType)

  useEffect(() => {
    if (lesson) setLocalLesson(lesson)
  }, [lesson])

  // Load subjects when test block opens
  useEffect(() => {
    if (!open || !isTest) return
    fetch("/api/subjects").then(r => r.json()).then(data => {
      const list = Array.isArray(data) ? data : (data.results ?? data.subjects ?? [])
      setSubjects(list.map((s: any) => ({ id: String(s.id), name: s.name, emoji: s.emoji ?? "📚" })))
    }).catch(() => {})
  }, [open, isTest])

  if (!localLesson) return null

  async function handleGrade(type: keyof LessonGrades, value: Grade) {
    if (!localLesson) return
    const updated = { ...localLesson, grades: { ...localLesson.grades, [type]: value } }
    setLocalLesson(updated)
    onUpdate(updated)
    await patchGrade(weekId, dayId, localLesson.id, type, value)
  }

  function handleField(field: "homework" | "notes", value: string) {
    if (!localLesson) return
    const updated = { ...localLesson, [field]: value }
    setLocalLesson(updated)
    onUpdate(updated)
    const setter = field === "homework" ? setHwTimer : setNotesTimer
    const timer = field === "homework" ? hwTimer : notesTimer
    if (timer) clearTimeout(timer)
    const t = setTimeout(() => patchField(weekId, dayId, localLesson.id, field, value), 600)
    setter(t)
  }

  function toggleLinkedSubject(subjectId: string) {
    if (!localLesson) return
    const current = localLesson.linkedSubjectIds ?? []
    const next = current.includes(subjectId)
      ? current.filter(id => id !== subjectId)
      : [...current, subjectId]
    const updated = { ...localLesson, linkedSubjectIds: next }
    setLocalLesson(updated)
    onUpdate(updated)
    patchLinkedSubjects(weekId, dayId, localLesson.id, next)
  }

  const grades = localLesson.grades
  const gradeValues = isLesson
    ? Object.values(grades).filter((v): v is number => v !== null)
    : (grades.test !== null ? [grades.test] : [])
  const avg = gradeValues.length ? gradeValues.reduce((a, b) => a + b, 0) / gradeValues.length : null
  const avgRounded = avg !== null ? Math.round(avg) as 1 | 2 | 3 | 4 | 5 : null
  const linkedIds = localLesson.linkedSubjectIds ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="text-2xl">{localLesson.subjectEmoji}</span>
            <div>
              <p className="leading-tight">{localLesson.subjectName}</p>
              <p className="text-xs text-muted-foreground font-normal mt-0.5">
                {localLesson.lessonNumber} · {localLesson.startTime} – {localLesson.endTime}
              </p>
            </div>
            {avg !== null && (
              <span className={cn("ml-auto text-2xl font-bold tabular-nums", avgRounded && GRADE_COLORS[avgRounded])}>
                {avg.toFixed(1)}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">

          {/* LESSON: 3 grade cells + homework + notes */}
          {isLesson && (
            <>
              <div className="grid grid-cols-3 gap-2">
                {(["retelling", "exercises", "test"] as const).map(type => {
                  const labels = { retelling: "Пересказ", exercises: "Упражнения", test: "Тест" }
                  return (
                    <div key={type} className="flex flex-col items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
                        {labels[type]}
                      </span>
                      <GradeCell type={type} value={grades[type]} onSave={val => handleGrade(type, val)} />
                    </div>
                  )
                })}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Описание</Label>
                <Textarea
                  value={localLesson.homework}
                  onChange={e => handleField("homework", e.target.value)}
                  placeholder="Домашнее задание, темы урока..."
                  className="text-sm resize-none min-h-[80px]"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Заметки</Label>
                <Textarea
                  value={localLesson.notes}
                  onChange={e => handleField("notes", e.target.value)}
                  placeholder="Дополнительные заметки..."
                  className="text-sm resize-none min-h-[60px]"
                />
              </div>
            </>
          )}

          {/* TEST BLOCK: single score + subject picker + notes */}
          {isTest && (
            <>
              <div className="flex items-center gap-4">
                <div className="flex flex-col items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">Оценка</span>
                  <GradeCell type="test" value={grades.test} onSave={val => handleGrade("test", val)} />
                </div>
                <p className="text-xs text-muted-foreground flex-1">Выберите предметы, к которым относится этот раздел</p>
              </div>

              {subjects.length > 0 && (
                <div className="flex flex-col gap-2">
                  <Label className="text-xs">Предметы</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {subjects.map(s => {
                      const selected = linkedIds.includes(s.id)
                      return (
                        <button
                          key={s.id}
                          onClick={() => toggleLinkedSubject(s.id)}
                          className={cn(
                            "flex items-center gap-1 px-2 py-1 rounded-md text-xs border transition-colors",
                            selected
                              ? "bg-primary/15 border-primary/50 text-primary font-medium"
                              : "border-border text-muted-foreground hover:bg-muted"
                          )}
                        >
                          <span>{s.emoji}</span>
                          <span>{s.name}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Заметки</Label>
                <Textarea
                  value={localLesson.notes}
                  onChange={e => handleField("notes", e.target.value)}
                  placeholder="Темы теста, результаты..."
                  className="text-sm resize-none min-h-[60px]"
                />
              </div>
            </>
          )}

          {/* OTHER blocks: just notes */}
          {!isLesson && !isTest && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Заметки</Label>
              <Textarea
                value={localLesson.notes}
                onChange={e => handleField("notes", e.target.value)}
                placeholder="Заметки..."
                className="text-sm resize-none min-h-[80px]"
              />
            </div>
          )}

        </div>
      </DialogContent>
    </Dialog>
  )
}
