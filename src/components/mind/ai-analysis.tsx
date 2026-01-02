"use client"

import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
    Brain,
    Loader2,
    Lightbulb,
    Target,
    Sparkles,
    Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Analysis {
    summary: string
    recommendations: { priority: 'high' | 'medium' | 'low'; text: string }[]
    focusAreas: string[]
    encouragement: string
}

interface Stats {
    totalTopics: number
    masteredTopics: number
    overdueTopics: number
    totalStudyMinutes: number
    avgSessionMinutes: number
}

interface AIAnalysisProps {
    className?: string
}

export function AIAnalysis({ className }: AIAnalysisProps) {
    const [loading, setLoading] = useState(false)
    const [analysis, setAnalysis] = useState<Analysis | null>(null)
    const [stats, setStats] = useState<Stats | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [fromCache, setFromCache] = useState(false)

    // Load cached data (no API call)
    const loadCached = async () => {
        try {
            const response = await fetch('/api/ai/analyze')
            const data = await response.json()

            if (data.stats && data.analysis) {
                setAnalysis(data.analysis)
                setStats(data.stats)
                setFromCache(data.fromCache || false)
            }
        } catch (err) {
            console.error(err)
        }
    }

    // Generate new analysis (uses API quota)
    const generateNew = async () => {
        setLoading(true)
        setError(null)

        try {
            const response = await fetch('/api/ai/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ forceRefresh: true }),
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || 'Failed to analyze')
            }

            setAnalysis(data.analysis)
            setStats(data.stats)
            setFromCache(false)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error')
        } finally {
            setLoading(false)
        }
    }

    const getPriorityColor = (priority: string) => {
        switch (priority) {
            case 'high':
                return 'bg-red-500/20 text-red-400 border-red-500/30'
            case 'medium':
                return 'bg-amber-500/20 text-amber-400 border-amber-500/30'
            case 'low':
                return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
            default:
                return ''
        }
    }

    useEffect(() => {
        // Only load cached data on mount - no API call!
        loadCached()
    }, [])

    return (
        <Card className={cn("", className)}>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Brain className="h-5 w-5 text-purple-500" />
                        <CardTitle>AI Анализ</CardTitle>
                        {fromCache && (
                            <span className="text-xs text-muted-foreground">из кэша</span>
                        )}
                    </div>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={generateNew}
                        disabled={loading}
                        className="gap-1"
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
                </div>
                <CardDescription>
                    Анализ вашего прогресса и рекомендации
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {loading && (
                    <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                )}

                {error && (
                    <div className="text-red-400 text-sm">{error}</div>
                )}

                {!loading && !stats && !error && (
                    <div className="text-center py-4 text-muted-foreground text-sm">
                        Нажмите «Обновить» для анализа прогресса
                    </div>
                )}

                {!loading && stats && (
                    <>
                        {/* Stats Grid */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="p-3 rounded-lg bg-muted/50">
                                <div className="text-2xl font-bold">{stats.totalTopics}</div>
                                <div className="text-xs text-muted-foreground">Всего тем</div>
                            </div>
                            <div className="p-3 rounded-lg bg-emerald-500/10">
                                <div className="text-2xl font-bold text-emerald-400">{stats.masteredTopics}</div>
                                <div className="text-xs text-muted-foreground">Освоено</div>
                            </div>
                            <div className="p-3 rounded-lg bg-amber-500/10">
                                <div className="text-2xl font-bold text-amber-400">{stats.overdueTopics}</div>
                                <div className="text-xs text-muted-foreground">Просрочено</div>
                            </div>
                            <div className="p-3 rounded-lg bg-blue-500/10">
                                <div className="text-2xl font-bold text-blue-400">{Math.round(stats.totalStudyMinutes / 60)}ч</div>
                                <div className="text-xs text-muted-foreground">За неделю</div>
                            </div>
                        </div>

                        {/* Analysis */}
                        {analysis && (
                            <>
                                <div className="p-4 rounded-lg bg-gradient-to-br from-purple-500/10 to-blue-500/10 border border-purple-500/20">
                                    <p className="text-sm">{analysis.summary}</p>
                                </div>

                                {/* Recommendations */}
                                {analysis.recommendations.length > 0 && (
                                    <div className="space-y-2">
                                        <h4 className="text-sm font-medium flex items-center gap-2">
                                            <Lightbulb className="h-4 w-4" />
                                            Рекомендации
                                        </h4>
                                        {analysis.recommendations.map((rec, i) => (
                                            <div
                                                key={i}
                                                className={cn(
                                                    "p-2 rounded-lg border text-sm",
                                                    getPriorityColor(rec.priority)
                                                )}
                                            >
                                                {rec.text}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Focus Areas */}
                                {analysis.focusAreas.length > 0 && (
                                    <div className="space-y-2">
                                        <h4 className="text-sm font-medium flex items-center gap-2">
                                            <Target className="h-4 w-4" />
                                            Фокус
                                        </h4>
                                        <div className="flex flex-wrap gap-2">
                                            {analysis.focusAreas.map((area, i) => (
                                                <Badge key={i} variant="outline">
                                                    {area}
                                                </Badge>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Encouragement */}
                                <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400 text-sm">
                                    💪 {analysis.encouragement}
                                </div>
                            </>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    )
}
