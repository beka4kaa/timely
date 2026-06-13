"use client"

import React, { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Flame, CalendarCheck, Trophy, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Habit, daysWord, GLASS } from './lib'

const WEEKDAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']
const MONTHS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

function StatCard({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) {
  return (
    <motion.div whileHover={{ y: -3 }} className={cn(GLASS, 'rounded-[20px] p-4 flex items-center gap-3')}>
      <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ backgroundColor: accent + '22', color: accent }}>
        {icon}
      </div>
      <div>
        <div className="text-xl font-bold leading-none tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{label}</div>
      </div>
    </motion.div>
  )
}

export function Analytics({ habits }: { habits: Habit[] }) {
  const { weeks, totals } = useMemo(() => {
    const total = habits.length || 1
    // Aggregate done-count per date from each habit's calendar (all share same range).
    const dateMap = new Map<string, number>()
    let order: string[] = []
    if (habits[0]) {
      order = habits[0].calendar.map((d) => d.date)
      for (const d of order) dateMap.set(d, 0)
    }
    for (const h of habits) {
      for (const d of h.calendar) {
        if (d.done) dateMap.set(d.date, (dateMap.get(d.date) ?? 0) + 1)
      }
    }
    // Build weeks (columns of 7). order is chronological (oldest..today), length 119.
    const cells = order.map((date) => ({
      date,
      count: dateMap.get(date) ?? 0,
      intensity: (dateMap.get(date) ?? 0) / total,
    }))
    const cols: typeof cells[] = []
    for (let i = 0; i < cells.length; i += 7) cols.push(cells.slice(i, i + 7))

    const activeDays = cells.filter((c) => c.count > 0).length
    const perfectDays = cells.filter((c) => c.count === habits.length && habits.length > 0).length
    const bestStreak = habits.reduce((m, h) => Math.max(m, h.streak), 0)
    const totalDone = habits.reduce((s, h) => s + h.totalDone, 0)

    return { weeks: cols, totals: { activeDays, perfectDays, bestStreak, totalDone } }
  }, [habits])

  const cellColor = (intensity: number) => {
    if (intensity <= 0) return undefined
    return `rgba(16, 185, 129, ${0.25 + 0.75 * Math.min(1, intensity)})`
  }
  // month labels: detect first column of each month
  const monthLabels = weeks.map((w, i) => {
    const first = w[0]
    if (!first) return ''
    const d = new Date(first.date)
    const prev = i > 0 ? new Date(weeks[i - 1][0].date) : null
    return !prev || prev.getMonth() !== d.getMonth() ? MONTHS[d.getMonth()] : ''
  })

  return (
    <div className="flex flex-col gap-6">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={<Flame className="w-5 h-5" />} label="Лучший стрик" value={`${totals.bestStreak} ${daysWord(totals.bestStreak)}`} accent="#f97316" />
        <StatCard icon={<CalendarCheck className="w-5 h-5" />} label="Активных дней" value={`${totals.activeDays}`} accent="#22c55e" />
        <StatCard icon={<Trophy className="w-5 h-5" />} label="Идеальных дней" value={`${totals.perfectDays}`} accent="#eab308" />
        <StatCard icon={<Sparkles className="w-5 h-5" />} label="Всего отметок" value={`${totals.totalDone}`} accent="#6366f1" />
      </div>

      {/* Heatmap */}
      <div className={cn(GLASS, 'rounded-[24px] p-5 sm:p-6 overflow-hidden')}>
        <div className="mb-5">
          <h3 className="font-plus-jakarta text-sm font-bold">Карта активности</h3>
        </div>

        <div className="w-full overflow-x-auto pb-1">
          <div className="mx-auto flex w-max min-w-[650px] flex-col gap-1.5">
            {/* month row */}
            <div className="flex gap-1.5 pl-[104px]">
              {monthLabels.map((m, i) => (
                <div key={i} className="w-5 text-[10px] font-medium text-muted-foreground">
                  {m}
                </div>
              ))}
            </div>

            <div className="flex gap-1.5">
              {/* weekday labels */}
              <div className="mr-2 flex w-24 shrink-0 flex-col gap-1.5">
                {WEEKDAYS.map((d) => (
                  <div
                    key={d}
                    className="h-5 text-right text-[11px] font-medium leading-5 text-muted-foreground"
                  >
                    {d}
                  </div>
                ))}
              </div>

              {/* columns */}
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-1.5">
                  {week.map((cell) => (
                    <div
                      key={cell.date}
                      className="h-5 w-5 rounded-[5px] border border-black/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition-transform hover:scale-125 dark:border-white/10"
                      style={{ backgroundColor: cellColor(cell.intensity) ?? 'rgba(148, 163, 184, 0.10)' }}
                      title={`${cell.date}: ${cell.count} из ${habits.length}`}
                    />
                  ))}
                </div>
              ))}
            </div>

            {/* legend */}
            <div className="mt-4 flex items-center gap-2 pl-[104px] text-[11px] text-muted-foreground">
              меньше
              {[0, 0.25, 0.5, 0.75, 1].map((i) => (
                <div
                  key={i}
                  className="h-4 w-4 rounded-[4px] border border-black/10 dark:border-white/10"
                  style={{ backgroundColor: cellColor(i) ?? 'rgba(148, 163, 184, 0.10)' }}
                />
              ))}
              больше
            </div>
          </div>
        </div>
      </div>

      {/* Per-habit breakdown */}
      <div className={cn(GLASS, 'rounded-[24px] p-5')}>
        <h3 className="font-plus-jakarta text-sm font-bold mb-3">По привычкам</h3>
        <div className="flex flex-col divide-y">
          {habits.map((h) => (
            <div key={h.id} className="flex items-center gap-3 py-2.5">
              <span className="w-8 h-8 rounded-lg flex items-center justify-center text-base" style={{ backgroundColor: h.color + '20' }}>{h.emoji}</span>
              <span className="flex-1 text-sm font-medium truncate">{h.name}</span>
              <span className="text-xs text-muted-foreground">{h.totalDone} отметок</span>
              <span className="flex items-center gap-1 text-sm font-semibold text-orange-500 w-16 justify-end">
                <Flame className="w-3.5 h-3.5" />{h.streak}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
