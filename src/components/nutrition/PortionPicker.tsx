"use client"

/**
 * PortionPicker — общий блок «выбрать порцию»: показывает продукт (БЖУ на
 * 100 г), даёт ввести граммы (с быстрыми пресетами) и live-превью итоговых
 * БЖУ на выбранную порцию, затем «Добавить». Используется и в библиотеке,
 * и в сканере штрихкода.
 */

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  MACROS, scalePortion, softHaptic,
  type FoodEntry, type FoodLibraryItem,
} from './lib'

interface PortionPickerProps {
  food: FoodLibraryItem
  onConfirm: (entry: Omit<FoodEntry, 'id' | 'addedAt'>) => void
  onBack?: () => void
  /** Стартовая порция, г (напр. оценка ИИ с фото). По умолчанию 100. */
  initialGrams?: number
}

const GRAM_PRESETS = [50, 100, 150, 200, 300]

export function PortionPicker({ food, onConfirm, onBack, initialGrams }: PortionPickerProps) {
  const [grams, setGrams] = useState(String(initialGrams && initialGrams > 0 ? Math.round(initialGrams) : 100))
  const g = Math.max(0, parseFloat(grams.replace(',', '.')) || 0)

  const scaled = useMemo(() => scalePortion(food, g), [food, g])

  return (
    <div className="flex flex-col gap-4">
      {/* Шапка продукта */}
      <div className="flex items-center gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Назад к поиску"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/10"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        )}
        <span className="text-3xl">{food.emoji}</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{food.name}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {food.kcal} ккал · {food.protein}/{food.fat}/{food.carbs} Б/Ж/У на 100 г
          </p>
        </div>
      </div>

      {/* Граммы */}
      <div>
        <label className="mb-1.5 block px-1 text-[11px] font-medium text-muted-foreground">
          Порция, г
        </label>
        <input
          value={grams}
          onChange={(e) => setGrams(e.target.value.replace(/[^\d.,]/g, ''))}
          inputMode="decimal"
          aria-label="Порция в граммах"
          autoFocus
          className={cn(
            'h-11 w-full rounded-xl px-3.5 text-sm tabular-nums outline-none',
            'bg-white/50 dark:bg-white/[0.04] border border-black/5 dark:border-white/10',
            'focus:bg-white/70 dark:focus:bg-white/[0.07]',
          )}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {GRAM_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setGrams(String(p))}
              className={cn(
                'rounded-lg px-2.5 py-1 text-xs font-medium tabular-nums transition-colors',
                g === p
                  ? 'bg-foreground text-background'
                  : 'bg-black/5 text-muted-foreground hover:bg-black/10 dark:bg-white/10 dark:hover:bg-white/15',
              )}
            >
              {p} г
            </button>
          ))}
        </div>
      </div>

      {/* Превью итоговых БЖУ */}
      <div className="grid grid-cols-4 gap-2">
        {MACROS.map((m) => (
          <div
            key={m.key}
            className="flex flex-col items-center rounded-xl py-2.5"
            style={{ background: `${m.color}14` }}
          >
            <span className="text-sm font-bold tabular-nums" style={{ color: m.color }}>
              {scaled[m.key]}
            </span>
            <span className="mt-0.5 text-[10px] text-muted-foreground">{m.label}</span>
          </div>
        ))}
      </div>

      {/* Добавить */}
      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        disabled={g <= 0}
        onClick={() => { softHaptic(); onConfirm(scaled) }}
        className={cn(
          'flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-white transition-all',
          g > 0 ? 'hover:brightness-105' : 'cursor-not-allowed opacity-40',
        )}
        style={{ background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)' }}
      >
        <Plus className="h-4 w-4" strokeWidth={2.5} />
        Добавить {g > 0 ? `· ${scaled.kcal} ккал` : ''}
      </motion.button>
    </div>
  )
}
