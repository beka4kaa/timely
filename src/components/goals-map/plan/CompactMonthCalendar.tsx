"use client"

import React, { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { useGoalsStore } from '@/stores/goals-store'
import type { GoalNode } from '@/types/goals'
import { WEEKDAYS_RU, monthMatrix, monthOf, isToday, parseISO, goalsOnDate, todayISO } from '../utils/dateRange'

function dotClass(g: GoalNode): string {
  if (g.status === 'blocked') return 'bg-rose-400/70'
  if (g.status === 'done') return 'bg-emerald-400/60'
  if (g.type === 'financial_goal') return 'bg-amber-300/60'
  return 'bg-foreground/35'
}

export function CompactMonthCalendar() {
  const selectedDate = useGoalsStore(s => s.selectedDate)
  const setSelectedDate = useGoalsStore(s => s.setSelectedDate)
  const goals = useGoalsStore(s => s.goals)
  const createGoal = useGoalsStore(s => s.createGoal)
  const selectGoal = useGoalsStore(s => s.selectGoal)

  const matrix = useMemo(() => monthMatrix(selectedDate), [selectedDate])
  const visibleDays = useMemo(() => matrix.flat(), [matrix])
  const goalsByDay = useMemo(
    () => new Map(visibleDays.map(iso => [iso, goalsOnDate(goals, iso)] as const)),
    [goals, visibleDays],
  )
  const cur = monthOf(selectedDate)

  return (
    <div>
      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {WEEKDAYS_RU.map(w => (
          <div key={w} className="text-center text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/60">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {visibleDays.map(iso => {
          const d = parseISO(iso)
          const out = d.getMonth() !== cur
          const today = isToday(iso)
          const selected = selectedDate === iso
          const dayGoals = goalsByDay.get(iso) ?? []
          return (
            <button
              key={iso}
              onClick={() => setSelectedDate(iso)}
              onDoubleClick={() => { const id = createGoal({ title: 'Новая цель', type: 'goal', status: 'active', dueDate: iso, month: iso.slice(0, 7) }); selectGoal(id) }}
              className={cn(
                'relative h-8 rounded-md flex flex-col items-center justify-center gap-0.5 transition-colors',
                out && 'opacity-30',
                selected ? 'bg-foreground/[0.09] ring-1 ring-foreground/15' : 'hover:bg-foreground/[0.05]',
              )}
            >
              <span className={cn(
                'text-[11px] leading-none flex items-center justify-center',
                today ? 'w-[18px] h-[18px] rounded-full ring-1 ring-pink-400/70 text-foreground font-semibold' : 'text-foreground/80',
              )}>{d.getDate()}</span>
              {dayGoals.length > 0 && (
                <span className="flex gap-[2px] items-center h-1">
                  {dayGoals.slice(0, 3).map(g => <span key={g.id} className={cn('w-[3px] h-[3px] rounded-full', dotClass(g))} />)}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
