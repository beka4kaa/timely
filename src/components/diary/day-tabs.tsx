"use client"

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DiaryDayCard } from "./diary-day-card"
import type { DiaryDay, DiaryWeek, DayOfWeek } from "@/types/diary"
import { DAYS_ORDER, DAY_OF_WEEK_LABELS, DAY_SHORT_LABELS } from "@/types/diary"

interface DayTabsProps {
  week: DiaryWeek
  activeDow: DayOfWeek
  today: string
  onDayChange: (dow: DayOfWeek) => void
}

function lessonWord(n: number) {
  if (n === 1) return "урок"
  if (n < 5) return "урока"
  return "уроков"
}

export function DayTabs({ week, activeDow, today, onDayChange }: DayTabsProps) {
  // ALL 7 days always shown in tabs (including Sat/Sun)
  const days: DiaryDay[] = DAYS_ORDER
    .map(dow => week.days.find(d => d.dayOfWeek === dow))
    .filter((d): d is DiaryDay => !!d)

  return (
    <div className="flex flex-col gap-0">
      <Tabs value={activeDow} onValueChange={v => onDayChange(v as DayOfWeek)}>
        <TabsList className="flex w-full rounded-xl rounded-b-none border border-b-0 bg-muted/40 p-1 h-auto gap-0.5">
          {days.map(day => {
            const isToday = day.date === today
            return (
              <TabsTrigger
                key={day.dayOfWeek}
                value={day.dayOfWeek}
                className="flex-1 flex flex-col items-center gap-0.5 py-1.5 text-xs rounded-lg relative data-[state=active]:bg-background data-[state=active]:shadow-sm"
              >
                {isToday && (
                  <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary" />
                )}
                <span className="font-semibold">{DAY_SHORT_LABELS[day.dayOfWeek]}</span>
                <span className="text-[9px] text-muted-foreground">
                  {new Date(day.date).toLocaleDateString("ru-RU", { day: "numeric", month: "numeric" })}
                </span>
                {day.lessons.length > 0 && (
                  <span className="text-[8px] text-muted-foreground/70">{day.lessons.length} ур.</span>
                )}
              </TabsTrigger>
            )
          })}
        </TabsList>

        {days.map(day => (
          <TabsContent
            key={day.dayOfWeek}
            value={day.dayOfWeek}
            forceMount
            className="mt-0 border border-t-0 rounded-xl rounded-t-none data-[state=inactive]:hidden"
          >
            {/* Day sub-header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/20">
              <div className="flex items-center gap-2">
                {day.date === today && (
                  <span className="inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                    Сегодня
                  </span>
                )}
                <span className="font-semibold text-sm">{DAY_OF_WEEK_LABELS[day.dayOfWeek]}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(day.date).toLocaleDateString("ru-RU", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {day.lessons.length} {lessonWord(day.lessons.length)}
              </span>
            </div>

            <DiaryDayCard day={day} weekId={week.id} isToday={day.date === today} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
