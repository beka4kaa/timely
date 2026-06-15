"use client"

import React, { useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ACCENT_GRADIENT } from '@/components/habits/lib'
import type { GoalNode } from '@/types/goals'
import { useGoalsStore } from '@/stores/goals-store'
import { MONTHS_RU, MONTHS_RU_SHORT, parseISO, addMonths, todayISO, rangeForScale, goalsInRange } from '../utils/dateRange'

function goalsWord(n: number): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'цель'
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'цели'
  return 'целей'
}
function dotClass(g: GoalNode): string {
  if (g.status === 'blocked') return 'bg-rose-400/70'
  if (g.status === 'done') return 'bg-emerald-400/60'
  if (g.type === 'financial_goal') return 'bg-amber-300/60'
  return 'bg-foreground/30'
}

export function GoalsYearOverview() {
  const goals = useGoalsStore(s => s.goals)
  const selectedDate = useGoalsStore(s => s.selectedDate)
  const setSelectedDate = useGoalsStore(s => s.setSelectedDate)
  const getProgress = useGoalsStore(s => s.getProgress)

  const year = parseISO(selectedDate).getFullYear()
  const selMonth = selectedDate.slice(0, 7)
  const todayMonth = todayISO().slice(0, 7)

  const months = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const key = `${year}-${String(i + 1).padStart(2, '0')}`
      const { start, end } = rangeForScale('month', `${key}-01`)
      const nonArchived = goals.filter(g => g.status !== 'archived')
      const inMonth = goalsInRange(nonArchived, start, end)
      const avg = inMonth.length
        ? Math.round(inMonth.reduce((a, g) => a + getProgress(g.id), 0) / inMonth.length)
        : 0
      return { key, idx: i, goals: inMonth, count: inMonth.length, avg }
    })
  }, [goals, year, getProgress])

  return (
    <div className="flex flex-col h-full">
      {/* year nav */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => setSelectedDate(addMonths(selectedDate, -12))}
          className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
        >
          <ChevronLeft className="w-3 h-3" />
        </button>
        <h2 className="text-[13px] font-bold tabular-nums tracking-tight">{year}</h2>
        <button
          onClick={() => setSelectedDate(addMonths(selectedDate, 12))}
          className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
        >
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>

      {/* Desktop stays narrow; mobile uses compact month tiles instead of wide rows. */}
      <div className="grid grid-cols-2 gap-1 flex-1 max-sm:grid-cols-4 max-sm:gap-1.5 max-sm:flex-none">
        {months.map(m => {
          const selected = m.key === selMonth
          const isCurrent = m.key === todayMonth
          return (
            <button
              key={m.key}
              onClick={() => setSelectedDate(isCurrent ? todayISO() : `${m.key}-01`)}
              className={cn(
                'rounded-lg flex items-center justify-center gap-1 text-[11px] font-medium border min-h-[28px] max-sm:aspect-square max-sm:min-h-0 max-sm:flex-col max-sm:gap-0.5 max-sm:rounded-xl max-sm:text-[10px]',
                selected
                  ? 'border-pink-400/40 bg-pink-400/[0.08] text-foreground shadow-[0_0_8px_rgba(244,114,182,0.10)]'
                  : 'border-foreground/[0.07] text-muted-foreground/70 hover:border-foreground/15 hover:text-foreground/90 hover:bg-foreground/[0.03]',
              )}
            >
              <span>{MONTHS_RU_SHORT[m.idx]}</span>
              {m.count > 0 && (
                <span className="flex items-center gap-[2px]">
                  {m.goals.slice(0, 3).map(g => (
                    <span key={g.id} className={cn('w-[3px] h-[3px] rounded-full', dotClass(g))} />
                  ))}
                </span>
              )}
              {isCurrent && !m.count && (
                <span className="w-[3px] h-[3px] rounded-full shrink-0" style={{ background: ACCENT_GRADIENT }} />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
