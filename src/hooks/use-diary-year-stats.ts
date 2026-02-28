"use client"

/**
 * useDiaryYearStats
 *
 * Загружает все существующие недели за год одним запросом к /api/diary/year
 * и возвращает статистику оценок по каждому предмету.
 *
 * Использование:
 *   const { stats, weeks, loading, error } = useDiaryYearStats(2026)
 */

import { useEffect, useState } from 'react'
import { calcYearStats, type SubjectYearStat } from '@/lib/diary-grades'
import type { DiaryWeek } from '@/types/diary'

interface UseYearStatsResult {
  stats: SubjectYearStat[]
  weeks: DiaryWeek[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useDiaryYearStats(year = new Date().getFullYear()): UseYearStatsResult {
  const [stats, setStats] = useState<SubjectYearStat[]>([])
  const [weeks, setWeeks] = useState<DiaryWeek[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      try {
        // Один запрос — все сохранённые недели года
        const res = await fetch(`/api/diary/year?year=${year}`)
        if (!res.ok) throw new Error(await res.text())
        const data: DiaryWeek[] = await res.json()

        if (!cancelled) {
          setWeeks(data)
          setStats(calcYearStats(data, year))
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Ошибка загрузки')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [year, tick])

  return { stats, weeks, loading, error, refetch: () => setTick(t => t + 1) }
}
