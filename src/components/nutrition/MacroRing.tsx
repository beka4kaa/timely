"use client"

/**
 * MacroRing — круговая диаграмма прогресса одной метрики (Калории/Б/Ж/У).
 * Чистый SVG, без зависимостей: два concentric-кольца (трек + прогресс с
 * градиентной обводкой), в центре — текущее/цель и подпись. Прогресс плавно
 * анимируется через framer-motion (strokeDashoffset).
 */

import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { MacroMeta } from './lib'

interface MacroRingProps {
  meta: MacroMeta
  current: number
  goal: number
  /** Диаметр кольца в px (адаптивно задаётся родителем). */
  size?: number
}

export function MacroRing({ meta, current, goal, size = 96 }: MacroRingProps) {
  const stroke = Math.max(6, Math.round(size * 0.085))
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const ratio = goal > 0 ? Math.min(current / goal, 1) : 0
  const offset = circumference * (1 - ratio)
  const over = current > goal
  const pct = Math.round((goal > 0 ? current / goal : 0) * 100)

  // Уникальный id градиента на метрику (несколько колец на странице).
  const gradId = `ring-${meta.key}`

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={meta.color} />
              <stop offset="100%" stopColor={meta.colorSoft} />
            </linearGradient>
          </defs>

          {/* Трек */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={stroke}
            className="stroke-black/[0.06] dark:stroke-white/[0.08]"
          />

          {/* Прогресс */}
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ type: 'spring', stiffness: 90, damping: 20 }}
            style={over ? { filter: `drop-shadow(0 0 6px ${meta.color}aa)` } : undefined}
          />
        </svg>

        {/* Центр: значение + % */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-base font-bold tabular-nums leading-none sm:text-lg">
            {Math.round(current)}
          </span>
          <span className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
            / {goal}
          </span>
        </div>
      </div>

      <div className="text-center leading-tight">
        <div className="text-[13px] font-medium">{meta.label}</div>
        <div
          className={cn(
            'text-[11px] tabular-nums',
            over ? 'font-semibold' : 'text-muted-foreground',
          )}
          style={over ? { color: meta.color } : undefined}
        >
          {pct}% · {meta.unit}
        </div>
      </div>
    </div>
  )
}
