"use client"

/**
 * AddSheet — стеклянный bottom-sheet, открывается по FAB. Два способа добавить:
 *   • «Сканировать штрихкод» → открывает сканер (камера + Open Food Facts);
 *   • «Фото еды (ИИ)»        → открывает фото-анализ (Gemini vision).
 * Оба способа уже рабочие; sheet — единая точка входа в них.
 */

import { motion, AnimatePresence } from 'framer-motion'
import { Barcode, Camera, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { GLASS, softHaptic } from './lib'

interface AddSheetProps {
  open: boolean
  onClose: () => void
  onBarcode: () => void
  onPhoto: () => void
}

function SheetAction({
  icon, title, subtitle, gradient, onClick,
}: { icon: React.ReactNode; title: string; subtitle: string; gradient: string; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.98 }}
      onClick={() => { softHaptic(); onClick() }}
      className={cn(
        GLASS,
        'flex w-full items-center gap-3.5 rounded-2xl p-4 text-left transition-colors',
        'hover:bg-white/80 dark:hover:bg-white/[0.09]',
      )}
    >
      <span
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
        style={{ background: gradient }}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold leading-tight">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{subtitle}</span>
      </span>
    </motion.button>
  )
}

export function AddSheet({ open, onClose, onBarcode, onPhoto }: AddSheetProps) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          {/* Затемнение */}
          <motion.div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Лист снизу */}
          <motion.div
            className="absolute inset-x-0 bottom-0 flex justify-center px-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
            initial={{ y: '110%' }}
            animate={{ y: 0 }}
            exit={{ y: '110%' }}
            transition={{ type: 'spring', stiffness: 360, damping: 34 }}
          >
            <div
              className={cn(
                GLASS,
                'w-full max-w-md rounded-[28px] p-4',
                'shadow-[0_-10px_40px_-8px_rgba(15,23,42,0.3)]',
              )}
            >
              {/* ручка */}
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-foreground/15" />
              <p className="mb-3 px-1 text-sm font-semibold">Добавить продукт</p>
              <div className="flex flex-col gap-2.5">
                <SheetAction
                  icon={<Barcode className="h-6 w-6" />}
                  title="Сканировать штрихкод"
                  subtitle="Найдём в Open Food Facts"
                  gradient="linear-gradient(135deg, #38bdf8 0%, #6366f1 100%)"
                  onClick={() => { onClose(); onBarcode() }}
                />
                <SheetAction
                  icon={<Camera className="h-6 w-6" />}
                  title="Фото еды (ИИ)"
                  subtitle="Оценим БЖУ по снимку"
                  gradient="linear-gradient(135deg, #fb7185 0%, #a855f7 100%)"
                  onClick={() => { onClose(); onPhoto() }}
                />
              </div>
              <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                <Sparkles className="h-3 w-3" /> Или найдите продукт во вкладке «Дневник»
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
