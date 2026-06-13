"use client"

/**
 * FoodHistory — «История за день»: список добавленных продуктов стеклянными
 * карточками. Каждая карточка показывает название, время, калории и БЖУ-чипы;
 * по наведению — кнопка удаления. Пустое состояние — мягкая подсказка.
 */

import { motion, AnimatePresence } from 'framer-motion'
import { Trash2, History } from 'lucide-react'
import { cn } from '@/lib/utils'
import { GLASS, MACROS, formatTime, type FoodEntry } from './lib'

interface FoodHistoryProps {
  entries: FoodEntry[]
  onRemove: (id: string) => void
}

/** Маленькие БЖУ-чипы под названием продукта. */
function MacroChips({ entry }: { entry: FoodEntry }) {
  // Только 3 макро (без калорий — они вынесены справа крупно).
  const macro = MACROS.filter((m) => m.key !== 'kcal')
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {macro.map((m) => (
        <span
          key={m.key}
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
          style={{ background: `${m.color}1f`, color: m.color }}
        >
          {m.label[0]} {Math.round(entry[m.key])}
          <span className="opacity-60">{m.unit}</span>
        </span>
      ))}
    </div>
  )
}

export function FoodHistory({ entries, onRemove }: FoodHistoryProps) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">История за день</h2>
        </div>
        {entries.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {entries.length} {entries.length === 1 ? 'запись' : 'записей'}
          </span>
        )}
      </div>

      {entries.length === 0 ? (
        <div
          className={cn(
            GLASS,
            'flex flex-col items-center justify-center gap-2 rounded-[24px] px-6 py-12 text-center',
          )}
        >
          <span className="text-3xl">🍎</span>
          <p className="text-sm font-medium">Пока пусто</p>
          <p className="max-w-[260px] text-xs text-muted-foreground">
            Добавьте первый продукт вручную или через быстрые действия выше.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5">
          <AnimatePresence initial={false}>
            {entries.map((entry) => (
              <motion.li
                key={entry.id}
                layout
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                className={cn(GLASS, 'group flex items-center gap-3 rounded-2xl p-3.5')}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">{entry.name}</p>
                    <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                      {formatTime(entry.addedAt)}
                    </span>
                  </div>
                  <MacroChips entry={entry} />
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <div className="text-right leading-none">
                    <span className="text-base font-bold tabular-nums">
                      {Math.round(entry.kcal)}
                    </span>
                    <span className="ml-0.5 text-[10px] text-muted-foreground">ккал</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(entry.id)}
                    aria-label={`Удалить ${entry.name}`}
                    className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground',
                      'opacity-0 transition-all hover:bg-red-500/10 hover:text-red-500',
                      'group-hover:opacity-100 focus-visible:opacity-100',
                    )}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </section>
  )
}
