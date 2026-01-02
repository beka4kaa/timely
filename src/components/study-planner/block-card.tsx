"use client"

import React, { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Checkbox } from '@/components/ui/checkbox'
import {
    Play,
    Pause,
    Check,
    SkipForward,
    ChevronDown,
    ChevronUp,
    Trash2,
    Clock,
    GripVertical,
    AlertCircle
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
    Block,
    Segment,
    Subtask,
    BlockStatus,
    formatDuration,
    formatTimer,
    calculateBlockProgress,
    getStatusLabel,
    getStatusColor,
    BLOCK_TYPE_CONFIG
} from '@/types/study-planner'

interface BlockCardProps {
    block: Block
    onUpdate: (block: Block) => void
    onDelete: (blockId: string) => void
}

export function BlockCard({ block, onUpdate, onDelete }: BlockCardProps) {
    const [isExpanded, setIsExpanded] = useState(false)
    const [isRunning, setIsRunning] = useState(false)
    const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0)
    const [remainingSeconds, setRemainingSeconds] = useState(0)
    const [showCompleteDialog, setShowCompleteDialog] = useState(false)
    const [showDeleteDialog, setShowDeleteDialog] = useState(false)
    const timerRef = useRef<NodeJS.Timeout | null>(null)

    const config = BLOCK_TYPE_CONFIG[block.type]
    const progress = calculateBlockProgress(block)
    const hasSegments = block.segments.length > 0
    const currentSegment = hasSegments ? block.segments[currentSegmentIndex] : null

    // Initialize timer from stored state
    useEffect(() => {
        if (block.timerState) {
            setIsRunning(block.timerState.isRunning)
            setCurrentSegmentIndex(block.timerState.segmentIndex || 0)
            setRemainingSeconds(block.timerState.remainingSeconds)
        } else if (hasSegments) {
            setRemainingSeconds(block.segments[0].durationMinutes * 60)
        } else {
            setRemainingSeconds(block.durationMinutes * 60)
        }
    }, [block.timerState, block.segments, block.durationMinutes, hasSegments])

    // Timer logic
    useEffect(() => {
        if (isRunning && remainingSeconds > 0) {
            timerRef.current = setInterval(() => {
                setRemainingSeconds(prev => {
                    if (prev <= 1) {
                        // Time's up!
                        setIsRunning(false)
                        return 0
                    }
                    return prev - 1
                })
            }, 1000)
        }

        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current)
            }
        }
    }, [isRunning, remainingSeconds])

    // Save timer state when it changes
    useEffect(() => {
        const saveTimerState = async () => {
            if (block.status === 'IN_PROGRESS') {
                try {
                    await fetch(`/api/blocks/${block.id}/timer`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            segmentIndex: currentSegmentIndex,
                            remainingSeconds,
                            isRunning,
                            startedAt: isRunning ? new Date().toISOString() : null,
                        }),
                    })
                } catch (error) {
                    console.error('Error saving timer state:', error)
                }
            }
        }

        // Debounce the save
        const timeout = setTimeout(saveTimerState, 1000)
        return () => clearTimeout(timeout)
    }, [block.id, block.status, currentSegmentIndex, remainingSeconds, isRunning])

    // Start block/segment
    const handleStart = async () => {
        setIsRunning(true)
        if (block.status === 'NOT_STARTED') {
            await updateBlockStatus('IN_PROGRESS')
            if (hasSegments && block.segments[currentSegmentIndex].status === 'NOT_STARTED') {
                await updateSegmentStatus(block.segments[currentSegmentIndex].id, 'IN_PROGRESS')
            }
        }
    }

    // Pause timer
    const handlePause = () => {
        setIsRunning(false)
    }

    // Complete current segment and move to next
    const handleCompleteSegment = async () => {
        if (!currentSegment) return

        await updateSegmentStatus(currentSegment.id, 'DONE')

        if (currentSegmentIndex < block.segments.length - 1) {
            // Move to next segment
            const nextIndex = currentSegmentIndex + 1
            setCurrentSegmentIndex(nextIndex)
            setRemainingSeconds(block.segments[nextIndex].durationMinutes * 60)
            await updateSegmentStatus(block.segments[nextIndex].id, 'IN_PROGRESS')
        } else {
            // All segments done
            setIsRunning(false)
            setShowCompleteDialog(true)
        }
    }

    // Skip segment
    const handleSkipSegment = async () => {
        if (currentSegmentIndex < block.segments.length - 1) {
            const nextIndex = currentSegmentIndex + 1
            setCurrentSegmentIndex(nextIndex)
            setRemainingSeconds(block.segments[nextIndex].durationMinutes * 60)
        }
    }

    // Complete entire block
    const handleComplete = async () => {
        setIsRunning(false)
        await updateBlockStatus('DONE')
        setShowCompleteDialog(false)
    }

    // Skip block
    const handleSkip = async () => {
        setIsRunning(false)
        await updateBlockStatus('SKIPPED')
    }

    // Update block status
    const updateBlockStatus = async (status: BlockStatus) => {
        try {
            const response = await fetch(`/api/blocks/${block.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status }),
            })
            if (response.ok) {
                const updated = await response.json()
                onUpdate(updated)
            }
        } catch (error) {
            console.error('Error updating block status:', error)
        }
    }

    // Update segment status
    const updateSegmentStatus = async (segmentId: string, status: 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE') => {
        try {
            await fetch(`/api/segments/${segmentId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status }),
            })
        } catch (error) {
            console.error('Error updating segment status:', error)
        }
    }

    // Toggle subtask
    const handleToggleSubtask = async (subtask: Subtask) => {
        try {
            const response = await fetch(`/api/subtasks/${subtask.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isDone: !subtask.isDone }),
            })
            if (response.ok) {
                const updatedSubtask = await response.json()
                const updatedSubtasks = block.subtasks.map(s =>
                    s.id === subtask.id ? updatedSubtask : s
                )
                onUpdate({ ...block, subtasks: updatedSubtasks })
            }
        } catch (error) {
            console.error('Error toggling subtask:', error)
        }
    }

    // Delete block
    const handleDelete = async () => {
        try {
            await fetch(`/api/blocks/${block.id}`, { method: 'DELETE' })
            onDelete(block.id)
        } catch (error) {
            console.error('Error deleting block:', error)
        }
        setShowDeleteDialog(false)
    }

    const isDone = block.status === 'DONE'
    const isSkipped = block.status === 'SKIPPED'
    const isInProgress = block.status === 'IN_PROGRESS'

    return (
        <>
            <Card
                className={cn(
                    "transition-all duration-200 border-l-4",
                    isDone && "opacity-70 bg-emerald-50/50 dark:bg-emerald-950/20",
                    isSkipped && "opacity-50 bg-gray-50/50 dark:bg-gray-900/20",
                    isInProgress && "shadow-md ring-1 ring-amber-200 dark:ring-amber-800"
                )}
                style={{ borderLeftColor: block.color }}
            >
                <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                            <GripVertical className="h-5 w-5 text-muted-foreground cursor-grab" />
                            <div>
                                <CardTitle className="flex items-center gap-2 text-lg">
                                    <span>{config.emoji}</span>
                                    <span className={cn(isDone && "line-through")}>{block.title}</span>
                                </CardTitle>
                                <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                                    {block.startTime && <span>{block.startTime}</span>}
                                    <span>•</span>
                                    <span>{formatDuration(block.durationMinutes)}</span>
                                    <span>•</span>
                                    <Badge variant="outline" className={cn("text-xs", getStatusColor(block.status))}>
                                        {getStatusLabel(block.status)}
                                    </Badge>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-1">
                            {/* Timer display */}
                            {isInProgress && (
                                <div className="flex items-center gap-2 mr-4 px-3 py-1 bg-amber-100 dark:bg-amber-900/30 rounded-full">
                                    <Clock className="h-4 w-4 text-amber-600" />
                                    <span className="font-mono text-lg font-bold text-amber-700 dark:text-amber-400">
                                        {formatTimer(remainingSeconds)}
                                    </span>
                                </div>
                            )}

                            {/* Control buttons */}
                            {!isDone && !isSkipped && (
                                <>
                                    {isRunning ? (
                                        <Button size="sm" variant="outline" onClick={handlePause}>
                                            <Pause className="h-4 w-4" />
                                        </Button>
                                    ) : (
                                        <Button size="sm" onClick={handleStart}>
                                            <Play className="h-4 w-4" />
                                        </Button>
                                    )}

                                    {isInProgress && hasSegments && (
                                        <Button size="sm" variant="outline" onClick={handleCompleteSegment}>
                                            <Check className="h-4 w-4 mr-1" />
                                            Сегмент
                                        </Button>
                                    )}

                                    <Button size="sm" variant="outline" onClick={() => setShowCompleteDialog(true)}>
                                        <Check className="h-4 w-4" />
                                    </Button>

                                    <Button size="sm" variant="ghost" onClick={handleSkip}>
                                        <SkipForward className="h-4 w-4" />
                                    </Button>
                                </>
                            )}

                            <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setShowDeleteDialog(true)}
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    {/* Progress bar */}
                    <div className="mt-3">
                        <Progress value={progress} className="h-2" />
                    </div>
                </CardHeader>

                {/* Expandable content */}
                {(hasSegments || block.subtasks.length > 0 || block.notes) && (
                    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
                        <CollapsibleTrigger asChild>
                            <Button variant="ghost" className="w-full flex items-center justify-center gap-1 h-8">
                                {isExpanded ? (
                                    <>Свернуть <ChevronUp className="h-4 w-4" /></>
                                ) : (
                                    <>Подробнее <ChevronDown className="h-4 w-4" /></>
                                )}
                            </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                            <CardContent className="pt-0 space-y-4">
                                {/* Segments */}
                                {hasSegments && (
                                    <div>
                                        <h4 className="text-sm font-medium mb-2">Сегменты</h4>
                                        <div className="space-y-2">
                                            {block.segments.map((segment, idx) => (
                                                <div
                                                    key={segment.id}
                                                    className={cn(
                                                        "flex items-center justify-between p-2 rounded-lg border",
                                                        segment.status === 'DONE' && "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200",
                                                        segment.status === 'IN_PROGRESS' && "bg-amber-50 dark:bg-amber-950/30 border-amber-200",
                                                        idx === currentSegmentIndex && isInProgress && "ring-2 ring-amber-300"
                                                    )}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <div
                                                            className={cn(
                                                                "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold",
                                                                segment.status === 'DONE' ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"
                                                            )}
                                                        >
                                                            {segment.status === 'DONE' ? <Check className="h-3 w-3" /> : idx + 1}
                                                        </div>
                                                        <span className={cn(segment.status === 'DONE' && "line-through text-muted-foreground")}>
                                                            {segment.title}
                                                        </span>
                                                    </div>
                                                    <span className="text-sm text-muted-foreground">
                                                        {formatDuration(segment.durationMinutes)}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Subtasks */}
                                {block.subtasks.length > 0 && (
                                    <div>
                                        <h4 className="text-sm font-medium mb-2">Чек-лист</h4>
                                        <div className="space-y-2">
                                            {block.subtasks.map((subtask) => (
                                                <div
                                                    key={subtask.id}
                                                    className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50"
                                                >
                                                    <Checkbox
                                                        checked={subtask.isDone}
                                                        onCheckedChange={() => handleToggleSubtask(subtask)}
                                                    />
                                                    <span className={cn(subtask.isDone && "line-through text-muted-foreground")}>
                                                        {subtask.title}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Notes */}
                                {block.notes && (
                                    <div>
                                        <h4 className="text-sm font-medium mb-2">Заметки</h4>
                                        <p className="text-sm text-muted-foreground">{block.notes}</p>
                                    </div>
                                )}
                            </CardContent>
                        </CollapsibleContent>
                    </Collapsible>
                )}
            </Card>

            {/* Complete Dialog */}
            <AlertDialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Завершить блок?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Вы уверены, что хотите отметить &quot;{block.title}&quot; как завершённый?
                            {hasSegments && block.segments.some(s => s.status !== 'DONE') && (
                                <span className="block mt-2 text-amber-600">
                                    <AlertCircle className="h-4 w-4 inline mr-1" />
                                    Не все сегменты завершены.
                                </span>
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Отмена</AlertDialogCancel>
                        <AlertDialogAction onClick={handleComplete}>Завершить</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Delete Dialog */}
            <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Удалить блок?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Это действие нельзя отменить. Блок &quot;{block.title}&quot; будет удалён навсегда.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Отмена</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
                            Удалить
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
