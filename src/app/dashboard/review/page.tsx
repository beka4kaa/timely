"use client"

import React, { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
    Play,
    ThumbsUp,
    ThumbsDown,
    Zap,
    Clock,
    AlertTriangle,
    Calendar,
    Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
    Topic,
    isDueToday,
    isOverdue,
    formatInterval,
} from '@/types/mind'

export default function ReviewPage() {
    const [topics, setTopics] = useState<Topic[]>([])
    const [loading, setLoading] = useState(true)
    const [reviewingTopic, setReviewingTopic] = useState<Topic | null>(null)

    const fetchTopics = useCallback(async () => {
        setLoading(true)
        try {
            const response = await fetch('/api/topics?filter=overall')
            if (response.ok) {
                const data = await response.json()
                setTopics(data)
            }
        } catch (error) {
            console.error('Error fetching topics:', error)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchTopics()
    }, [fetchTopics])

    // Categorize topics
    const dueToday = topics.filter(t => isDueToday(t.nextReviewAt) && !isOverdue(t.nextReviewAt))
    const overdue = topics.filter(t => isOverdue(t.nextReviewAt))
    const upcoming = topics.filter(t => {
        if (!t.nextReviewAt) return false
        const next = new Date(t.nextReviewAt)
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const weekFromNow = new Date(today)
        weekFromNow.setDate(weekFromNow.getDate() + 7)
        return next > today && next <= weekFromNow
    })

    // Handle review
    const handleReview = async (topicId: string, rating: 'AGAIN' | 'HARD' | 'GOOD' | 'EASY') => {
        try {
            const response = await fetch(`/api/topics/${topicId}/review`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rating }),
            })

            if (response.ok) {
                setReviewingTopic(null)
                fetchTopics()
            }
        } catch (error) {
            console.error('Error reviewing topic:', error)
        }
    }

    const renderTopicCard = (topic: Topic) => (
        <Card key={topic.id} className="hover:bg-muted/30 transition-colors">
            <CardContent className="p-4 flex items-center justify-between">
                <div>
                    <div className="flex items-center gap-2">
                        <span>{topic.subject?.emoji}</span>
                        <span className="font-medium">{topic.name}</span>
                        <Badge variant="secondary" className="text-xs">
                            {topic.subject?.name}
                        </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                        Интервал: {formatInterval(topic.intervalDays)}
                    </p>
                </div>
                <Button
                    size="sm"
                    onClick={() => setReviewingTopic(topic)}
                >
                    <Play className="h-4 w-4 mr-2" />
                    Повторить
                </Button>
            </CardContent>
        </Card>
    )

    if (loading) {
        return (
            <div className="container max-w-4xl mx-auto py-6 px-4">
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            </div>
        )
    }

    // Review mode
    if (reviewingTopic) {
        return (
            <div className="container max-w-2xl mx-auto py-6 px-4">
                <Card className="bg-gradient-to-br from-gray-900 to-gray-800 border-gray-700">
                    <CardHeader className="text-center">
                        <div className="text-4xl mb-4">{reviewingTopic.subject?.emoji}</div>
                        <CardTitle className="text-2xl text-white">{reviewingTopic.name}</CardTitle>
                        <p className="text-muted-foreground">{reviewingTopic.subject?.name}</p>
                    </CardHeader>
                    <CardContent className="p-8">
                        <p className="text-center text-muted-foreground mb-8">
                            Как хорошо вы помните эту тему?
                        </p>
                        <div className="grid grid-cols-2 gap-4">
                            <Button
                                size="lg"
                                variant="outline"
                                className="h-20 flex-col gap-2 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                onClick={() => handleReview(reviewingTopic.id, 'AGAIN')}
                            >
                                <span className="text-lg">😵</span>
                                <span>Не помню</span>
                            </Button>
                            <Button
                                size="lg"
                                variant="outline"
                                className="h-20 flex-col gap-2 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                                onClick={() => handleReview(reviewingTopic.id, 'HARD')}
                            >
                                <span className="text-lg">😓</span>
                                <span>Трудно</span>
                            </Button>
                            <Button
                                size="lg"
                                variant="outline"
                                className="h-20 flex-col gap-2 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                                onClick={() => handleReview(reviewingTopic.id, 'GOOD')}
                            >
                                <span className="text-lg">😊</span>
                                <span>Хорошо</span>
                            </Button>
                            <Button
                                size="lg"
                                variant="outline"
                                className="h-20 flex-col gap-2 text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
                                onClick={() => handleReview(reviewingTopic.id, 'EASY')}
                            >
                                <span className="text-lg">🤩</span>
                                <span>Легко</span>
                            </Button>
                        </div>
                        <Button
                            variant="ghost"
                            className="w-full mt-4"
                            onClick={() => setReviewingTopic(null)}
                        >
                            Отмена
                        </Button>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="container max-w-4xl mx-auto py-6 px-4">
            <div className="mb-6">
                <h1 className="text-2xl font-bold">Повторение</h1>
                <p className="text-muted-foreground">
                    Темы, которые нужно повторить
                </p>
            </div>

            <div className="space-y-8">
                {/* Overdue */}
                {overdue.length > 0 && (
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <AlertTriangle className="h-5 w-5 text-red-500" />
                            <h2 className="text-lg font-semibold text-red-400">Просрочено</h2>
                            <Badge variant="destructive">{overdue.length}</Badge>
                        </div>
                        <div className="space-y-2">
                            {overdue.map(renderTopicCard)}
                        </div>
                    </div>
                )}

                {/* Due Today */}
                {dueToday.length > 0 && (
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <Zap className="h-5 w-5 text-amber-500" />
                            <h2 className="text-lg font-semibold text-amber-400">На сегодня</h2>
                            <Badge className="bg-amber-500/20 text-amber-400">{dueToday.length}</Badge>
                        </div>
                        <div className="space-y-2">
                            {dueToday.map(renderTopicCard)}
                        </div>
                    </div>
                )}

                {/* Upcoming */}
                {upcoming.length > 0 && (
                    <div>
                        <div className="flex items-center gap-2 mb-3">
                            <Calendar className="h-5 w-5 text-blue-500" />
                            <h2 className="text-lg font-semibold text-blue-400">На этой неделе</h2>
                            <Badge className="bg-blue-500/20 text-blue-400">{upcoming.length}</Badge>
                        </div>
                        <div className="space-y-2">
                            {upcoming.map(renderTopicCard)}
                        </div>
                    </div>
                )}

                {/* Empty state */}
                {overdue.length === 0 && dueToday.length === 0 && upcoming.length === 0 && (
                    <Card className="border-dashed">
                        <CardContent className="p-8 text-center text-muted-foreground">
                            <Clock className="h-12 w-12 mx-auto mb-2 opacity-50" />
                            <p>Нет тем для повторения</p>
                            <p className="text-sm mt-1">Добавьте темы и начните их изучать</p>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    )
}
