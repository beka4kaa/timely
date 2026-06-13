"use client"

/**
 * NutritionTracker — корневой SPA «Калории и БЖУ» (Mobile First).
 *
 * Архитектура вкладок (переключение через state, без перезагрузки):
 *   • analytics — дашборд прогресса + список съеденного за сегодня;
 *   • diary     — поиск продуктов в Open Food Facts + ручной ввод.
 * Навигация — нижний стеклянный BottomNav с центральным FAB, который
 * открывает bottom-sheet (штрихкод / фото-ИИ). День хранится локально
 * (localStorage), поиск/штрихкод/фото — через Django-бэкенд.
 */

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { AnalyticsTab } from './AnalyticsTab'
import { DiaryTab } from './DiaryTab'
import { BottomNav, type NutritionTab } from './BottomNav'
import { AddSheet } from './AddSheet'
import { BarcodeScanner } from './BarcodeScanner'
import { PhotoAnalyzer } from './PhotoAnalyzer'
import {
  DEFAULT_GOALS, loadEntries, saveEntries, sumTotals, type FoodEntry,
} from './lib'

export function NutritionTracker() {
  const [entries, setEntries] = useState<FoodEntry[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [tab, setTab] = useState<NutritionTab>('analytics')

  // Модалки/листы добавления.
  const [sheetOpen, setSheetOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [photoOpen, setPhotoOpen] = useState(false)

  useEffect(() => {
    setEntries(loadEntries())
    setHydrated(true)
  }, [])
  useEffect(() => {
    if (hydrated) saveEntries(entries)
  }, [entries, hydrated])

  const totals = useMemo(() => sumTotals(entries), [entries])

  const addEntry = (data: Omit<FoodEntry, 'id' | 'addedAt'>) => {
    const entry: FoodEntry = {
      ...data,
      id: (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      addedAt: new Date().toISOString(),
    }
    setEntries((prev) => [entry, ...prev])
    toast.success(`«${entry.name}» добавлен`, { description: `+${Math.round(entry.kcal)} ккал` })
  }

  const removeEntry = (id: string) => setEntries((prev) => prev.filter((e) => e.id !== id))

  return (
    <div className="flex min-h-full flex-col">
      {/* Заголовок */}
      <header className="mb-4">
        <h1 className="font-plus-jakarta text-2xl font-extrabold tracking-tight">Калории и БЖУ</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {tab === 'analytics' ? 'Твой день в цифрах' : 'Найди и добавь продукт'}
        </p>
      </header>

      {/* Контент вкладки (отступ снизу под навбар) */}
      <div className="flex-1 pb-28">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            {tab === 'analytics' ? (
              <AnalyticsTab
                totals={totals}
                goals={DEFAULT_GOALS}
                entries={entries}
                onRemove={removeEntry}
              />
            ) : (
              <DiaryTab onAdd={addEntry} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Нижняя навигация + FAB */}
      <BottomNav tab={tab} onTab={setTab} onFab={() => setSheetOpen(true)} />

      {/* FAB bottom-sheet → штрихкод / фото */}
      <AddSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onBarcode={() => setScanOpen(true)}
        onPhoto={() => setPhotoOpen(true)}
      />

      {/* Рабочие модалки добавления */}
      <BarcodeScanner open={scanOpen} onClose={() => setScanOpen(false)} onAdd={addEntry} />
      <PhotoAnalyzer open={photoOpen} onClose={() => setPhotoOpen(false)} onAdd={addEntry} />
    </div>
  )
}
