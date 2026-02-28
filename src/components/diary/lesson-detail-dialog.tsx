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
import { cn } from "@/lib/utils"

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

  useEffect(() => {
    if (lesson) setLocalLesson(lesson)
  }, [lesson])

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

  const grades = localLesson.grades
  const gradeValues = Object.values(grades).filter((v): v is number => v !== null)
  const avg = gradeValues.length ? (gradeValues.reduce((a, b) => a + b, 0) / gradeValues.length) : null
  const avgRounded = avg !== null ? Math.round(avg) as 1 | 2 | 3 | 4 | 5 : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <span className="text-2xl">{localLesson.subjectEmoji}</span>
            <div>
              <p className="leading-tight">{localLesson.subjectName}</p>
              <p className="text-xs text-muted-foreground font-normal mt-0.5">
                {localLesson.lessonNumber} урок · {localLesson.startTime} – {localLesson.endTime}
              </p>
            </div>
            {avg !== null && (
              <span
                className={cn(
                  "ml-auto text-2xl font-bold tabular-nums",
                  avgRounded && GRADE_COLORS[avgRounded]
                )}
              >
                {avg.toFixed(1)}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {/* Grades section */}
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2">
            {(["retelling", "exercises", "test"] as const).map(type => {
              const labels = { retelling: "Пересказ", exercises: "Упражнения", test: "Тест" }
              return (
                <div key={type} className="flex flex-col items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-medium">
                    {labels[type]}
                  </span>
                  <GradeCell
                    type={type}
                    value={grades[type]}
                    onSave={val => handleGrade(type, val)}
                  />
                </div>
              )
            })}
          </div>

          {/* Description (homework) */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Описание</Label>
            <Textarea
              value={localLesson.homework}
              onChange={e => handleField("homework", e.target.value)}
              placeholder="Домашнее задание, темы урока, задачи..."
              className="text-sm resize-none min-h-[80px]"
            />
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Заметки</Label>
            <Textarea
              value={localLesson.notes}
              onChange={e => handleField("notes", e.target.value)}
              placeholder="Дополнительные заметки..."
              className="text-sm resize-none min-h-[60px]"
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
