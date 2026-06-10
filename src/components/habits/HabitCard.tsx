"use client"

import React, { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Flame, Shield, MoreHorizontal, Timer } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Habit, cardGradient, daysWord, softHaptic } from './lib'

function Sparkline({ calendar, light }: { calendar: Habit['calendar']; light: boolean }) {
  const last = calendar.slice(-14)
  return (
    <div className="flex items-end gap-[3px] h-5">
      {last.map((d) => (
        <div
          key={d.date}
          className={cn(
            'w-1.5 rounded-full transition-all',
            d.done ? (light ? 'bg-white/90' : 'bg-current') : (light ? 'bg-white/25' : 'bg-current/15')
          )}
          style={{ height: d.done ? '100%' : '35%' }}
          title={d.date}
        />
      ))}
    </div>
  )
}

export function HabitCard({
  habit,
  onToggle,
  onOpen,
}: {
  habit: Habit
  onToggle: (id: number) => void
  onOpen: (habit: Habit) => void
}) {
  const done = habit.doneToday
  const [burst, setBurst] = useState(false)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)
  const featured = habit.streak >= 14

  const clearPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }

  const handlePointerDown = () => {
    longPressed.current = false
    pressTimer.current = setTimeout(() => {
      longPressed.current = true
      softHaptic()
      onOpen(habit)
    }, 420)
  }

  const handlePointerUp = () => {
    clearPress()
    if (longPressed.current) return
    if (!done) {
      setBurst(true)
      setTimeout(() => setBurst(false), 650)
    }
    softHaptic()
    onToggle(habit.id)
  }

  return (
    <motion.div
      layout
      whileTap={{ scale: 0.97 }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={clearPress}
      onPointerCancel={clearPress}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        'relative overflow-hidden rounded-3xl p-5 cursor-pointer select-none touch-none min-h-[150px]',
        'flex flex-col justify-between transition-shadow',
        featured && 'sm:col-span-2',
        done ? 'text-white shadow-lg' : 'border bg-card text-card-foreground hover:shadow-md'
      )}
      style={done ? { background: cardGradient(habit.color), boxShadow: `0 12px 30px -10px ${habit.color}80` } : undefined}
    >
      {/* completion burst */}
      <AnimatePresence>
        {burst && (
          <motion.span
            initial={{ scale: 0, opacity: 0.5 }}
            animate={{ scale: 6, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.65, ease: 'easeOut' }}
            className="absolute z-0 rounded-full"
            style={{ left: 28, top: 28, width: 40, height: 40, background: habit.color }}
          />
        )}
      </AnimatePresence>

      {/* options button */}
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onOpen(habit) }}
        className={cn(
          'absolute top-3.5 right-3.5 z-20 p-1.5 rounded-lg transition-colors',
          done ? 'text-white/70 hover:text-white hover:bg-white/15' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        )}
        aria-label="Детали"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {/* top: emoji + check */}
      <div className="relative z-10 flex items-start justify-between">
        <div
          className={cn(
            'w-12 h-12 rounded-2xl flex items-center justify-center text-2xl transition-colors',
            done ? 'bg-white/20' : 'bg-muted'
          )}
        >
          {done ? <Check className="w-6 h-6" strokeWidth={3} /> : habit.emoji}
        </div>
      </div>

      {/* body */}
      <div className="relative z-10 mt-3">
        <h3 className="font-semibold text-base leading-tight">{habit.name}</h3>
        {habit.goalText && (
          <p className={cn('text-xs mt-0.5 truncate', done ? 'text-white/80' : 'text-muted-foreground')}>
            🎯 {habit.goalText}
          </p>
        )}
      </div>

      {/* footer */}
      <div className="relative z-10 mt-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 text-sm">
          <span className={cn('flex items-center gap-1 font-semibold', !done && habit.streak > 0 && 'text-orange-500')}>
            <Flame className="w-4 h-4" />
            {habit.streak}
            <span className={cn('font-normal text-xs', done ? 'text-white/70' : 'text-muted-foreground')}>
              {daysWord(habit.streak)}
            </span>
          </span>

          {habit.shieldsLeft > 0 && (
            <span
              className={cn('flex items-center gap-0.5 text-xs', done ? 'text-white/80' : 'text-sky-500')}
              title={`Щиты: ${habit.shieldsLeft} — пропуск дня не сбросит серию`}
            >
              <Shield className="w-3.5 h-3.5" />{habit.shieldsLeft}
            </span>
          )}

          {habit.minutesToday > 0 && (
            <span className={cn('flex items-center gap-0.5 text-xs', done ? 'text-white/80' : 'text-muted-foreground')}>
              <Timer className="w-3.5 h-3.5" />{habit.minutesToday}м
            </span>
          )}
        </div>

        <Sparkline calendar={habit.calendar} light={done} />
      </div>
    </motion.div>
  )
}
