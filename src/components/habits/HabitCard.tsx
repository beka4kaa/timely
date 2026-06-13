"use client"

import React, { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Flame, Shield, MoreHorizontal, Timer } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Habit, cardGradient, daysWord, softHaptic, GLASS } from './lib'

function Sparkline({ calendar, light }: { calendar: Habit['calendar']; light: boolean }) {
  const last = calendar.slice(-14)
  return (
    <div className="flex items-end gap-[3px] h-5">
      {last.map((d) => (
        <div
          key={d.date}
          className={cn(
            'w-1.5 rounded-full transition-colors duration-150',
            d.done
              ? (light ? 'bg-white/90' : 'bg-foreground/70')
              : (light ? 'bg-white/35' : 'bg-foreground/25')
          )}
          style={{ height: d.done ? '100%' : '38%' }}
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
  // Один toggle на ЖЕСТ: без этого pointerup иногда срабатывал дважды (наш
  // обработчик + tap-жест framer-motion / compat-события), карточка вспыхивала
  // «done» и тут же откатывалась обратно — это и был баг «сработало на секунду».
  const handled = useRef(false)
  // Старт касания + флаг «палец поехал»: если пользователь скроллит ВЕРТИКАЛЬНО
  // поверх карточки, это не тап — гасим long-press и не переключаем привычку
  // (вместе с touch-action: pan-y это и чинит «экран не скроллится» на телефоне).
  const startPos = useRef<{ x: number; y: number } | null>(null)
  const moved = useRef(false)
  const featured = habit.streak >= 14

  const clearPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    longPressed.current = false
    handled.current = false
    moved.current = false
    startPos.current = { x: e.clientX, y: e.clientY }
    pressTimer.current = setTimeout(() => {
      if (moved.current) return
      longPressed.current = true
      softHaptic()
      onOpen(habit)
    }, 420)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!startPos.current) return
    const dx = Math.abs(e.clientX - startPos.current.x)
    const dy = Math.abs(e.clientY - startPos.current.y)
    if (dx > 10 || dy > 10) {
      moved.current = true   // это скролл/перетаскивание, а не тап
      clearPress()
    }
  }

  const handlePointerUp = () => {
    clearPress()
    if (handled.current) return   // защита от повторного срабатывания на жест
    handled.current = true
    if (longPressed.current) return   // долгое нажатие уже открыло детали
    if (moved.current) return         // это был скролл, не тап
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
      whileHover={{ y: -4, scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={clearPress}
      onPointerCancel={() => { clearPress(); moved.current = true }}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        // touch-pan-y (а не touch-none): вертикальный скролл проходит сквозь
        // карточку на телефоне; тап/long-press по-прежнему ловим через pointer.
        'relative overflow-hidden rounded-[28px] p-5 cursor-pointer select-none touch-pan-y min-h-[150px]',
        'flex flex-col justify-between',
        featured && 'sm:col-span-2',
        done ? 'text-white' : cn(GLASS, 'text-card-foreground')
      )}
      style={{
        // Concrete boxShadow in BOTH states: framer-motion leaves the last value
        // when style becomes undefined, which made the colored glow stick on the
        // inactive card. A concrete neutral value forces it to reset cleanly.
        background: done ? cardGradient(habit.color) : undefined,
        boxShadow: done
          ? `0 16px 36px -14px ${habit.color}99`
          : '0 4px 16px rgba(15,23,42,0.05)',
      }}
    >
      {/* glossy highlight on completed cards */}
      {done && <span className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent pointer-events-none" />}
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
        onPointerUp={(e) => e.stopPropagation()}
        onPointerCancel={(e) => e.stopPropagation()}
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
            done ? 'bg-white/25 backdrop-blur-sm' : 'bg-white/60 dark:bg-white/10 ring-1 ring-black/5 dark:ring-white/10'
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
