"use client"

import React, { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ACCENT_GRADIENT, GLASS } from '@/components/habits/lib'
import type { GoalView } from '@/types/goals'
import { useGoalsStore } from '@/stores/goals-store'
import { YearRouletteGate } from './plan/YearRouletteGate'
import { GoalsYearOverview } from './plan/GoalsYearOverview'
import { SelectedMonthSection } from './plan/SelectedMonthSection'
import { GoalsTreeList } from './plan/GoalsTreeList'
import { GoalsGraphView } from './graph/GoalsGraphView'
import { GoalMiniInspector } from './inspector/GoalMiniInspector'
import { CreateGoalPopover } from './create/CreateGoalPopover'

const VIEWS: { id: GoalView; label: string }[] = [
  { id: 'plan', label: 'План' },
  { id: 'graph', label: 'Граф' },
]

export function GoalsLayout() {
  const activeView = useGoalsStore(s => s.activeView)
  const setActiveView = useGoalsStore(s => s.setActiveView)
  const loadGoals = useGoalsStore(s => s.loadGoals)
  const isLoading = useGoalsStore(s => s.isLoading)
  const hasLoaded = useGoalsStore(s => s.hasLoaded)
  const loadError = useGoalsStore(s => s.loadError)
  const [mounted, setMounted] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [showYearGate, setShowYearGate] = useState(true)
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (mounted) void loadGoals()
  }, [loadGoals, mounted])

  if (!mounted || (isLoading && !hasLoaded)) {
    return <div className="flex items-center justify-center py-32 text-sm text-muted-foreground">Загрузка целей…</div>
  }

  if (loadError && !hasLoaded) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3 text-center">
        <p className="text-sm font-medium text-foreground/80">Не удалось загрузить цели с сервера</p>
        <p className="max-w-sm text-xs text-muted-foreground">{loadError}</p>
        <button
          onClick={() => void loadGoals(true)}
          className="rounded-xl border border-foreground/10 px-3 py-1.5 text-xs text-muted-foreground hover:bg-foreground/[0.05] hover:text-foreground transition-colors"
        >
          Повторить
        </button>
      </div>
    )
  }

  // Reusable План/Граф switcher + create button (floats over the board in graph mode).
  const controls = (
    <div className="flex items-center gap-2 shrink-0">
      <div className="inline-flex items-center gap-1 p-1 rounded-full bg-foreground/[0.05] border border-foreground/[0.08] backdrop-blur-xl">
        {VIEWS.map(v => {
          const active = activeView === v.id
          return (
            <button
              key={v.id}
              onClick={() => setActiveView(v.id)}
              className={cn(
                'inline-flex items-center justify-center gap-1.5 min-w-[60px] max-sm:min-w-0 h-8 px-4 max-sm:px-3 rounded-full text-[13px] font-medium transition-colors',
                active
                  ? 'bg-foreground/[0.09] text-foreground border border-foreground/10'
                  : 'text-muted-foreground hover:text-foreground border border-transparent',
              )}
            >
              {active && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: ACCENT_GRADIENT }} />}
              {v.label}
            </button>
          )
        })}
      </div>

      <div className="relative">
        <button
          onClick={() => setCreateOpen(o => !o)}
          title="Новая цель"
          className="w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-sm hover:brightness-110 transition-all active:scale-95"
          style={{ background: ACCENT_GRADIENT }}
        >
          <Plus className="w-4.5 h-4.5" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  )

  const header = (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-plus-jakarta text-3xl max-sm:text-2xl font-extrabold tracking-tight">Карта целей</h1>
        <p className="text-muted-foreground text-sm mt-1 max-sm:hidden">Планируй цели по месяцам и связывай их в граф</p>
      </div>
      {controls}
    </div>
  )

  if (activeView === 'graph') {
    // Full-bleed board. Only the floating controls levitate on top — no title,
    // no calendar, no month description.
    return (
      <div className="relative h-full w-full">
        <motion.div
          key="graph"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="absolute inset-0 p-2"
        >
          <GoalsGraphView />
        </motion.div>

        {/* План/Граф + «+» — floating top-right, fixed in place */}
        <div className="absolute top-4 right-6 z-20">
          {controls}
        </div>

        <GoalMiniInspector />
        <CreateGoalPopover open={createOpen} onClose={() => setCreateOpen(false)} />
      </div>
    )
  }

  return (
    <div className={`max-w-5xl mx-auto w-full p-6 max-sm:p-4 flex flex-col gap-5${showYearGate ? ' overflow-hidden' : ' pb-12'}`}>
      {header}
      <AnimatePresence mode="wait" initial={false}>
        {showYearGate ? (
          <motion.div
            key="year-gate"
            layout
            initial={{ opacity: 0, y: 18, scale: 0.985, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -28, scale: 0.965, filter: 'blur(10px)' }}
            transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col gap-5"
          >
            <YearRouletteGate onEnter={() => setShowYearGate(false)} />
          </motion.div>
        ) : (
          <motion.div
            key="plan"
            layout
            initial={{ opacity: 0, y: 34, scale: 0.985, filter: 'blur(10px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -16, scale: 0.985, filter: 'blur(6px)' }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col gap-4 items-center"
          >
            {/* Top: months + day calendar unified in one compact card (centered) */}
            <section className={cn(GLASS, 'rounded-[20px] p-3 w-full max-w-2xl')}>
              <div className="grid grid-cols-[150px_1fr] gap-3 max-sm:grid-cols-1 max-sm:gap-3">
                {/* Left: year nav + months */}
                <GoalsYearOverview />
                {/* Right: month title + day calendar */}
                <div className="border-l border-foreground/[0.07] pl-3 max-sm:border-l-0 max-sm:border-t max-sm:pl-0 max-sm:pt-3">
                  <SelectedMonthSection />
                </div>
              </div>
            </section>

            {/* Bottom: folder/goal tree (centered, same width as the calendar) */}
            <section className={cn(GLASS, 'rounded-[24px] p-4 w-full max-w-2xl')}>
              <GoalsTreeList />
            </section>
          </motion.div>
        )}
      </AnimatePresence>
      <GoalMiniInspector />
      <CreateGoalPopover open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}
