"use client"

import React, { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MindSession } from '@/types/mind'

interface SessionsListProps {
    className?: string
    refreshTrigger?: number
}

export function SessionsList({ className, refreshTrigger }: SessionsListProps) {
    const [sessions, setSessions] = useState<MindSession[]>([])
    const [loading, setLoading] = useState(true)

    const fetchSessions = useCallback(async () => {
        setLoading(true)
        try {
            const response = await fetch('/api/mind-sessions?days=14')
            if (response.ok) {
                const data = await response.json()
                setSessions(data)
            }
        } catch (error) {
            console.error('Error fetching sessions:', error)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchSessions()
    }, [fetchSessions, refreshTrigger])

    // Group sessions by date
    const groupedSessions = sessions.reduce((acc, session) => {
        const date = new Date(session.startedAt).toLocaleDateString('ru-RU', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
        })
        if (!acc[date]) {
            acc[date] = []
        }
        acc[date].push(session)
        return acc
    }, {} as Record<string, MindSession[]>)

    const formatTime = (dateStr: string) => {
        return new Date(dateStr).toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
        })
    }

    const formatDuration = (minutes: number | null) => {
        if (!minutes) return '—'
        const h = Math.floor(minutes / 60)
        const m = minutes % 60
        if (h > 0) return `${h}ч ${m}м`
        return `${m}м`
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (sessions.length === 0) {
        return (
            <Card className="border-dashed">
                <CardContent className="p-8 text-center text-muted-foreground">
                    <Calendar className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Нет записей за последние дни</p>
                </CardContent>
            </Card>
        )
    }

    return (
        <div className={cn("space-y-6", className)}>
            {Object.entries(groupedSessions).map(([date, daySessions]) => {
                const totalMinutes = daySessions.reduce((acc, s) => acc + (s.totalMinutes || 0), 0)

                return (
                    <div key={date} className="space-y-2">
                        <div className="flex items-center justify-between px-2">
                            <h3 className="font-medium capitalize">{date}</h3>
                            <Badge variant="secondary">
                                Всего: {formatDuration(totalMinutes)}
                            </Badge>
                        </div>

                        <div className="rounded-lg border overflow-hidden">
                            <table className="w-full text-sm">
                                <thead className="bg-muted/50">
                                    <tr>
                                        <th className="text-left p-3 font-medium">Задача</th>
                                        <th className="text-left p-3 font-medium">Начало</th>
                                        <th className="text-left p-3 font-medium">Конец</th>
                                        <th className="text-left p-3 font-medium">Длительность</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {daySessions.map((session) => (
                                        <tr key={session.id} className="border-t hover:bg-muted/30">
                                            <td className="p-3">
                                                <div className="flex items-center gap-2">
                                                    <span>{session.taskName}</span>
                                                    {session.topic && (
                                                        <Badge variant="outline" className="text-xs">
                                                            {session.topic.subject?.emoji} {session.topic.name}
                                                        </Badge>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-3 text-muted-foreground">
                                                {formatTime(session.startedAt)}
                                            </td>
                                            <td className="p-3 text-muted-foreground">
                                                {session.endedAt ? formatTime(session.endedAt) : '—'}
                                            </td>
                                            <td className="p-3">
                                                {session.totalMinutes ? (
                                                    <Badge variant="secondary">
                                                        {formatDuration(session.totalMinutes)}
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-amber-500">
                                                        В процессе
                                                    </Badge>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
