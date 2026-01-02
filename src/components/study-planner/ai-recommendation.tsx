"use client"

import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
    Sparkles,
    Loader2,
    RefreshCw,
    Clock,
    ChevronDown,
    ChevronUp,
    Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface DailyTask {
    subjectEmoji: string
    subjectName: string
    topicName: string
    hours: number
    priority: 'high' | 'medium' | 'low'
    reason: string
}

interface AIRecommendationProps {
    className?: string
    onAddBlock?: (task: DailyTask) => void
}

export function AIRecommendation({ className, onAddBlock }: AIRecommendationProps) {
    const [loading, setLoading] = useState(false)
    const [tasks, setTasks] = useState<DailyTask[]>([])
    const [expanded, setExpanded] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [fromCache, setFromCache] = useState(false)
    const [cachedAt, setCachedAt] = useState<string | null>(null)

    // Load cached data on mount (GET - no API call)
    const loadCached = async () => {
        try {
            const res = await fetch('/api/ai/daily-tasks')
            if (!res.ok) return
            const data = await res.json()
            setTasks(data.tasks || [])
            setFromCache(data.fromCache || false)
            if (data.cachedAt) {
                setCachedAt(new Date(data.cachedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))
            }
        } catch (err) {
            console.error(err)
        }
    }

    // Generate new recommendations (POST - uses API quota)
    const generateNew = async () => {
        setLoading(true)
        setError(null)

        try {
            const res = await fetch('/api/ai/daily-tasks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ forceRefresh: true }),
            })
            if (!res.ok) throw new Error('Failed to fetch')
            const data = await res.json()
            setTasks(data.tasks || [])
            setFromCache(false)
            setCachedAt(new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }))
        } catch (err) {
            setError('Не удалось загрузить')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        // Only load cached data on mount - NO API calls!
        loadCached()
    }, [])

    const getPriorityColor = (priority: string) => {
        switch (priority) {
            case 'high':
                return 'bg-red-500/20 text-red-400'
            case 'medium':
                return 'bg-amber-500/20 text-amber-400'
            default:
                return 'bg-blue-500/20 text-blue-400'
        }
    }

    const totalHours = tasks.reduce((acc, t) => acc + t.hours, 0)

    return (
        <Card className={cn("border-purple-500/30 bg-gradient-to-br from-purple-500/5 to-blue-500/5", className)}>
            <CardContent className="p-4">
                {/* Header */}
                <div
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() => setExpanded(!expanded)}
                >
                    <div className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-purple-500" />
                        <span className="font-medium">AI рекомендует на сегодня</span>
                        {tasks.length > 0 && (
                            <Badge variant="secondary" className="ml-2">
                                <Clock className="h-3 w-3 mr-1" />
                                {totalHours}ч
                            </Badge>
                        )}
                        {fromCache && cachedAt && (
                            <span className="text-xs text-muted-foreground ml-2">
                                кэш {cachedAt}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 gap-1"
                            onClick={(e) => {
                                e.stopPropagation()
                                generateNew()
                            }}
                            disabled={loading}
                        >
                            {loading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <>
                                    <Zap className="h-3 w-3" />
                                    <span className="text-xs">Обновить</span>
                                </>
                            )}
                        </Button>
                        {expanded ? (
                            <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                    </div>
                </div>

                {/* Content */}
                {expanded && (
                    <div className="mt-4 space-y-2">
                        {loading && tasks.length === 0 && (
                            <div className="flex items-center justify-center py-4">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                            </div>
                        )}

                        {error && (
                            <p className="text-sm text-muted-foreground text-center py-2">{error}</p>
                        )}

                        {!loading && tasks.length === 0 && !error && (
                            <p className="text-sm text-muted-foreground text-center py-2">
                                Нажмите «Обновить» для получения рекомендаций
                            </p>
                        )}

                        {tasks.map((task, idx) => (
                            <div
                                key={idx}
                                className="flex items-center justify-between p-3 rounded-lg bg-background/50 border"
                            >
                                <div className="flex items-center gap-3">
                                    <span className="text-xl">{task.subjectEmoji}</span>
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium">{task.topicName}</span>
                                            <Badge className={cn("text-xs", getPriorityColor(task.priority))}>
                                                {task.hours}ч
                                            </Badge>
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            {task.subjectName} • {task.reason}
                                        </p>
                                    </div>
                                </div>
                                {onAddBlock && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => onAddBlock(task)}
                                    >
                                        Добавить
                                    </Button>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
