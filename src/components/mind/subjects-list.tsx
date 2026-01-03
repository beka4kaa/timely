"use client"

import React, { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
    Plus,
    Loader2,
    Trash2,
    Edit2,
    BookOpen,
    Clock,
    X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Subject } from '@/types/mind'
import { AddSubjectDialog } from './add-subject-dialog'
import { toast } from 'sonner'
import { AddTopicDialog } from './add-topic-dialog'
import { FastTopicAddDialog } from './fast-topic-add'

interface SubjectsListProps {
    className?: string
}

export function SubjectsList({ className }: SubjectsListProps) {
    const [subjects, setSubjects] = useState<Subject[]>([])
    const [loading, setLoading] = useState(true)
    const [showAddSubject, setShowAddSubject] = useState(false)
    const [showAddTopic, setShowAddTopic] = useState(false)
    const [selectedSubjectId, setSelectedSubjectId] = useState<string>('')

    const fetchSubjects = useCallback(async () => {
        setLoading(true)
        try {
            const response = await fetch('/api/subjects')
            if (response.ok) {
                const data = await response.json()
                setSubjects(data)
            }
        } catch (error) {
            console.error('Error fetching subjects:', error)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchSubjects()
    }, [fetchSubjects])

    const handleDeleteSubject = async (id: string) => {
        if (!confirm('Удалить предмет и все его темы?')) return

        try {
            await fetch(`/api/subjects/${id}`, { method: 'DELETE' })
            setSubjects(subjects.filter(s => s.id !== id))
        } catch (error) {
            console.error('Error deleting subject:', error)
        }
    }

    const handleDeleteTopic = async (topicId: string, subjectId: string) => {
        if (!confirm('Удалить эту тему?')) return

        try {
            const res = await fetch(`/api/topics/${topicId}`, { method: 'DELETE' })
            if (res.ok || res.status === 204) {
                setSubjects(subjects.map(s => {
                    if (s.id === subjectId) {
                        return {
                            ...s,
                            topics: s.topics?.filter(t => t.id !== topicId)
                        }
                    }
                    return s
                }))
                toast.success('Тема удалена')
            } else {
                const data = await res.json().catch(() => ({}))
                toast.error(data.error || 'Не удалось удалить тему')
            }
        } catch (error) {
            console.error('Error deleting topic:', error)
            toast.error('Ошибка при удалении темы')
        }
    }

    const handleAddTopic = (subjectId: string) => {
        setSelectedSubjectId(subjectId)
        setShowAddTopic(true)
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className={cn("space-y-6", className)}>
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Предметы</h2>
                <Button onClick={() => setShowAddSubject(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Добавить предмет
                </Button>
            </div>

            {subjects.length === 0 ? (
                <Card className="border-dashed">
                    <CardContent className="p-8 text-center text-muted-foreground">
                        <BookOpen className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p>Нет предметов. Добавьте первый предмет для начала.</p>
                    </CardContent>
                </Card>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {subjects.map((subject) => (
                        <Card
                            key={subject.id}
                            className="relative overflow-hidden"
                            style={{ borderLeftColor: subject.color, borderLeftWidth: 4 }}
                        >
                            <CardHeader className="pb-2">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-2xl">{subject.emoji}</span>
                                        <CardTitle className="text-lg">{subject.name}</CardTitle>
                                    </div>
                                    <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-8 w-8 text-destructive"
                                        onClick={() => handleDeleteSubject(subject.id)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                                    <div className="flex items-center gap-1">
                                        <BookOpen className="h-4 w-4" />
                                        <span>{subject.topics?.length || 0} тем</span>
                                    </div>
                                </div>

                                {subject.topics && subject.topics.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mb-4">
                                        {subject.topics.map((topic) => (
                                            <Badge
                                                key={topic.id}
                                                variant="secondary"
                                                className="text-xs pr-1 group relative transition-all hover:pr-6 cursor-default"
                                            >
                                                {topic.name}
                                                <button
                                                    className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        handleDeleteTopic(topic.id, subject.id)
                                                    }}
                                                >
                                                    <X className="h-3 w-3" />
                                                </button>
                                            </Badge>
                                        ))}
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="w-full"
                                        onClick={() => handleAddTopic(subject.id)}
                                    >
                                        <Plus className="h-4 w-4 mr-2" />
                                        Тема
                                    </Button>
                                    <FastTopicAddDialog
                                        subjectId={subject.id}
                                        subjectName={subject.name}
                                        onTopicsAdded={fetchSubjects}
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Dialogs */}
            <AddSubjectDialog
                open={showAddSubject}
                onOpenChange={setShowAddSubject}
                onSubjectAdded={(subject) => {
                    setSubjects([...subjects, subject])
                }}
            />

            <AddTopicDialog
                open={showAddTopic}
                onOpenChange={setShowAddTopic}
                subjects={subjects}
                defaultSubjectId={selectedSubjectId}
                onTopicAdded={(topic) => {
                    fetchSubjects() // Refresh to show new topic
                }}
            />
        </div>
    )
}
