"use client"

import { motion } from "framer-motion"
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
        <TabsList className="flex h-auto w-full gap-1 rounded-[20px] border border-[#ded8cf] bg-[#fbfaf7]/90 p-1.5 shadow-[0_8px_30px_rgba(68,52,34,0.06)] backdrop-blur-xl">
          {days.map(day => {
            const isToday = day.date === today
            const isActive = day.dayOfWeek === activeDow
            return (
              <TabsTrigger
                key={day.dayOfWeek}
                value={day.dayOfWeek}
                className={
                  "flex-1 flex flex-col items-center gap-0.5 py-2 text-xs rounded-2xl relative overflow-hidden transition-transform duration-200 " +
                  "hover:scale-[1.04] active:scale-95 " +
                  (isActive ? "text-[#754a1c]" : "text-[#777067] hover:bg-[#f1ede6]")
                }
              >
                {/* sliding gradient backplate — animates between days via shared layoutId */}
                {isActive && (
                  <motion.span
                    layoutId="diaryDayActive"
                    transition={{ type: "tween", duration: 0.18, ease: "easeOut" }}
                    className="absolute inset-0 rounded-2xl border border-[#d7ad72] bg-[#fff5e4] shadow-[0_5px_16px_rgba(125,82,32,0.08)]"
                  />
                )}
                {isToday && (
                  <span className={"absolute right-1 top-1 z-10 h-1.5 w-1.5 rounded-full ring-2 ring-white/60 " + (isActive ? "bg-[#b77a32]" : "bg-[#c89758]")} />
                )}
                <span className="relative z-10 font-semibold">{DAY_SHORT_LABELS[day.dayOfWeek]}</span>
                <span className="relative z-10 text-[9px] opacity-70">
                  {new Date(day.date).toLocaleDateString("ru-RU", { day: "numeric", month: "numeric" })}
                </span>
                {day.lessons.length > 0 && (
                  <span className="relative z-10 text-[8px] opacity-60">{day.lessons.length} ур.</span>
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
            className="mt-3 data-[state=inactive]:hidden data-[state=active]:animate-in data-[state=active]:fade-in-50 data-[state=active]:slide-in-from-bottom-1"
          >
            {/* Day sub-header */}
            <div className="flex items-center justify-between px-1 pb-2.5">
              <div className="flex items-center gap-2">
                {day.date === today && (
                  <span className="h-2 w-2 rounded-full bg-[#bf8240]" title="Сегодня" />
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
