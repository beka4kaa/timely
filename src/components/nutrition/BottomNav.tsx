"use client"

/**
 * BottomNav — компактная плавающая «пилюля» в стекле, по образцу нижнего
 * меню в «Привычках»: иконки-кружки без подписей. Активная вкладка
 * подсвечивает только иконку, без дополнительной заливки или обводки.
 */

import { motion } from 'framer-motion'
import { BarChart3, ClipboardList, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ACCENT_GRADIENT, softHaptic } from './lib'

export type NutritionTab = 'analytics' | 'diary'

function TabButton({
  active, icon, label, onClick,
}: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.88 }}
      onClick={() => { softHaptic(); onClick() }}
      aria-label={label}
      aria-current={active}
      className={cn(
        'relative flex h-12 w-12 items-center justify-center rounded-full transition-colors',
        active
          ? 'text-zinc-950 dark:text-white'
          : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300',
      )}
    >
      <span
        className={cn(
          'transition-[filter,opacity,transform] duration-200 ease-out',
          active
            ? 'scale-105 opacity-100 drop-shadow-[0_0_9px_rgba(24,24,27,0.18)] dark:drop-shadow-[0_0_10px_rgba(255,255,255,0.55)]'
            : 'opacity-70',
        )}
      >
        {icon}
      </span>
    </motion.button>
  )
}

export function BottomNav({
  tab, onTab, onFab,
}: { tab: NutritionTab; onTab: (t: NutritionTab) => void; onFab: () => void }) {
  return (
    <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2">
      <div className="flex items-center gap-1 rounded-full border border-white/60 bg-white/70 p-1.5 shadow-[0_6px_20px_rgba(15,23,42,0.12)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-white/[0.08]">
        <TabButton
          active={tab === 'analytics'}
          icon={<BarChart3 className="h-5 w-5" />}
          label="Аналитика"
          onClick={() => onTab('analytics')}
        />

        {/* Центральная кнопка добавления */}
        <motion.button
          type="button"
          whileTap={{ scale: 0.9 }}
          onClick={() => { softHaptic(); onFab() }}
          aria-label="Добавить"
          className="flex h-12 w-12 items-center justify-center rounded-full text-white shadow-[0_4px_14px_-2px_rgba(192,132,252,0.7)]"
          style={{ background: ACCENT_GRADIENT }}
        >
          <Plus className="h-5 w-5" strokeWidth={2.6} />
        </motion.button>

        <TabButton
          active={tab === 'diary'}
          icon={<ClipboardList className="h-5 w-5" />}
          label="Дневник"
          onClick={() => onTab('diary')}
        />
      </div>
    </div>
  )
}
