"use client"

/**
 * AddFoodForm — минималистичная стеклянная форма ручного ввода продукта:
 * Название + Ккал/Б/Ж/У + «Добавить». Валидация мягкая: нужны название и
 * хотя бы калории; БЖУ опциональны (по умолчанию 0).
 */

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Utensils } from 'lucide-react'
import { cn } from '@/lib/utils'
import { GLASS, MACROS, parseNum, softHaptic, type FoodEntry } from './lib'

interface AddFoodFormProps {
  onAdd: (entry: Omit<FoodEntry, 'id' | 'addedAt'>) => void
}

/** Числовые поля формы в порядке отображения (kcal + 3 макро). */
const NUM_FIELDS = MACROS.map((m) => ({ key: m.key, label: m.label, unit: m.unit, color: m.color }))

export function AddFoodForm({ onAdd }: AddFoodFormProps) {
  const [name, setName] = useState('')
  const [values, setValues] = useState<Record<string, string>>({
    kcal: '', protein: '', fat: '', carbs: '',
  })

  const canSubmit = name.trim().length > 0 && parseNum(values.kcal) > 0

  const setField = (key: string, v: string) =>
    setValues((prev) => ({ ...prev, [key]: v }))

  const submit = () => {
    if (!canSubmit) return
    softHaptic()
    onAdd({
      name: name.trim(),
      kcal: parseNum(values.kcal),
      protein: parseNum(values.protein),
      fat: parseNum(values.fat),
      carbs: parseNum(values.carbs),
    })
    setName('')
    setValues({ kcal: '', protein: '', fat: '', carbs: '' })
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.05, ease: 'easeOut' }}
      className={cn(GLASS, 'rounded-[24px] p-5')}
    >
      <div className="mb-4 flex items-center gap-2">
        <Utensils className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Добавить вручную</h2>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); submit() }}
        className="flex flex-col gap-3"
      >
        {/* Название */}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Например: Греческий йогурт"
          aria-label="Название продукта"
          className={cn(
            'h-11 w-full rounded-xl px-3.5 text-sm outline-none',
            'bg-white/50 dark:bg-white/[0.04] border border-black/5 dark:border-white/10',
            'placeholder:text-muted-foreground/60 transition-colors',
            'focus:border-foreground/20 focus:bg-white/70 dark:focus:bg-white/[0.07]',
          )}
        />

        {/* 4 числовых поля: 2 кол. на мобиле, 4 на десктопе */}
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {NUM_FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col gap-1">
              <span className="px-1 text-[11px] font-medium text-muted-foreground">
                {f.label}, {f.unit}
              </span>
              <input
                value={values[f.key]}
                onChange={(e) => setField(f.key, e.target.value.replace(/[^\d.,]/g, ''))}
                inputMode="decimal"
                placeholder="0"
                aria-label={`${f.label} (${f.unit})`}
                className={cn(
                  'h-11 w-full rounded-xl px-3 text-sm tabular-nums outline-none',
                  'bg-white/50 dark:bg-white/[0.04] border border-black/5 dark:border-white/10',
                  'placeholder:text-muted-foreground/50 transition-colors',
                  'focus:bg-white/70 dark:focus:bg-white/[0.07]',
                )}
                style={{ borderTopColor: values[f.key] ? f.color : undefined }}
              />
            </label>
          ))}
        </div>

        {/* Добавить */}
        <motion.button
          type="submit"
          disabled={!canSubmit}
          whileTap={canSubmit ? { scale: 0.98 } : undefined}
          className={cn(
            'mt-1 flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white',
            'transition-all duration-200',
            canSubmit
              ? 'shadow-[0_8px_24px_-6px_rgba(99,102,241,0.6)] hover:brightness-105'
              : 'cursor-not-allowed opacity-40',
          )}
          style={{ background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)' }}
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Добавить
        </motion.button>
      </form>
    </motion.section>
  )
}
