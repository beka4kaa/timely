"use client"

/**
 * AnalyticsTab — вкладка «Аналитика»: верхний дашборд прогресса (кольца
 * Калории/Б/Ж/У) и список съеденного за сегодня под ним.
 */

import { NutritionDashboard } from './NutritionDashboard'
import { FoodHistory } from './FoodHistory'
import type { FoodEntry, Goals, Totals } from './lib'

interface AnalyticsTabProps {
  totals: Totals
  goals: Goals
  entries: FoodEntry[]
  onRemove: (id: string) => void
}

export function AnalyticsTab({ totals, goals, entries, onRemove }: AnalyticsTabProps) {
  return (
    <div className="flex flex-col gap-5">
      <NutritionDashboard totals={totals} goals={goals} />
      <FoodHistory entries={entries} onRemove={onRemove} />
    </div>
  )
}
