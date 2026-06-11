"use client"

import React, { useMemo } from 'react'
import { motion } from 'framer-motion'
import { Flame, CalendarCheck, Trophy, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Habit, daysWord, GLASS } from './lib'

const WEEKDAYS = ['', 'Пн', '', 'Ср', '', 'Пт', '']
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
      <div className={cn(GLASS, 'rounded-[24px] p-5 overflow-x-auto')}>
        <h3 className="font-plus-jakarta text-sm font-bold mb-4">Карта активности · 17 недель</h3>
        <div className="inline-flex flex-col gap-1 min-w-max">
          {/* month row */}
          <div className="flex gap-1 ml-7">
            {monthLabels.map((m, i) => (
              <div key={i} className="w-3.5 text-[9px] text-muted-foreground">{m}</div>
            ))}
          </div>
          <div className="flex gap-1">
            {/* weekday labels */}
            <div className="flex flex-col gap-1 mr-1.5">
              {WEEKDAYS.map((d, i) => (
                <div key={i} className="h-3.5 text-[9px] text-muted-foreground leading-[14px] w-5">{d}</div>
              ))}
            </div>
            {/* columns */}
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-1">
                {week.map((cell) => (
                  <div
                    key={cell.date}
                    className="w-3.5 h-3.5 rounded-[3px] border border-black/5 dark:border-white/5"
                    style={{ backgroundColor: cellColor(cell.intensity) ?? 'var(--muted, hsl(210 40% 96%))' }}
                    title={`${cell.date}: ${cell.count} из ${habits.length}`}
                  />
                ))}
              </div>
            ))}
          </div>
          {/* legend */}
          <div className="flex items-center gap-1.5 mt-3 ml-7 text-[10px] text-muted-foreground">
            меньше
            {[0, 0.25, 0.5, 0.75, 1].map((i) => (
              <div key={i} className="w-3 h-3 rounded-[3px]" style={{ backgroundColor: cellColor(i) ?? 'var(--muted, hsl(210 40% 96%))' }} />
            ))}
            больше
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
