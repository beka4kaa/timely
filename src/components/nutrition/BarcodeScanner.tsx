"use client"

/**
 * BarcodeScanner — модалка поиска продукта по штрихкоду.
 *   • Камера: нативный BarcodeDetector (Chromium/Android, без библиотек) —
 *     поток с задней камеры опрашивается каждые 400мс на наличие кода.
 *   • Fallback: ручной ввод цифр штрихкода (работает везде, в т.ч. Safari).
 * Найденный код → lookupBarcode (бэкенд → Open Food Facts) → PortionPicker.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Barcode, Loader2, Camera, CameraOff } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { PortionPicker } from './PortionPicker'
import { lookupBarcode, type FoodEntry, type FoodLibraryItem } from './lib'

// Минимальный тип нативного BarcodeDetector (нет в lib.dom).
interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike

interface BarcodeScannerProps {
  open: boolean
  onClose: () => void
  onAdd: (entry: Omit<FoodEntry, 'id' | 'addedAt'>) => void
}

type Phase =
  | { step: 'scan' }
  | { step: 'looking'; code: string }
  | { step: 'notfound'; code: string; message?: string }
  | { step: 'portion'; food: FoodLibraryItem }

export function BarcodeScanner({ open, onClose, onAdd }: BarcodeScannerProps) {
  const [phase, setPhase] = useState<Phase>({ step: 'scan' })
  const [manual, setManual] = useState('')
  const [cameraOn, setCameraOn] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const cameraSupported =
    typeof window !== 'undefined' && 'BarcodeDetector' in window

  const stopCamera = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setCameraOn(false)
  }, [])

  // Запуск распознавания по штрихкоду.
  const resolve = useCallback(async (code: string) => {
    stopCamera()
    setPhase({ step: 'looking', code })
    const res = await lookupBarcode(code)
    if (res.found) {
      setPhase({ step: 'portion', food: res.item })
    } else {
      setPhase({ step: 'notfound', code, message: res.error })
    }
  }, [stopCamera])

  const startCamera = useCallback(async () => {
    if (!cameraSupported) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      setCameraOn(true)

      const Detector = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector
      const detector = new Detector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'],
      })
      intervalRef.current = setInterval(async () => {
        const video = videoRef.current
        if (!video || video.readyState < 2) return
        try {
          const codes = await detector.detect(video)
          const raw = codes[0]?.rawValue
          if (raw) resolve(raw)
        } catch { /* кадр не распознан — продолжаем */ }
      }, 400)
    } catch {
      // Нет доступа к камере → остаётся ручной ввод.
      setCameraOn(false)
    }
  }, [cameraSupported, resolve])

  // Сброс + остановка камеры при закрытии; чистка при размонтировании.
  useEffect(() => {
    if (open) {
      setPhase({ step: 'scan' })
      setManual('')
    } else {
      stopCamera()
    }
    return () => stopCamera()
  }, [open, stopCamera])

  const confirmAdd = (entry: Omit<FoodEntry, 'id' | 'addedAt'>) => {
    onAdd(entry)
    onClose()
  }

  const title =
    phase.step === 'portion' ? 'Порция' : 'Поиск по штрихкоду'

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-4 border-white/60 bg-white/85 backdrop-blur-2xl dark:border-white/10 dark:bg-[#13131a]/85 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-plus-jakarta text-lg">{title}</DialogTitle>
        </DialogHeader>

        {phase.step === 'portion' ? (
          <PortionPicker food={phase.food} onConfirm={confirmAdd} />
        ) : phase.step === 'looking' ? (
          <div className="flex flex-col items-center gap-3 py-10 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm tabular-nums">Ищем {phase.code}…</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Камера */}
            {cameraSupported && (
              <div className="overflow-hidden rounded-2xl border border-black/5 bg-black/90 dark:border-white/10">
                <div className="relative aspect-[4/3] w-full">
                  <video
                    ref={videoRef}
                    muted
                    playsInline
                    className={cn(
                      'h-full w-full object-cover transition-opacity',
                      cameraOn ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  {/* Рамка-визир */}
                  {cameraOn && (
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="h-1/3 w-3/4 rounded-xl border-2 border-white/80 shadow-[0_0_0_2000px_rgba(0,0,0,0.35)]" />
                    </div>
                  )}
                  {!cameraOn && (
                    <button
                      type="button"
                      onClick={startCamera}
                      className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/90"
                    >
                      <Camera className="h-8 w-8" />
                      <span className="text-sm font-medium">Включить камеру</span>
                    </button>
                  )}
                </div>
                {cameraOn && (
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="flex w-full items-center justify-center gap-1.5 py-2 text-xs text-white/70 hover:text-white"
                  >
                    <CameraOff className="h-3.5 w-3.5" /> Выключить камеру
                  </button>
                )}
              </div>
            )}

            {/* «не найдено» */}
            {phase.step === 'notfound' && (
              <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                {phase.message || `Штрихкод ${phase.code} не найден в базе.`} Введите данные вручную в форме.
              </p>
            )}

            {/* Ручной ввод */}
            <div>
              <label className="mb-1.5 block px-1 text-[11px] font-medium text-muted-foreground">
                {cameraSupported ? 'или введите штрихкод вручную' : 'Введите штрихкод'}
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Barcode className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={manual}
                    onChange={(e) => setManual(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && manual.length >= 6) resolve(manual) }}
                    inputMode="numeric"
                    placeholder="напр. 3017620422003"
                    aria-label="Штрихкод"
                    className={cn(
                      'h-11 w-full rounded-xl pl-9 pr-3 text-sm tabular-nums outline-none',
                      'bg-white/50 dark:bg-white/[0.04] border border-black/5 dark:border-white/10',
                      'placeholder:text-muted-foreground/50 focus:bg-white/70 dark:focus:bg-white/[0.07]',
                    )}
                  />
                </div>
                <button
                  type="button"
                  disabled={manual.length < 6}
                  onClick={() => resolve(manual)}
                  className={cn(
                    'h-11 shrink-0 rounded-xl px-4 text-sm font-semibold text-white transition-all',
                    manual.length >= 6 ? 'hover:brightness-105' : 'cursor-not-allowed opacity-40',
                  )}
                  style={{ background: 'linear-gradient(135deg, #38bdf8 0%, #6366f1 100%)' }}
                >
                  Найти
                </button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
