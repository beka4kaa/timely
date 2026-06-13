"use client"

/**
 * PhotoAnalyzer — оценка еды по фото через backend vision provider.
 *   1. Выбор/съёмка фото (на мобиле — капчур задней камеры).
 *   2. Картинка сжимается и уходит на бэкенд → vision model → список продуктов.
 *   3. Пользователь выбирает распознанный продукт → PortionPicker
 *      (граммы предзаполнены оценкой ИИ) → добавить.
 */

import { useEffect, useRef, useState } from 'react'
import { Camera, Loader2, Sparkles, RefreshCw } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { PortionPicker } from './PortionPicker'
import {
  analyzePhoto, imageToDataURL,
  type FoodEntry, type PhotoFoodItem,
} from './lib'

interface PhotoAnalyzerProps {
  open: boolean
  onClose: () => void
  onAdd: (entry: Omit<FoodEntry, 'id' | 'addedAt'>) => void
}

type Phase =
  | { step: 'pick' }
  | { step: 'analyzing' }
  | { step: 'results'; items: PhotoFoodItem[] }
  | { step: 'portion'; food: PhotoFoodItem }
  | { step: 'error'; message: string }

export function PhotoAnalyzer({ open, onClose, onAdd }: PhotoAnalyzerProps) {
  const [phase, setPhase] = useState<Phase>({ step: 'pick' })
  const [preview, setPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) { setPhase({ step: 'pick' }); setPreview(null) }
  }, [open])

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // позволяем выбрать тот же файл повторно
    if (!file) return
    setPhase({ step: 'analyzing' })
    try {
      const dataUrl = await imageToDataURL(file)
      setPreview(dataUrl)
      const res = await analyzePhoto(dataUrl)
      if (!res.ok) { setPhase({ step: 'error', message: res.error }); return }
      if (res.items.length === 0) {
        setPhase({ step: 'error', message: 'Не удалось распознать еду. Попробуйте другое фото или добавьте вручную.' })
        return
      }
      setPhase({ step: 'results', items: res.items })
    } catch {
      setPhase({ step: 'error', message: 'Не удалось обработать изображение.' })
    }
  }

  const confirmAdd = (entry: Omit<FoodEntry, 'id' | 'addedAt'>) => {
    onAdd(entry)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-4 border-white/60 bg-white/85 backdrop-blur-2xl dark:border-white/10 dark:bg-[#13131a]/85 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-plus-jakarta text-lg">
            {phase.step === 'portion' ? 'Порция' : (<>Анализ по фото <Sparkles className="h-4 w-4 text-amber-400" /></>)}
          </DialogTitle>
        </DialogHeader>

        {/* Скрытый input для файла/камеры */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFile}
          className="hidden"
        />

        {phase.step === 'portion' ? (
          <PortionPicker food={phase.food} initialGrams={phase.food.grams} onConfirm={confirmAdd} />
        ) : phase.step === 'analyzing' ? (
          <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="h-32 w-32 rounded-2xl object-cover opacity-80" />
            )}
            <div className="flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" /> <span className="text-sm">ИИ анализирует фото…</span></div>
          </div>
        ) : phase.step === 'results' ? (
          <div className="flex flex-col gap-3">
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="h-28 w-full rounded-2xl object-cover" />
            )}
            <p className="px-1 text-xs text-muted-foreground">Распознано — выберите продукт:</p>
            <div className="flex flex-col gap-1.5">
              {phase.items.map((food) => (
                <button
                  key={food.id}
                  type="button"
                  onClick={() => setPhase({ step: 'portion', food })}
                  className="flex items-center gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                >
                  <span className="text-2xl">{food.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{food.name}</span>
                    <span className="block text-[11px] text-muted-foreground tabular-nums">
                      ~{food.grams} г
                      {food.completenessRatio ? ` · ${Math.round(food.completenessRatio * 100)}% от целого` : ''}
                      {food.defaultCatalogWeight ? ` (${food.defaultCatalogWeight} г)` : ''}
                      {' · '}
                      {food.kcal} ккал/100г
                    </span>
                    {food.identifiedClass && (
                      <span className="block truncate text-[10px] text-muted-foreground/80">
                        Класс: {food.identifiedClass}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center justify-center gap-1.5 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Другое фото
            </button>
          </div>
        ) : (
          // pick / error
          <div className="flex flex-col gap-3">
            {phase.step === 'error' && (
              <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                {phase.message}
              </p>
            )}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed border-foreground/15 px-6 py-10 text-center transition-colors hover:border-foreground/30 hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
            >
              <span
                className="flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-sm"
                style={{ background: 'linear-gradient(135deg, #fb7185 0%, #a855f7 100%)' }}
              >
                <Camera className="h-7 w-7" />
              </span>
              <span className="text-sm font-semibold">
                {phase.step === 'error' ? 'Выбрать другое фото' : 'Сделать или выбрать фото'}
              </span>
              <span className="max-w-[240px] text-xs text-muted-foreground">
                ИИ оценит блюдо и его БЖУ. Порцию можно поправить.
              </span>
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
