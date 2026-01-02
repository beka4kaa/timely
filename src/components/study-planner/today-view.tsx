"use client"

import React, { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
    ChevronLeft,
    ChevronRight,
    Copy,
    Plus,
    Calendar,
    RefreshCw,
    Loader2
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { BlockCard } from './block-card'
import { AddBlockDialog } from './add-block-dialog'
import { DayPlan, Block, formatDuration, calculateBlockProgress } from '@/types/study-planner'

interface TodayViewProps {
    className?: string
}

export function TodayView({ className }: TodayViewProps) {
    const [currentDate, setCurrentDate] = useState(new Date().toISOString().split('T')[0])
    const [dayPlan, setDayPlan] = useState<DayPlan | null>(null)
    const [loading, setLoading] = useState(true)
    const [copying, setCopying] = useState(false)
    const [showAddDialog, setShowAddDialog] = useState(false)

    // Fetch day plan
    const fetchDayPlan = useCallback(async () => {
        setLoading(true)
        try {
            const response = await fetch(`/api/dayplans/${currentDate}`)
            if (response.ok) {
                const data = await response.json()
                setDayPlan(data)
            }
        } catch (error) {
            console.error('Error fetching day plan:', error)
        } finally {
            setLoading(false)
        }
    }, [currentDate])

    useEffect(() => {
        fetchDayPlan()
    }, [fetchDayPlan])

    // Navigate dates
    const navigateDate = (direction: 'prev' | 'next' | 'today') => {
        const date = new Date(currentDate)
        if (direction === 'prev') {
            date.setDate(date.getDate() - 1)
        } else if (direction === 'next') {
            date.setDate(date.getDate() + 1)
        } else {
            return setCurrentDate(new Date().toISOString().split('T')[0])
        }
        setCurrentDate(date.toISOString().split('T')[0])
    }

    // Copy yesterday's plan
    const copyYesterday = async () => {
        setCopying(true)
        try {
            const yesterday = new Date(currentDate)
            yesterday.setDate(yesterday.getDate() - 1)
            const yesterdayStr = yesterday.toISOString().split('T')[0]

            const response = await fetch(`/api/dayplans/${currentDate}/copy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sourceDate: yesterdayStr }),
            })

            if (response.ok) {
                const data = await response.json()
                setDayPlan(data)
            }
        } catch (error) {
            console.error('Error copying plan:', error)
        } finally {
            setCopying(false)
        }
    }

    // Format date for display
    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr)
        const today = new Date().toISOString().split('T')[0]
        const yesterday = new Date()
        yesterday.setDate(yesterday.getDate() - 1)
        const yesterdayStr = yesterday.toISOString().split('T')[0]
        const tomorrow = new Date()
        tomorrow.setDate(tomorrow.getDate() + 1)
        const tomorrowStr = tomorrow.toISOString().split('T')[0]

        if (dateStr === today) return 'Сегодня'
        if (dateStr === yesterdayStr) return 'Вчера'
        if (dateStr === tomorrowStr) return 'Завтра'

        return date.toLocaleDateString('ru-RU', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
        })
    }

    // Handle block update
    const handleBlockUpdate = (updatedBlock: Block) => {
        if (!dayPlan) return
        setDayPlan({
            ...dayPlan,
            blocks: dayPlan.blocks.map(b => b.id === updatedBlock.id ? updatedBlock : b),
        })
    }

    // Handle block delete
    const handleBlockDelete = (blockId: string) => {
        if (!dayPlan) return
        setDayPlan({
            ...dayPlan,
            blocks: dayPlan.blocks.filter(b => b.id !== blockId),
        })
    }

    // Handle new block added
    const handleBlockAdded = (newBlock: Block) => {
        if (!dayPlan) return
        setDayPlan({
            ...dayPlan,
            blocks: [...dayPlan.blocks, newBlock].sort((a, b) => a.orderIndex - b.orderIndex),
        })
        setShowAddDialog(false)
    }

    // Calculate stats
    const stats = dayPlan ? {
        total: dayPlan.blocks.length,
        done: dayPlan.blocks.filter(b => b.status === 'DONE').length,
        totalMinutes: dayPlan.blocks.reduce((acc, b) => acc + b.durationMinutes, 0),
        progress: dayPlan.blocks.length > 0
            ? Math.round(dayPlan.blocks.reduce((acc, b) => acc + calculateBlockProgress(b), 0) / dayPlan.blocks.length)
            : 0,
    } : { total: 0, done: 0, totalMinutes: 0, progress: 0 }

    return (
        <div className={cn("space-y-6", className)}>
            {/* Header with date navigation */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => navigateDate('prev')}
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </Button>

                    <div className="flex items-center gap-2">
                        <Calendar className="h-5 w-5 text-muted-foreground" />
                        <h1 className="text-xl font-semibold capitalize">
                            {formatDate(currentDate)}
                        </h1>
                    </div>

                    <Button
                        variant="outline"
                        size="icon"
                        onClick={() => navigateDate('next')}
                    >
                        <ChevronRight className="h-4 w-4" />
                    </Button>

                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigateDate('today')}
                        className="ml-2"
                    >
                        Сегодня
                    </Button>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={copyYesterday}
                        disabled={copying || loading}
                    >
                        {copying ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                            <Copy className="h-4 w-4 mr-2" />
                        )}
                        Скопировать со вчера
                    </Button>

                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={fetchDayPlan}
                        disabled={loading}
                    >
                        <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    </Button>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-4 gap-4">
                <Card>
                    <CardContent className="p-4 flex items-center justify-between">
                        <div className="text-sm text-muted-foreground">Блоков</div>
                        <div className="text-2xl font-bold">{stats.done}/{stats.total}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4 flex items-center justify-between">
                        <div className="text-sm text-muted-foreground">Прогресс</div>
                        <div className="text-2xl font-bold">{stats.progress}%</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4 flex items-center justify-between">
                        <div className="text-sm text-muted-foreground">Всего времени</div>
                        <div className="text-2xl font-bold">{formatDuration(stats.totalMinutes)}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4 flex items-center justify-between">
                        <div className="text-sm text-muted-foreground">Дата</div>
                        <div className="text-lg font-medium">{currentDate}</div>
                    </CardContent>
                </Card>
            </div>

            {/* Loading state */}
            {loading && (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            )}

            {/* Blocks list */}
            {!loading && dayPlan && (
                <div className="space-y-4">
                    {dayPlan.blocks.length === 0 ? (
                        <Card className="border-dashed">
                            <CardContent className="p-8 text-center">
                                <div className="text-muted-foreground mb-4">
                                    <Calendar className="h-12 w-12 mx-auto mb-2 opacity-50" />
                                    <p>Нет запланированных блоков на этот день</p>
                                </div>
                                <Button onClick={() => setShowAddDialog(true)}>
                                    <Plus className="h-4 w-4 mr-2" />
                                    Добавить блок
                                </Button>
                            </CardContent>
                        </Card>
                    ) : (
                        <>
                            {dayPlan.blocks.map((block) => (
                                <BlockCard
                                    key={block.id}
                                    block={block}
                                    onUpdate={handleBlockUpdate}
                                    onDelete={handleBlockDelete}
                                />
                            ))}
                        </>
                    )}
                </div>
            )}

            {/* Add Block Button */}
            {!loading && dayPlan && dayPlan.blocks.length > 0 && (
                <Button
                    className="w-full"
                    variant="outline"
                    onClick={() => setShowAddDialog(true)}
                >
                    <Plus className="h-4 w-4 mr-2" />
                    Добавить блок
                </Button>
            )}

            {/* Add Block Dialog */}
            <AddBlockDialog
                open={showAddDialog}
                onOpenChange={setShowAddDialog}
                dayPlanId={dayPlan?.id || ''}
                onBlockAdded={handleBlockAdded}
            />
        </div>
    )
}
