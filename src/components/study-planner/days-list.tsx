"use client"

import React, { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
    Calendar,
    ChevronRight,
    Loader2
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { DayPlan, formatDuration, calculateBlockProgress } from '@/types/study-planner'

interface DaysListProps {
    onSelectDate?: (date: string) => void
    className?: string
}

interface DaySummary {
    date: string
    totalBlocks: number
    doneBlocks: number
    totalMinutes: number
    progress: number
}

export function DaysList({ onSelectDate, className }: DaysListProps) {
    const [days, setDays] = useState<DaySummary[]>([])
    const [loading, setLoading] = useState(true)

    const fetchDays = useCallback(async () => {
        setLoading(true)
        try {
            // Get last 14 days
            const today = new Date()
            const fromDate = new Date()
            fromDate.setDate(today.getDate() - 14)

            const response = await fetch(
                `/api/dayplans?from=${fromDate.toISOString().split('T')[0]}&to=${today.toISOString().split('T')[0]}`
            )

            if (response.ok) {
                const data: DayPlan[] = await response.json()

                // Create summaries for each day
                const summaries: DaySummary[] = data.map(plan => ({
                    date: plan.date,
                    totalBlocks: plan.blocks.length,
                    doneBlocks: plan.blocks.filter(b => b.status === 'DONE').length,
                    totalMinutes: plan.blocks.reduce((acc, b) => acc + b.durationMinutes, 0),
                    progress: plan.blocks.length > 0
                        ? Math.round(
                            plan.blocks.reduce((acc, b) => acc + calculateBlockProgress(b), 0) / plan.blocks.length
                        )
                        : 0,
                }))

                // Sort by date descending
                summaries.sort((a, b) => b.date.localeCompare(a.date))
                setDays(summaries)
            }
        } catch (error) {
            console.error('Error fetching days:', error)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchDays()
    }, [fetchDays])

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr)
        const today = new Date().toISOString().split('T')[0]
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        const yesterdayStr = yesterday.toISOString().split('T')[0]

        if (dateStr === today) return 'Сегодня'
        if (dateStr === yesterdayStr) return 'Вчера'

        return date.toLocaleDateString('ru-RU', {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
        })
    }

    const getProgressColor = (progress: number) => {
        if (progress >= 80) return 'bg-emerald-500'
        if (progress >= 50) return 'bg-amber-500'
        if (progress > 0) return 'bg-blue-500'
        return 'bg-muted'
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className={cn("space-y-4", className)}>
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                    <Calendar className="h-5 w-5" />
                    История (последние 14 дней)
                </h2>
            </div>

            {days.length === 0 ? (
                <Card className="border-dashed">
                    <CardContent className="p-8 text-center text-muted-foreground">
                        <Calendar className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p>Нет данных за последние дни</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-3">
                    {days.map((day) => (
                        <Card
                            key={day.date}
                            className={cn(
                                "cursor-pointer transition-all hover:shadow-md hover:border-primary/50",
                                day.progress === 100 && "bg-emerald-50/50 dark:bg-emerald-950/20"
                            )}
                            onClick={() => onSelectDate?.(day.date)}
                        >
                            <CardContent className="p-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-4">
                                        <div>
                                            <div className="font-medium">{formatDate(day.date)}</div>
                                            <div className="text-sm text-muted-foreground">
                                                {day.date}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-6">
                                        <div className="text-right">
                                            <div className="text-sm text-muted-foreground">Блоков</div>
                                            <div className="font-medium">{day.doneBlocks}/{day.totalBlocks}</div>
                                        </div>

                                        <div className="text-right">
                                            <div className="text-sm text-muted-foreground">Время</div>
                                            <div className="font-medium">{formatDuration(day.totalMinutes)}</div>
                                        </div>

                                        <div className="w-24">
                                            <div className="text-sm text-muted-foreground mb-1 text-right">
                                                {day.progress}%
                                            </div>
                                            <Progress
                                                value={day.progress}
                                                className={cn("h-2", getProgressColor(day.progress))}
                                            />
                                        </div>

                                        <ChevronRight className="h-5 w-5 text-muted-foreground" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    )
}
