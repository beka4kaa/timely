"use client"

import { useState, useEffect } from "react"
import { GradeCell } from "./grade-cell"
import { LessonDetailDialog } from "./lesson-detail-dialog"
import type { DiaryLesson, Grade, LessonGrades } from "@/types/diary"
import { GRADE_TYPE_LABELS } from "@/types/diary"
import { cn } from "@/lib/utils"

interface LessonRowProps {
  lesson: DiaryLesson
  weekId: string
  dayId: string
  onChange: (updated: DiaryLesson) => void
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

export function LessonRow({ lesson, weekId, dayId, onChange }: LessonRowProps) {
  const [hw, setHw] = useState(lesson.homework)
  const [hwTimer, setHwTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  useEffect(() => { setHw(lesson.homework) }, [lesson.homework])

  async function handleGrade(type: keyof LessonGrades, value: Grade) {
    const updated: DiaryLesson = { ...lesson, grades: { ...lesson.grades, [type]: value } }
    onChange(updated)
    await patchGrade(weekId, dayId, lesson.id, type, value)
  }

  function handleHwChange(val: string) {
    setHw(val)
    if (hwTimer) clearTimeout(hwTimer)
    const t = setTimeout(() => patchField(weekId, dayId, lesson.id, "homework", val), 600)
    setHwTimer(t)
    onChange({ ...lesson, homework: val })
  }

  const avgGrade = (() => {
    const vals = Object.values(lesson.grades).filter(v => v !== null) as number[]
    if (!vals.length) return null
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)
  })()

  return (
    <>
      <div className="flex items-center gap-3 px-3 py-2.5 group hover:bg-muted/40 transition-colors">
        {/* Lesson number + time */}
        <div className="flex flex-col items-center min-w-[36px]">
          <span className="text-sm font-bold text-foreground leading-none">{lesson.lessonNumber}</span>
          <span className="text-[10px] text-muted-foreground leading-none mt-0.5">{lesson.startTime}</span>
          <span className="text-[10px] text-muted-foreground leading-none">{lesson.endTime}</span>
        </div>

        {/* Subject + inline description */}
        <div className="flex items-center gap-2 flex-1 min-w-0 relative">
          <button
            onClick={() => setDetailOpen(true)}
            className="text-base leading-none shrink-0 hover:scale-110 transition-transform"
            title="Подробнее"
          >
            {lesson.subjectEmoji}
          </button>
          <div className="min-w-0 flex-1">
            <button
              onClick={() => setDetailOpen(true)}
              className="text-sm font-medium truncate leading-tight text-left w-full hover:text-primary transition-colors"
            >
              {lesson.subjectName}
            </button>
            <input
              value={hw}
              onChange={e => handleHwChange(e.target.value)}
              placeholder="Описание..."
              className={cn(
                "w-full text-xs text-muted-foreground bg-transparent border-0 border-b border-transparent",
                "focus:border-primary/40 focus:outline-none focus:text-foreground transition-colors",
                "placeholder:text-muted-foreground/40 mt-0.5 pb-px"
              )}
            />
          </div>
        </div>

        {/* Average badge */}
        <div className="min-w-[28px] text-center">
          {avgGrade && (
            <span className="text-xs font-semibold text-muted-foreground tabular-nums">
              {"\u2300"}{avgGrade}
            </span>
          )}
        </div>

        {/* Grade cells */}
        <div className="flex gap-1.5 items-center">
          {(Object.keys(GRADE_TYPE_LABELS) as Array<keyof LessonGrades>).map(type => (
            <GradeCell
              key={type}
              type={type}
              value={lesson.grades[type]}
              onSave={val => handleGrade(type, val)}
            />
          ))}
        </div>
      </div>

      <LessonDetailDialog
        lesson={lesson}
        weekId={weekId}
        dayId={dayId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onUpdate={updated => {
          onChange(updated)
          setHw(updated.homework)
        }}
      />
    </>
  )
}
