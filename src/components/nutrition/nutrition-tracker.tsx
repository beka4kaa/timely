"use client"

/**
 * NutritionTracker — корневой SPA «Калории и БЖУ» (Mobile First).
 *
 * Архитектура вкладок (переключение через state, без перезагрузки):
 *   • analytics — дашборд прогресса + список съеденного за сегодня;
 *   • diary     — поиск продуктов в Open Food Facts + ручной ввод.
 * Навигация — нижний стеклянный BottomNav с центральным FAB, который
 * открывает bottom-sheet (штрихкод / фото-ИИ). Дневник питания, поиск,
 * штрихкод и фото-анализ работают через Django-бэкенд.
 */

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { AnalyticsTab } from './AnalyticsTab'
import { DiaryTab } from './DiaryTab'
import { BottomNav, type NutritionTab } from './BottomNav'
import { AddSheet } from './AddSheet'
import { BarcodeScanner } from './BarcodeScanner'
import { PhotoAnalyzer } from './PhotoAnalyzer'
import { NutritionProfileSurvey } from './NutritionProfileSurvey'
import {
  DEFAULT_GOALS,
  addEntryToBackend,
  deleteEntryFromBackend,
  goalsFromProfile,
  loadEntries,
  loadEntriesFromBackend,
  loadNutritionProfile,
  saveEntries,
  saveNutritionProfile,
  sumTotals,
  type FoodEntry,
  type NutritionProfile,
  type NutritionProfileInput,
} from './lib'

export function NutritionTracker() {
  const [entries, setEntries] = useState<FoodEntry[]>([])
  const [goals, setGoals] = useState(DEFAULT_GOALS)
  const [profile, setProfile] = useState<NutritionProfile | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [tab, setTab] = useState<NutritionTab>('analytics')
  const [profileOpen, setProfileOpen] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)

  // Модалки/листы добавления.
  const [sheetOpen, setSheetOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)
  const [photoOpen, setPhotoOpen] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function hydrateEntries() {
      const localFallback = loadEntries()
      try {
        const remoteEntries = await loadEntriesFromBackend()
        if (cancelled) return
        setEntries(remoteEntries)
      } catch {
        if (cancelled) return
        setEntries(localFallback)
        if (localFallback.length > 0) {
          toast.warning('Дневник открыт из локальной копии', {
            description: 'Backend временно недоступен, новые записи попробуем сохранить на сервер.',
          })
        }
      } finally {
        if (!cancelled) setHydrated(true)
      }
    }

    hydrateEntries()
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (hydrated) saveEntries(entries)
  }, [entries, hydrated])

  useEffect(() => {
    let cancelled = false

    async function hydrateProfile() {
      try {
        const savedProfile = await loadNutritionProfile()
        if (cancelled) return
        setProfile(savedProfile)
        if (savedProfile) {
          setGoals(goalsFromProfile(savedProfile))
        } else {
          setProfileOpen(true)
        }
      } catch {
        if (cancelled) return
        toast.warning('Нормы питания открыты по умолчанию', {
          description: 'Профиль не загрузился, можно попробовать настроить цели позже.',
        })
      }
    }

    hydrateProfile()
    return () => { cancelled = true }
  }, [])

  const totals = useMemo(() => sumTotals(entries), [entries])

  const saveProfile = async (data: NutritionProfileInput) => {
    setProfileSaving(true)
    try {
      const savedProfile = await saveNutritionProfile(data)
      setProfile(savedProfile)
      setGoals(goalsFromProfile(savedProfile))
      setProfileOpen(false)
      toast.success('Нормы питания обновлены', {
        description: `${savedProfile.kcalGoal} ккал • Б ${savedProfile.proteinGoal} г • Ж ${savedProfile.fatGoal} г • У ${savedProfile.carbsGoal} г`,
      })
    } catch {
      toast.error('Не удалось сохранить профиль питания')
    } finally {
      setProfileSaving(false)
    }
  }

  const addEntry = async (data: Omit<FoodEntry, 'id' | 'addedAt'>) => {
    const localId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const optimistic: FoodEntry = {
      ...data,
      id: `local-${localId}`,
      addedAt: new Date().toISOString(),
    }
    setEntries((prev) => [optimistic, ...prev])
    toast.success(`«${optimistic.name}» добавлен`, { description: `+${Math.round(optimistic.kcal)} ккал` })

    try {
      const saved = await addEntryToBackend(data)
      setEntries((prev) => prev.map((entry) => (entry.id === optimistic.id ? saved : entry)))
    } catch {
      toast.error('Не удалось сохранить на сервер', {
        description: 'Запись временно осталась в локальной копии.',
      })
    }
  }

  const removeEntry = async (id: string) => {
    let removed: FoodEntry | undefined
    setEntries((prev) => {
      removed = prev.find((entry) => entry.id === id)
      return prev.filter((entry) => entry.id !== id)
    })
    try {
      await deleteEntryFromBackend(id)
    } catch {
      if (removed) {
        const restored = removed
        setEntries((prev) => [restored, ...prev])
      }
      toast.error('Не удалось удалить запись на сервере')
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      {/* Заголовок */}
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-plus-jakarta text-2xl font-extrabold tracking-tight">Калории и БЖУ</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {tab === 'analytics' ? 'Твой день в цифрах' : 'Найди и добавь продукт'}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 rounded-full bg-background/55 backdrop-blur-xl"
          onClick={() => setProfileOpen(true)}
        >
          <SlidersHorizontal className="h-4 w-4" />
          Нормы
        </Button>
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
                goals={goals}
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
      <NutritionProfileSurvey
        open={profileOpen}
        initialProfile={profile}
        saving={profileSaving}
        onOpenChange={setProfileOpen}
        onSubmit={saveProfile}
      />
    </div>
  )
}
