"use client"

import { useState, useEffect } from "react"
import { GradeCell } from "./grade-cell"
import { LessonDetailDialog } from "./lesson-detail-dialog"
import type { DiaryLesson, Grade, LessonGrades } from "@/types/diary"
import { isTestBlock, isLessonBlock, isFeynmanBlock } from "@/types/diary"
import { cn } from "@/lib/utils"
import { pushGradeUndo } from "@/lib/diary-undo"

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
  const [notes, setNotes] = useState(lesson.notes)
  const [hwTimer, setHwTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const isLesson = isLessonBlock(lesson.blockType)
  const isTest = isTestBlock(lesson.blockType)
  const isFeynman = isFeynmanBlock(lesson.blockType)
  const showGrades = isLesson || isTest || isFeynman

  useEffect(() => { setHw(lesson.homework) }, [lesson.homework])
  useEffect(() => { setNotes(lesson.notes) }, [lesson.notes])

  async function handleGrade(type: keyof LessonGrades, value: Grade) {
    const before = lesson.grades[type]
    const updated: DiaryLesson = { ...lesson, grades: { ...lesson.grades, [type]: value } }
    onChange(updated)
    await patchGrade(weekId, dayId, lesson.id, type, value)
    const typeLabel: Record<keyof LessonGrades, string> = { retelling: 'Пересказ', exercises: 'Упр.', test: 'Тест' }
    pushGradeUndo({
      weekId, dayId, lessonId: lesson.id, gradeField: type,
      before, after: value,
      label: `${typeLabel[type]}: ${value ?? '—'} (предмет: ${lesson.subjectName})`,
    })
  }

  function handleHwChange(val: string) {
    setHw(val)
    if (hwTimer) clearTimeout(hwTimer)
    const t = setTimeout(() => patchField(weekId, dayId, lesson.id, "homework", val), 600)
    setHwTimer(t)
    onChange({ ...lesson, homework: val })
  }

  const avgGrade = (() => {
    if (isLesson) return lesson.grades.exercises !== null ? String(lesson.grades.exercises) : null
    if (isFeynman) return lesson.grades.retelling !== null ? String(lesson.grades.retelling) : null
    if (isTest) return lesson.grades.test !== null ? String(lesson.grades.test) : null
    return null
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

        {/* Subject / block name + inline description */}
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
            {isLesson && (
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
            )}
            {notes && (
              <p className="text-[11px] font-light text-muted-foreground/70 truncate mt-0.5 leading-snug italic">
                {notes}
              </p>
            )}
          </div>
        </div>

        {/* Average / score badge */}
        <div className="min-w-[28px] text-center">
          {avgGrade && (
            <span className="text-xs font-semibold text-muted-foreground tabular-nums">
              {avgGrade}
            </span>
          )}
        </div>

        {/* Grade cell — one per block type */}
        <div className="flex items-center w-10 justify-center">
          {isLesson && (
            <GradeCell type="exercises" value={lesson.grades.exercises} onSave={val => handleGrade("exercises", val)} />
          )}
          {isFeynman && (
            <GradeCell type="retelling" value={lesson.grades.retelling} onSave={val => handleGrade("retelling", val)} />
          )}
          {isTest && (
            <GradeCell type="test" value={lesson.grades.test} onSave={val => handleGrade("test", val)} />
          )}
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
          setNotes(updated.notes)
        }}
      />
    </>
  )
}
