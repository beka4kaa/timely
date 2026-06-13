"use client"

/**
 * NutritionDashboard — стеклянный заголовок-дашборд: 4 круговые диаграммы
 * (Калории/Белки/Жиры/Углеводы) с целью и текущим прогрессом, плюс крупная
 * сводка «осталось калорий» на день.
 */

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { MacroRing } from './MacroRing'
import { GLASS, MACROS, type Goals, type Totals } from './lib'

interface NutritionDashboardProps {
  totals: Totals
  goals: Goals
}

export function NutritionDashboard({ totals, goals }: NutritionDashboardProps) {
  const left = Math.max(0, goals.kcal - totals.kcal)
  const over = totals.kcal > goals.kcal

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className={cn(GLASS, 'rounded-[28px] p-5 sm:p-6')}
    >
      {/* Сводка дня */}
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {over ? 'Превышение' : 'Осталось на сегодня'}
          </p>
          <p className="mt-1 flex items-baseline gap-1.5">
            <span
              className={cn('text-3xl font-extrabold tabular-nums sm:text-4xl')}
              style={over ? { color: MACROS[0].color } : undefined}
            >
              {over ? totals.kcal - goals.kcal : left}
            </span>
            <span className="text-sm font-medium text-muted-foreground">ккал</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Цель</p>
          <p className="text-lg font-semibold tabular-nums">{goals.kcal}</p>
        </div>
      </div>

      {/* 4 кольца: 2 колонки на мобиле, 4 на десктопе */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {MACROS.map((meta) => (
          <div key={meta.key} className="flex justify-center">
            <MacroRing meta={meta} current={totals[meta.key]} goal={goals[meta.key]} />
          </div>
        ))}
      </div>
    </motion.section>
  )
}
