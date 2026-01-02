"use client"

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Sparkles,
    Loader2,
    Clock,
    BookOpen,
    Coffee,
    Check,
    AlertCircle,
    Wand2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ScheduleBlock {
    type: 'LESSON' | 'BREAK'
    title: string
    durationMinutes: number
    startTime: string
    color: string
    segments?: { title: string; durationMinutes: number }[]
    subtasks?: string[]
    reason?: string
}

interface AISchedulerProps {
    className?: string
    onApplySchedule?: (blocks: ScheduleBlock[]) => void
}

export function AIScheduler({ className, onApplySchedule }: AISchedulerProps) {
    const [loading, setLoading] = useState(false)
    const [schedule, setSchedule] = useState<ScheduleBlock[] | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [totalHours, setTotalHours] = useState(4)

    const generateSchedule = async () => {
        setLoading(true)
        setError(null)
        setSchedule(null)

        try {
            const response = await fetch('/api/ai/schedule', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date: new Date().toISOString().split('T')[0],
                    totalHours,
                }),
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.error || 'Failed to generate schedule')
            }

            setSchedule(data.schedule)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error')
        } finally {
            setLoading(false)
        }
    }

    const applySchedule = async () => {
        if (!schedule) return

        // Create blocks via API
        for (const block of schedule) {
            const today = new Date().toISOString().split('T')[0]

            // First ensure day plan exists
            await fetch(`/api/dayplans/${today}`)

            // Then create block
            const dayPlanRes = await fetch(`/api/dayplans/${today}`)
            const dayPlan = await dayPlanRes.json()

            await fetch('/api/blocks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    dayPlanId: dayPlan.id,
                    type: block.type,
                    title: block.title,
                    durationMinutes: block.durationMinutes,
                    startTime: block.startTime,
                    color: block.color || '#8b5cf6',
                    segments: block.segments || [],
                    subtasks: block.subtasks || [],
                }),
            })
        }

        onApplySchedule?.(schedule)
        setSchedule(null)
    }

    const getTotalDuration = () => {
        if (!schedule) return 0
        return schedule.reduce((acc, b) => acc + b.durationMinutes, 0)
    }

    return (
        <Card className={cn("", className)}>
            <CardHeader>
                <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-purple-500" />
                    <CardTitle>AI Планировщик</CardTitle>
                </div>
                <CardDescription>
                    Gemini проанализирует ваши предметы и создаст оптимальное расписание
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Settings */}
                <div className="flex items-end gap-4">
                    <div className="flex-1">
                        <Label htmlFor="hours">Сколько часов учиться?</Label>
                        <Input
                            id="hours"
                            type="number"
                            min={1}
                            max={12}
                            value={totalHours}
                            onChange={(e) => setTotalHours(parseInt(e.target.value) || 4)}
                            className="mt-1"
                        />
                    </div>
                    <Button
                        onClick={generateSchedule}
                        disabled={loading}
                        className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                Генерация...
                            </>
                        ) : (
                            <>
                                <Wand2 className="h-4 w-4 mr-2" />
                                Сгенерировать
                            </>
                        )}
                    </Button>
                </div>

                {/* Error */}
                {error && (
                    <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 text-red-400">
                        <AlertCircle className="h-4 w-4" />
                        <span>{error}</span>
                    </div>
                )}

                {/* Generated Schedule */}
                {schedule && (
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="font-medium">Предложенное расписание</h3>
                            <Badge variant="secondary">
                                {getTotalDuration()} мин
                            </Badge>
                        </div>

                        <div className="space-y-2">
                            {schedule.map((block, index) => (
                                <div
                                    key={index}
                                    className="flex items-start gap-3 p-3 rounded-lg border bg-muted/30"
                                    style={{ borderLeftColor: block.color, borderLeftWidth: 3 }}
                                >
                                    <div className="pt-0.5">
                                        {block.type === 'BREAK' ? (
                                            <Coffee className="h-4 w-4 text-muted-foreground" />
                                        ) : (
                                            <BookOpen className="h-4 w-4 text-muted-foreground" />
                                        )}
                                    </div>
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium">{block.title}</span>
                                            <Badge variant="outline" className="text-xs">
                                                {block.startTime}
                                            </Badge>
                                            <Badge variant="secondary" className="text-xs">
                                                {block.durationMinutes} мин
                                            </Badge>
                                        </div>
                                        {block.reason && (
                                            <p className="text-sm text-muted-foreground mt-1">
                                                {block.reason}
                                            </p>
                                        )}
                                        {block.segments && block.segments.length > 0 && (
                                            <div className="flex gap-2 mt-2">
                                                {block.segments.map((seg, i) => (
                                                    <Badge key={i} variant="outline" className="text-xs">
                                                        {seg.title}: {seg.durationMinutes}м
                                                    </Badge>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="flex gap-2">
                            <Button onClick={applySchedule} className="flex-1">
                                <Check className="h-4 w-4 mr-2" />
                                Применить расписание
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => setSchedule(null)}
                            >
                                Отмена
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
