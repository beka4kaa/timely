"use client"

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
    RotateCcw,
    Brain,
    ThumbsUp,
    Zap,
    Loader2,
    Plus,
    Sparkles,
    Trash2,
} from 'lucide-react'
import { formatInterval, getMasteryColor, isDue, isOverdue } from '@/lib/srs'
import { toast } from 'sonner'

interface Subtopic {
    id: string
    title: string
    orderIndex: number
    srsState?: {
        mastery: number
        intervalDays: number | null
        lastReviewedAt: string | null
        nextReviewAt: string | null
    } | null
}

interface SubtopicsTableProps {
    topicId: string
    subtopics: Subtopic[]
    onSubtopicsChange: () => void
    className?: string
}

export function SubtopicsTable({
    topicId,
    subtopics,
    onSubtopicsChange,
    className
}: SubtopicsTableProps) {
    const [reviewingId, setReviewingId] = useState<string | null>(null)

    const handleReview = async (subtopicId: string, rating: 'AGAIN' | 'HARD' | 'GOOD' | 'EASY') => {
        setReviewingId(subtopicId)
        try {
            const res = await fetch(`/api/subtopics/${subtopicId}/review`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rating })
            })

            if (res.ok) {
                toast.success(`Reviewed as ${rating}`)
                onSubtopicsChange()
            } else {
                toast.error('Failed to review')
            }
        } catch (error) {
            console.error(error)
            toast.error('Error reviewing subtopic')
        } finally {
            setReviewingId(null)
        }
    }

    const handleDelete = async (subtopicId: string) => {
        if (!confirm('Delete this subtopic?')) return

        try {
            await fetch(`/api/subtopics/${subtopicId}`, { method: 'DELETE' })
            toast.success('Subtopic deleted')
            onSubtopicsChange()
        } catch (error) {
            console.error(error)
            toast.error('Error deleting')
        }
    }

    const formatDate = (date: string | null) => {
        if (!date) return '—'
        return new Date(date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
    }

    if (subtopics.length === 0) {
        return (
            <div className={cn("text-center py-4 text-muted-foreground text-sm", className)}>
                No subtopics yet
            </div>
        )
    }

    return (
        <div className={cn("space-y-1", className)}>
            {subtopics.map((st) => {
                const srs = st.srsState
                const isDueNow = isDue(srs?.nextReviewAt)
                const isOverdueNow = isOverdue(srs?.nextReviewAt)
                const isLoading = reviewingId === st.id

                return (
                    <div
                        key={st.id}
                        className={cn(
                            "flex items-center gap-2 px-3 py-2 rounded-md border text-sm",
                            "hover:bg-muted/30 transition-colors",
                            isDueNow && "bg-amber-500/10 border-amber-500/30",
                            isOverdueNow && "bg-red-500/10 border-red-500/30"
                        )}
                    >
                        {/* Title */}
                        <span className="flex-1 truncate">{st.title}</span>

                        {/* Mastery */}
                        <span className={cn("w-10 text-right font-mono text-xs", getMasteryColor(srs?.mastery ?? 0))}>
                            {srs?.mastery ?? 0}%
                        </span>

                        {/* Interval */}
                        <span className="w-8 text-center text-xs text-muted-foreground">
                            {formatInterval(srs?.intervalDays)}
                        </span>

                        {/* Next review */}
                        <span className="w-16 text-xs text-muted-foreground">
                            {formatDate(srs?.nextReviewAt ?? null)}
                        </span>

                        {/* Due badge */}
                        {isDueNow && (
                            <Badge
                                variant="outline"
                                className={cn(
                                    "text-[10px] h-5 px-1.5",
                                    isOverdueNow ? "text-red-400 border-red-400/50" : "text-amber-400 border-amber-400/50"
                                )}
                            >
                                ⏰ Due
                            </Badge>
                        )}

                        {/* Rating buttons */}
                        <div className="flex items-center gap-0.5">
                            {isLoading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7 text-red-400 hover:text-red-500 hover:bg-red-500/10"
                                        onClick={() => handleReview(st.id, 'AGAIN')}
                                        title="Again"
                                    >
                                        <RotateCcw className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7 text-orange-400 hover:text-orange-500 hover:bg-orange-500/10"
                                        onClick={() => handleReview(st.id, 'HARD')}
                                        title="Hard"
                                    >
                                        <Brain className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7 text-emerald-400 hover:text-emerald-500 hover:bg-emerald-500/10"
                                        onClick={() => handleReview(st.id, 'GOOD')}
                                        title="Good"
                                    >
                                        <ThumbsUp className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-7 w-7 text-blue-400 hover:text-blue-500 hover:bg-blue-500/10"
                                        onClick={() => handleReview(st.id, 'EASY')}
                                        title="Easy"
                                    >
                                        <Zap className="h-3.5 w-3.5" />
                                    </Button>
                                </>
                            )}
                            <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                onClick={() => handleDelete(st.id)}
                                title="Delete"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    </div>
                )
            })}
        </div>
    )
}
