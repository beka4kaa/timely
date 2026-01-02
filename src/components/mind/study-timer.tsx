"use client"

import React, { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    Play,
    Pause,
    Square,
    Clock,
    Coffee,
    Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { MindSession } from '@/types/mind'

interface StudyTimerProps {
    className?: string
    onSessionEnd?: (session: MindSession) => void
}

export function StudyTimer({ className, onSessionEnd }: StudyTimerProps) {
    const [activeSession, setActiveSession] = useState<MindSession | null>(null)
    const [elapsed, setElapsed] = useState(0)
    const [isRunning, setIsRunning] = useState(false)
    const [showStartDialog, setShowStartDialog] = useState(false)
    const [taskName, setTaskName] = useState('')
    const [loading, setLoading] = useState(false)
    const timerRef = useRef<NodeJS.Timeout | null>(null)

    // Timer effect
    useEffect(() => {
        if (isRunning) {
            timerRef.current = setInterval(() => {
                setElapsed(prev => prev + 1)
            }, 1000)
        }

        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current)
            }
        }
    }, [isRunning])

    // Format time
    const formatTime = (seconds: number) => {
        const h = Math.floor(seconds / 3600)
        const m = Math.floor((seconds % 3600) / 60)
        const s = seconds % 60
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    }

    // Start session
    const handleStart = async () => {
        if (!taskName.trim()) return

        setLoading(true)
        try {
            const response = await fetch('/api/mind-sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskName: taskName.trim() }),
            })

            if (response.ok) {
                const session = await response.json()
                setActiveSession(session)
                setIsRunning(true)
                setElapsed(0)
                setShowStartDialog(false)
                setTaskName('')
            }
        } catch (error) {
            console.error('Error starting session:', error)
        } finally {
            setLoading(false)
        }
    }

    // Pause/Resume
    const togglePause = () => {
        setIsRunning(!isRunning)
    }

    // Stop session
    const handleStop = async () => {
        if (!activeSession) return

        setLoading(true)
        try {
            const response = await fetch(`/api/mind-sessions/${activeSession.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    endedAt: new Date().toISOString(),
                }),
            })

            if (response.ok) {
                const session = await response.json()
                onSessionEnd?.(session)
                setActiveSession(null)
                setIsRunning(false)
                setElapsed(0)
            }
        } catch (error) {
            console.error('Error stopping session:', error)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className={cn("", className)}>
            <Card className="bg-gradient-to-br from-gray-900 to-gray-800 border-gray-700">
                <CardContent className="p-8 flex flex-col items-center justify-center min-h-[300px]">
                    {activeSession ? (
                        <>
                            <div className="text-muted-foreground mb-2">
                                {activeSession.taskName}
                            </div>
                            <div className="text-6xl font-mono font-bold text-white mb-8">
                                {formatTime(elapsed)}
                            </div>
                            <div className="flex items-center gap-4">
                                <Button
                                    size="lg"
                                    variant="outline"
                                    onClick={togglePause}
                                >
                                    {isRunning ? (
                                        <>
                                            <Pause className="h-5 w-5 mr-2" />
                                            Пауза
                                        </>
                                    ) : (
                                        <>
                                            <Play className="h-5 w-5 mr-2" />
                                            Продолжить
                                        </>
                                    )}
                                </Button>
                                <Button
                                    size="lg"
                                    variant="destructive"
                                    onClick={handleStop}
                                    disabled={loading}
                                >
                                    {loading ? (
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                    ) : (
                                        <>
                                            <Square className="h-5 w-5 mr-2" />
                                            Завершить
                                        </>
                                    )}
                                </Button>
                            </div>
                        </>
                    ) : (
                        <>
                            <Clock className="h-16 w-16 text-muted-foreground mb-4" />
                            <h2 className="text-2xl font-bold text-white mb-2">
                                Трекер учёбы
                            </h2>
                            <p className="text-muted-foreground mb-6">
                                Отслеживайте время, которое вы тратите на обучение
                            </p>
                            <Button
                                size="lg"
                                onClick={() => setShowStartDialog(true)}
                            >
                                <Play className="h-5 w-5 mr-2" />
                                Начать работу
                            </Button>
                        </>
                    )}
                </CardContent>
            </Card>

            {/* Start Dialog */}
            <Dialog open={showStartDialog} onOpenChange={setShowStartDialog}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Начать сессию</DialogTitle>
                        <DialogDescription>
                            Над чем вы собираетесь работать?
                        </DialogDescription>
                    </DialogHeader>

                    <Input
                        placeholder="Например: Подготовка к экзамену по физике"
                        value={taskName}
                        onChange={(e) => setTaskName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleStart()}
                    />

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowStartDialog(false)}>
                            Отмена
                        </Button>
                        <Button onClick={handleStart} disabled={!taskName.trim() || loading}>
                            {loading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <>
                                    <Play className="h-4 w-4 mr-2" />
                                    Начать
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
