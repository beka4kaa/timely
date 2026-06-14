"use client"

import React, { useMemo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useGoalsStore } from '@/stores/goals-store'
import { MONTHS_RU, parseISO, rangeForScale, goalsInRange } from '../utils/dateRange'
import { CompactMonthCalendar } from './CompactMonthCalendar'

export function SelectedMonthSection() {
  const goals = useGoalsStore(s => s.goals)
  const selectedDate = useGoalsStore(s => s.selectedDate)
  const getProgress = useGoalsStore(s => s.getProgress)

  const monthKey = selectedDate.slice(0, 7)
  const d = parseISO(selectedDate)

  const { count, avg } = useMemo(() => {
    const { start, end } = rangeForScale('month', selectedDate)
    const rel = goalsInRange(goals, start, end)
    return {
      count: rel.length,
      avg: rel.length
        ? Math.round(rel.reduce((a, g) => a + getProgress(g.id), 0) / rel.length)
        : 0,
    }
  }, [goals, selectedDate, getProgress])

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={monthKey}
        initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="flex items-baseline gap-2 mb-2">
          <h2 className="text-sm font-bold tracking-tight">{MONTHS_RU[d.getMonth()]}</h2>
          <span className="text-[11px] text-muted-foreground">
            {count > 0 ? `${count} · ${avg}%` : 'нет целей'}
          </span>
        </div>
        <CompactMonthCalendar />
      </motion.div>
    </AnimatePresence>
  )
}
