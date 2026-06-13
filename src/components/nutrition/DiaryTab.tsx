"use client"

/**
 * DiaryTab — вкладка «Дневник»: быстрый поиск продуктов.
 *   • Ввод → DEBOUNCE 250мс → локальная база сразу, Open Food Facts фоном.
 *   • Состояния: спиннер загрузки, сообщение об ошибке, пусто.
 *   • Результаты — карточки; тап → PortionPicker (граммы → БЖУ → добавить).
 *   • Пустой запрос → «Популярное» из локальной библиотеки (быстрый доступ).
 *   • Внизу — компактная форма ручного ввода (fallback).
 */

import { useEffect, useRef, useState } from 'react'
import { Search, Loader2, AlertCircle, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PortionPicker } from './PortionPicker'
import { AddFoodForm } from './AddFoodForm'
import {
  GLASS, searchOpenFoodFacts, searchFoods,
  type FoodEntry, type FoodLibraryItem,
} from './lib'

interface DiaryTabProps {
  onAdd: (entry: Omit<FoodEntry, 'id' | 'addedAt'>) => void
}

function FoodResultCard({ food, onPick }: { food: FoodLibraryItem; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        GLASS,
        'flex items-center gap-3 rounded-2xl p-3 text-left transition-colors',
        'hover:bg-white/80 dark:hover:bg-white/[0.09]',
      )}
    >
      {food.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={food.image} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] text-xl dark:bg-white/[0.06]">
          {food.emoji}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{food.name}</span>
        <span className="block truncate text-[11px] text-muted-foreground tabular-nums">
          {food.category ? `${food.category} · ` : ''}{food.kcal} ккал · Б{food.protein} Ж{food.fat} У{food.carbs} / 100г
        </span>
      </span>
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white"
        style={{ background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)' }}
      >
        <Plus className="h-4 w-4" strokeWidth={2.5} />
      </span>
    </button>
  )
}

function mergeFoodResults(primary: FoodLibraryItem[], secondary: FoodLibraryItem[]) {
  const seen = new Set<string>()
  const merged: FoodLibraryItem[] = []
  for (const food of [...primary, ...secondary]) {
    const key = `${food.barcode || ''}:${food.name.trim().toLocaleLowerCase('ru-RU')}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(food)
  }
  return merged
}

export function DiaryTab({ onAdd }: DiaryTabProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FoodLibraryItem[]>([])
  const [popular, setPopular] = useState<FoodLibraryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<FoodLibraryItem | null>(null)

  const abortRef = useRef<AbortController | null>(null)

  // «Популярное» — локальная библиотека, грузим один раз (для пустого запроса).
  useEffect(() => {
    searchFoods('').then(setPopular)
  }, [])

  // DEBOUNCE 250мс: локальная база показывается сразу, внешний поиск дополняет.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([]); setError(null); setLoading(false)
      abortRef.current?.abort()
      return
    }
    setLoading(true)
    setError(null)
    const t = setTimeout(async () => {
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      const localItems = await searchFoods(q, ac.signal)
      if (ac.signal.aborted) return
      setResults(localItems)

      const res = await searchOpenFoodFacts(q, ac.signal)
      if (ac.signal.aborted) return
      if (res.ok) setResults(mergeFoodResults(localItems, res.items))
      else if (localItems.length === 0) setError(res.error)
      setLoading(false)
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  const confirmAdd = (entry: Omit<FoodEntry, 'id' | 'addedAt'>) => {
    onAdd(entry)
    setSelected(null)
  }

  // Режим выбора порции — занимает место списка.
  if (selected) {
    return (
      <div className={cn(GLASS, 'rounded-[24px] p-5')}>
        <PortionPicker food={selected} onConfirm={confirmAdd} onBack={() => setSelected(null)} />
      </div>
    )
  }

  const showPopular = query.trim().length < 2

  return (
    <div className="flex flex-col gap-4">
      {/* Поиск */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск продукта…"
          aria-label="Поиск продукта"
          className={cn(
            GLASS,
            'h-12 w-full rounded-2xl pl-10 pr-10 text-sm outline-none',
            'placeholder:text-muted-foreground/60 focus:ring-2 focus:ring-indigo-500/30',
          )}
        />
        {loading && (
          <Loader2 className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Состояния */}
      {error ? (
        <div className="flex items-center gap-2 rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-500">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : showPopular ? (
        <div className="flex flex-col gap-2">
          <p className="px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Популярное
          </p>
          {popular.slice(0, 8).map((food) => (
            <FoodResultCard key={String(food.id)} food={food} onPick={() => setSelected(food)} />
          ))}
        </div>
      ) : loading && results.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm">Ищем продукты…</span>
        </div>
      ) : results.length === 0 ? (
        <div className="flex flex-col items-center gap-1 py-8 text-center">
          <span className="text-2xl">🔍</span>
          <p className="text-sm font-medium">Ничего не найдено</p>
          <p className="text-xs text-muted-foreground">Уточните запрос или добавьте вручную ниже</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {results.map((food) => (
            <FoodResultCard key={String(food.id)} food={food} onPick={() => setSelected(food)} />
          ))}
        </div>
      )}

      {/* Fallback — ручной ввод */}
      <AddFoodForm onAdd={onAdd} />
    </div>
  )
}
