"use client"

import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus, Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ACCENT_GRADIENT } from '@/components/habits/lib'
import { useGoalsStore } from '@/stores/goals-store'

function lastDayOfMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m, 0).getDate()
  return `${ym}-${String(d).padStart(2, '0')}`
}

type DeadlinePreset = 'start' | 'mid' | 'end' | 'custom'

const PRESETS: { key: DeadlinePreset; label: string }[] = [
  { key: 'start',  label: 'Начало'   },
  { key: 'mid',    label: 'Середина' },
  { key: 'end',    label: 'Конец'    },
  { key: 'custom', label: 'Дата'     },
]

interface Props {
  open: boolean
  onClose: () => void
}

export function CreateGoalPopover({ open, onClose }: Props) {
  const selectedDate = useGoalsStore(s => s.selectedDate)
  const createGoal = useGoalsStore(s => s.createGoal)
  const selectGoal = useGoalsStore(s => s.selectGoal)

  const yearStr = selectedDate.slice(0, 4)
  const month = selectedDate.slice(0, 7)

  const [title, setTitle] = useState('')
  const [goalType, setGoalType] = useState<'goal' | 'task'>('goal')
  const [preset, setPreset] = useState<DeadlinePreset>('end')
  const [customDate, setCustomDate] = useState(selectedDate)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setTitle('')
      setGoalType('goal')
      setPreset('end')
      setCustomDate(selectedDate)
      setTimeout(() => titleRef.current?.focus(), 60)
    }
  }, [open, selectedDate])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  function resolveDate(): string {
    switch (preset) {
      case 'start':  return `${month}-01`
      case 'mid':    return `${month}-15`
      case 'end':    return lastDayOfMonth(month)
      case 'custom': return customDate
    }
  }

  const submit = () => {
    const t = title.trim()
    if (!t) return
    const dueDate = resolveDate()
    const id = createGoal({
      title: t,
      type: goalType,
      status: 'not_started',
      planningScale: 'month',
      month,
      year: Number(yearStr),
      startDate: `${month}-01`,
      dueDate,
    })
    selectGoal(id)
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.97 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="fixed top-[72px] right-6 z-50 w-[300px] max-sm:left-3 max-sm:right-3 max-sm:w-auto rounded-[20px] bg-[#0d0d12]/96 border border-white/[0.11] backdrop-blur-2xl shadow-[0_8px_40px_rgba(0,0,0,0.55)] overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-white/[0.07]">
            <p className="text-[13px] font-semibold text-foreground">Новая цель</p>
            <button
              onClick={onClose}
              className="w-6 h-6 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.07] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="px-4 py-4 flex flex-col gap-3">
            {/* Title */}
            <input
              ref={titleRef}
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit() }}
              placeholder="Название цели…"
              className="w-full rounded-xl bg-white/[0.05] border border-white/[0.08] px-3 py-2.5 text-sm text-foreground outline-none focus:border-white/20 placeholder:text-muted-foreground/50"
            />

            {/* Type */}
            <div className="grid grid-cols-2 gap-1">
              {(['goal', 'task'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setGoalType(t)}
                  className={cn(
                    'py-1.5 rounded-xl text-[11px] font-medium border transition-colors',
                    goalType === t
                      ? 'border-foreground/20 bg-foreground/[0.08] text-foreground'
                      : 'border-foreground/[0.07] text-muted-foreground hover:bg-foreground/[0.04]',
                  )}
                >
                  {t === 'goal' ? 'Цель' : 'Задача'}
                </button>
              ))}
            </div>

            {/* Deadline presets */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Calendar className="w-3 h-3 text-muted-foreground/50" />
                <span className="text-[11px] text-muted-foreground/60">Дедлайн</span>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {PRESETS.map(p => (
                  <button
                    key={p.key}
                    onClick={() => setPreset(p.key)}
                    className={cn(
                      'py-1.5 rounded-xl text-[11px] font-medium border transition-colors',
                      preset === p.key
                        ? 'border-foreground/20 bg-foreground/[0.08] text-foreground'
                        : 'border-foreground/[0.07] text-muted-foreground hover:bg-foreground/[0.04]',
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom date input */}
            {preset === 'custom' && (
              <input
                type="date"
                value={customDate}
                onChange={e => setCustomDate(e.target.value)}
                className="rounded-xl bg-white/[0.04] border border-white/[0.07] px-3 py-2 text-[12px] text-foreground/80 outline-none focus:border-white/15 [color-scheme:dark]"
              />
            )}

            {/* Context hint */}
            <p className="text-[11px] text-muted-foreground/50 -mt-1">
              {month} · до{' '}
              {preset === 'start' ? '1-го'
                : preset === 'mid' ? '15-го'
                : preset === 'end' ? 'конца месяца'
                : customDate}
            </p>

            {/* Submit */}
            <button
              onClick={submit}
              disabled={!title.trim()}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-medium text-white disabled:opacity-40 hover:brightness-110 transition-all active:scale-[0.98]"
              style={{ background: ACCENT_GRADIENT }}
            >
              <Plus className="w-4 h-4" />
              Создать
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
