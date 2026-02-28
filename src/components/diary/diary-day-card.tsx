"use client"

import { useState } from "react"
import { LessonRow } from "./lesson-row"
import { DayYoutubeLinks } from "./day-youtube-links"
import type { DiaryDay, DiaryLesson, YoutubeLink } from "@/types/diary"
import { cn } from "@/lib/utils"
import { BookOpenIcon } from "lucide-react"

interface DiaryDayCardProps {
  day: DiaryDay
  weekId: string
  isToday?: boolean
}

export function DiaryDayCard({ day, weekId, isToday }: DiaryDayCardProps) {
  const [lessons, setLessons] = useState<DiaryLesson[]>(day.lessons)
  const [youtubeLinks, setYoutubeLinks] = useState<YoutubeLink[]>(day.youtubeLinks ?? [])

  function handleLessonChange(updated: DiaryLesson) {
    setLessons(prev => prev.map(l => l.id === updated.id ? updated : l))
  }

  return (
    <div className={cn(
      "rounded-xl border bg-card overflow-hidden",
      isToday && "border-primary/50 shadow-sm shadow-primary/10"
    )}>
      {/* Column headers */}
      {lessons.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-1.5 border-b bg-muted/10">
          <div className="min-w-[36px]" />
          <div className="flex-1 text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
            Предмет / Д/З
          </div>
          <div className="min-w-[28px]" />
          <div className="w-10 text-[9px] text-muted-foreground font-medium uppercase tracking-wide text-center">
            Оценка
          </div>
        </div>
      )}

      {/* Lessons */}
      {lessons.length > 0 ? (
        <div className="divide-y divide-border/50">
          {lessons.map(lesson => (
            <LessonRow
              key={lesson.id}
              lesson={lesson}
              weekId={weekId}
              dayId={day.id}
              onChange={handleLessonChange}
            />
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 px-4 py-5 text-muted-foreground/50">
          <BookOpenIcon className="h-4 w-4" />
          <span className="text-sm">Нет уроков в этот день</span>
        </div>
      )}

      {/* YouTube / streams section */}
      <DayYoutubeLinks
        weekId={weekId}
        dayId={day.id}
        links={youtubeLinks}
        onLinksChange={setYoutubeLinks}
      />
    </div>
  )
}
