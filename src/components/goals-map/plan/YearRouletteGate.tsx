"use client"

import React, { useEffect, useMemo, useRef } from 'react'
import { animate, motion, useMotionValue } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { ACCENT_GRADIENT } from '@/components/habits/lib'
import { useGoalsStore } from '@/stores/goals-store'
import { goalsInRange, parseISO, rangeForScale } from '../utils/dateRange'

function goalsWord(n: number): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'цель'
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'цели'
  return 'целей'
}

function yearAnchor(year: number) { return `${year}-06-15` }

// Layout height and translation step MUST match, otherwise the active item
// drifts off-center by (STEP - HEIGHT) for every index away from zero.
const ITEM_H = 128
// Smoother scroll: bigger threshold + longer cooldown prevent multi-year jumps on one swipe
const WHEEL_THRESHOLD = 72
const WHEEL_COOLDOWN  = 280   // ms between year changes

const GLOW = '0 0 40px rgba(255,255,255,0.36), 0 0 80px rgba(255,255,255,0.10)'
const MASK  = 'linear-gradient(to bottom, transparent 0%, black 22%, black 72%, transparent 100%)'

// Distance-based depth-of-field: items farther from center shrink, fade and blur.
function depth(dist: number): { scale: number; opacity: number; blur: number } {
  switch (Math.min(dist, 4)) {
    case 0:  return { scale: 1,    opacity: 1,    blur: 0   }
    case 1:  return { scale: 0.60, opacity: 0.50, blur: 0   }
    case 2:  return { scale: 0.44, opacity: 0.26, blur: 1.4 }
    case 3:  return { scale: 0.34, opacity: 0.13, blur: 2.6 }
    default: return { scale: 0.28, opacity: 0.07, blur: 3.6 }
  }
}

export function YearRouletteGate({ onEnter }: { onEnter: () => void }) {
  const goals        = useGoalsStore(s => s.goals)
  const selectedDate = useGoalsStore(s => s.selectedDate)
  const setSelectedDate = useGoalsStore(s => s.setSelectedDate)
  const getProgress  = useGoalsStore(s => s.getProgress)

  const currentYear = new Date().getFullYear()

  const years = useMemo(() => {
    const start = currentYear - 4
    return Array.from({ length: 13 }, (_, i) => start + i)
  }, [currentYear])

  const wheelDeltaRef  = useRef(0)
  const lastWheelAtRef = useRef(0)

  // selectedDate (store) is the single source of truth — the active year is
  // derived from it, never duplicated into local state. That keeps the list
  // position and the per-item styling reading the same activeIndex, so the
  // selected year can never drift out of the center.
  const activeYear = useMemo(() => {
    const y = parseISO(selectedDate).getFullYear()
    return years.includes(y) ? y : currentYear
  }, [selectedDate, years, currentYear])
  const activeIndex = Math.max(0, years.indexOf(activeYear))
  // The list sits at top:50% of the viewport, so its top edge starts at the
  // vertical center. Translating up by (index * ITEM_H + ITEM_H/2) lands the
  // active item's center exactly on the viewport center — no measurement needed,
  // so it stays correct through any resize.
  const offsetFor = (idx: number) => -(idx * ITEM_H + ITEM_H / 2)
  const listY = useMotionValue(offsetFor(activeIndex))

  const stats = useMemo(() => {
    const nonArchived = goals.filter(g => g.status !== 'archived')
    return new Map(years.map(year => {
      const { start, end } = rangeForScale('year', yearAnchor(year))
      const inYear = goalsInRange(nonArchived, start, end)
      const progress = inYear.length
        ? Math.round(inYear.reduce((s, g) => s + getProgress(g.id), 0) / inYear.length)
        : 0
      return [year, { count: inYear.length, progress }] as const
    }))
  }, [getProgress, goals, years])

  useEffect(() => {
    const ctrl = animate(listY, offsetFor(activeIndex), {
      type: 'spring', stiffness: 140, damping: 26, mass: 0.9,
    })
    return () => ctrl.stop()
  }, [activeIndex, listY])

  const chooseYear = (year: number) => setSelectedDate(yearAnchor(year))
  const moveYear = (delta: number) => {
    const idx  = Math.min(years.length - 1, Math.max(0, activeIndex + delta))
    const next = years[idx]
    if (next !== activeYear) chooseYear(next)
  }
  const enterYear = (year = activeYear) => {
    setSelectedDate(yearAnchor(year))
    onEnter()
  }

  const activeStat = stats.get(activeYear) ?? { count: 0, progress: 0 }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="relative flex flex-col items-center"
    >
      {/* ── roulette wheel ── */}
      <div
        tabIndex={0}
        className="relative w-full max-w-[520px] overflow-hidden outline-none"
        style={{
          height: 'calc(100vh - 240px)',
          WebkitMaskImage: MASK,
          maskImage: MASK,
        }}
        onWheel={(e) => {
          e.preventDefault()
          wheelDeltaRef.current += e.deltaY
          if (Math.abs(wheelDeltaRef.current) < WHEEL_THRESHOLD) return
          const now = Date.now()
          if (now - lastWheelAtRef.current < WHEEL_COOLDOWN) return
          lastWheelAtRef.current = now
          const dir = wheelDeltaRef.current > 0 ? 1 : -1
          wheelDeltaRef.current = 0
          moveYear(dir)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); moveYear(1) }
          if (e.key === 'ArrowUp')   { e.preventDefault(); moveYear(-1) }
          if (e.key === 'Enter')     { e.preventDefault(); enterYear() }
        }}
      >
        <motion.div
          style={{ y: listY }}
          className="absolute left-0 right-0 top-1/2 flex flex-col items-center"
        >
          {years.map((year, i) => {
            const selected = year === activeYear
            const dist     = Math.abs(i - activeIndex)
            const d        = depth(dist)

            return (
              <button
                key={year}
                onClick={() => selected ? enterYear(year) : chooseYear(year)}
                style={{ minHeight: ITEM_H }}
                className="group relative flex w-full items-center justify-center text-center"
              >
                <motion.span
                  animate={{
                    scale:   d.scale,
                    opacity: selected ? 1 : d.opacity,
                    filter:  `blur(${selected ? 0 : d.blur}px)`,
                  }}
                  transition={{ type: 'spring', stiffness: 180, damping: 22, mass: 0.8 }}
                  className="font-plus-jakarta text-[96px] font-light leading-none tabular-nums tracking-tight text-foreground"
                  style={selected ? { textShadow: GLOW } : undefined}
                >
                  {year}
                </motion.span>

                {selected && (
                  <span
                    className="pointer-events-none absolute opacity-0 text-foreground/35 transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-1"
                    style={{ left: 'calc(50% + 122px)', top: `${ITEM_H / 2 - 10}px` }}
                  >
                    <ArrowRight className="h-5 w-5" />
                  </span>
                )}
              </button>
            )
          })}
        </motion.div>
      </div>

      {/* ── stats: pulled up inside the visible zone ── */}
      <motion.div
        key={activeYear}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="-mt-12 flex flex-col items-center gap-2"
      >
        <p className="text-sm text-muted-foreground">
          {activeStat.count > 0
            ? `${activeStat.count} ${goalsWord(activeStat.count)} · ${activeStat.progress}%`
            : 'целей пока нет'}
        </p>
        {activeStat.count > 0 && (
          <div className="w-20 h-[2px] rounded-full bg-foreground/10 overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${activeStat.progress}%`, background: ACCENT_GRADIENT }}
            />
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
