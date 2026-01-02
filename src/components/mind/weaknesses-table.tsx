"use client"

import React, { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
    ThumbsUp,
    ThumbsDown,
    Star,
    StarOff,
    Archive,
    ArchiveRestore,
    Trash2,
    Plus,
    Loader2,
    Filter,
    ChevronRight,
    ChevronDown,
    Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
    Topic,
    Subject,
    getTopicStatusColor,
    getTopicStatusLabel,
    formatInterval,
    formatDaysPast,
    isDueToday,
} from '@/types/mind'
import { AddTopicDialog } from './add-topic-dialog'
import { SubtopicsTable } from './subtopics-table'
import { AddSubtopicDialog } from './add-subtopic-dialog'
import { AISubtopicsDialog } from './ai-subtopics-dialog'

import { Checkbox } from "@/components/ui/checkbox"
import { toast } from "sonner"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface WeaknessesTableProps {
    className?: string
    hideAddButton?: boolean
}

type FilterType = 'overall' | 'picked' | 'urgent' | 'archived'

export function WeaknessesTable({ className, hideAddButton = false }: WeaknessesTableProps) {
    const [topics, setTopics] = useState<Topic[]>([])
    const [subjects, setSubjects] = useState<Subject[]>([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState<FilterType>('overall')
    const [showAddDialog, setShowAddDialog] = useState(false)
    const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set())
    const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set())
    const [topicSubtopics, setTopicSubtopics] = useState<Record<string, any[]>>({})
    const [showAddSubtopic, setShowAddSubtopic] = useState(false)
    const [showAISubtopics, setShowAISubtopics] = useState(false)
    const [selectedTopicForSubtopic, setSelectedTopicForSubtopic] = useState<{ id: string, name: string } | null>(null)

    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const [topicsRes, subjectsRes] = await Promise.all([
                fetch(`/api/topics?filter=${filter}`),
                fetch('/api/subjects'),
            ])

            if (topicsRes.ok) {
                const data = await topicsRes.json()
                setTopics(data)
            }
            if (subjectsRes.ok) {
                const data = await subjectsRes.json()
                setSubjects(data)
            }
        } catch (error) {
            console.error('Error fetching data:', error)
        } finally {
            setLoading(false)
        }
    }, [filter])

    useEffect(() => {
        fetchData()
    }, [fetchData])

    // Group topics by subject
    const groupedTopics = topics.reduce((acc, topic) => {
        const subjectName = topic.subject?.name || 'Без предмета'
        if (!acc[subjectName]) {
            acc[subjectName] = {
                subject: topic.subject,
                topics: [],
            }
        }
        acc[subjectName].topics.push(topic)
        return acc
    }, {} as Record<string, { subject: Subject | undefined; topics: Topic[] }>)

    // Handle review (Good/Bad)
    const handleReview = async (topicId: string, rating: 'GOOD' | 'AGAIN') => {
        try {
            const response = await fetch(`/api/topics/${topicId}/review`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rating }),
            })

            if (response.ok) {
                const updatedTopic = await response.json()
                setTopics(topics.map(t => t.id === topicId ? updatedTopic : t))
            }
        } catch (error) {
            console.error('Error reviewing topic:', error)
        }
    }

    // Toggle picked
    const togglePicked = async (topic: Topic) => {
        try {
            const response = await fetch(`/api/topics/${topic.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ picked: !topic.picked }),
            })

            if (response.ok) {
                const updatedTopic = await response.json()
                setTopics(topics.map(t => t.id === topic.id ? updatedTopic : t))
            }
        } catch (error) {
            console.error('Error toggling picked:', error)
        }
    }

    // Toggle archived
    const toggleArchived = async (topic: Topic) => {
        try {
            const response = await fetch(`/api/topics/${topic.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ archived: !topic.archived }),
            })

            if (response.ok) {
                fetchData() // Refresh to apply filter
            }
        } catch (error) {
            console.error('Error toggling archived:', error)
        }
    }

    // Update topic status (knowledge level)
    const updateStatus = async (topicId: string, status: string) => {
        try {
            const response = await fetch(`/api/topics/${topicId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status }),
            })

            if (response.ok) {
                const updatedTopic = await response.json()
                setTopics(topics.map(t => t.id === topicId ? updatedTopic : t))
                toast.success("Статус обновлён")
            }
        } catch (error) {
            console.error('Error updating status:', error)
            toast.error("Ошибка обновления")
        }
    }

    // Bulk Delete
    const handleBulkDelete = async () => {
        if (!confirm(`Удалить выбранные ${selectedTopics.size} тем(ы)?`)) return

        try {
            const promises = Array.from(selectedTopics).map(id =>
                fetch(`/api/topics/${id}`, { method: 'DELETE' })
            )
            await Promise.all(promises)

            setTopics(prev => prev.filter(t => !selectedTopics.has(t.id)))
            setSelectedTopics(new Set())
            toast.success("Темы удалены")
        } catch (error) {
            console.error(error)
            toast.error("Ошибка при удалении")
        }
    }

    const toggleSelectAll = (subjectTopics: Topic[]) => {
        const allSelected = subjectTopics.every(t => selectedTopics.has(t.id))
        const newSelected = new Set(selectedTopics)

        if (allSelected) {
            subjectTopics.forEach(t => newSelected.delete(t.id))
        } else {
            subjectTopics.forEach(t => newSelected.add(t.id))
        }
        setSelectedTopics(newSelected)
    }

    const toggleSelect = (id: string) => {
        const newSelected = new Set(selectedTopics)
        if (newSelected.has(id)) {
            newSelected.delete(id)
        } else {
            newSelected.add(id)
        }
        setSelectedTopics(newSelected)
    }

    const toggleExpanded = async (topicId: string) => {
        const newExpanded = new Set(expandedTopics)
        if (newExpanded.has(topicId)) {
            newExpanded.delete(topicId)
        } else {
            newExpanded.add(topicId)
            // Fetch subtopics if not already loaded
            if (!topicSubtopics[topicId]) {
                try {
                    const res = await fetch(`/api/subtopics?topicId=${topicId}`)
                    if (res.ok) {
                        const data = await res.json()
                        setTopicSubtopics(prev => ({ ...prev, [topicId]: data }))
                    }
                } catch (error) {
                    console.error('Error fetching subtopics:', error)
                }
            }
        }
        setExpandedTopics(newExpanded)
    }

    const handleOpenAddSubtopic = (topicId: string, topicName: string) => {
        setSelectedTopicForSubtopic({ id: topicId, name: topicName })
        setShowAddSubtopic(true)
    }

    const handleOpenAISubtopics = (topicId: string, topicName: string) => {
        setSelectedTopicForSubtopic({ id: topicId, name: topicName })
        setShowAISubtopics(true)
    }

    const refreshSubtopics = async (topicId: string) => {
        try {
            const res = await fetch(`/api/subtopics?topicId=${topicId}`)
            if (res.ok) {
                const data = await res.json()
                setTopicSubtopics(prev => ({ ...prev, [topicId]: data }))
            }
        } catch (error) {
            console.error('Error refreshing subtopics:', error)
        }
    }

    const filters: { key: FilterType; label: string }[] = [
        { key: 'overall', label: 'Все' },
        { key: 'picked', label: 'Избранное' },
        { key: 'urgent', label: 'Срочные' },
        { key: 'archived', label: 'Архив' },
    ]

    return (
        <div className={cn("space-y-6", className)}>
            {/* Filters */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-muted-foreground" />
                    <div className="flex gap-1">
                        {filters.map((f) => (
                            <Button
                                key={f.key}
                                variant={filter === f.key ? "secondary" : "ghost"}
                                size="sm"
                                onClick={() => setFilter(f.key)}
                            >
                                {f.label}
                            </Button>
                        ))}
                    </div>
                </div>
                <div className="flex gap-2">
                    {selectedTopics.size > 0 && (
                        <Button variant="destructive" size="sm" onClick={handleBulkDelete}>
                            <Trash2 className="h-4 w-4 mr-2" />
                            Удалить ({selectedTopics.size})
                        </Button>
                    )}
                    {!hideAddButton && (
                        <Button onClick={() => setShowAddDialog(true)}>
                            <Plus className="h-4 w-4 mr-2" />
                            Новая тема
                        </Button>
                    )}
                </div>
            </div>

            {/* Loading */}
            {loading && (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            )}

            {/* Topics grouped by subject */}
            {!loading && Object.keys(groupedTopics).length === 0 && (
                <Card className="border-dashed">
                    <CardContent className="p-8 text-center text-muted-foreground">
                        <p>Нет тем для отображения</p>
                    </CardContent>
                </Card>
            )}

            {!loading && Object.entries(groupedTopics).map(([subjectName, { subject, topics: subjectTopics }]) => (
                <div key={subjectName} className="space-y-2">
                    <div className="flex items-center gap-2 px-2">
                        <span className="text-lg">{subject?.emoji || '📚'}</span>
                        <h3 className="font-semibold">{subjectName}</h3>
                        <Badge variant="secondary" className="ml-auto">
                            {subjectTopics.length}
                        </Badge>
                    </div>

                    <div className="rounded-lg border overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className="w-[30px] p-3">
                                        <Checkbox
                                            checked={subjectTopics.every(t => selectedTopics.has(t.id))}
                                            onCheckedChange={() => toggleSelectAll(subjectTopics)}
                                        />
                                    </th>
                                    <th className="text-left p-3 font-medium">Тема</th>
                                    <th className="text-left p-3 font-medium">Статус</th>
                                    <th className="text-left p-3 font-medium">Интервал</th>
                                    <th className="text-left p-3 font-medium">Прошло</th>
                                    <th className="text-left p-3 font-medium">След. повтор</th>
                                    <th className="text-right p-3 font-medium">Действия</th>
                                </tr>
                            </thead>
                            <tbody>
                                {subjectTopics.map((topic) => {
                                    const isExpanded = expandedTopics.has(topic.id)
                                    const subtopics = topicSubtopics[topic.id] || []

                                    return (
                                        <React.Fragment key={topic.id}>
                                            <tr
                                                className={cn(
                                                    "border-t hover:bg-muted/30 transition-colors",
                                                    isDueToday(topic.nextReviewAt) && "bg-amber-500/10",
                                                    selectedTopics.has(topic.id) && "bg-primary/5"
                                                )}
                                            >
                                                <td className="p-3">
                                                    <Checkbox
                                                        checked={selectedTopics.has(topic.id)}
                                                        onCheckedChange={() => toggleSelect(topic.id)}
                                                    />
                                                </td>
                                                <td className="p-3">
                                                    <div className="flex items-center gap-2">
                                                        <button
                                                            onClick={() => toggleExpanded(topic.id)}
                                                            className="hover:bg-muted p-0.5 rounded"
                                                        >
                                                            {isExpanded ? (
                                                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                                            ) : (
                                                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                                            )}
                                                        </button>
                                                        <button onClick={() => togglePicked(topic)}>
                                                            {topic.picked ? (
                                                                <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                                                            ) : (
                                                                <StarOff className="h-4 w-4 text-muted-foreground" />
                                                            )}
                                                        </button>
                                                        <span className={cn(topic.archived && "line-through text-muted-foreground")}>
                                                            {topic.name}
                                                        </span>
                                                        {isDueToday(topic.nextReviewAt) && (
                                                            <Badge variant="destructive" className="text-xs">
                                                                Сегодня
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-3">
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <button className="cursor-pointer hover:opacity-80 transition-opacity">
                                                                <Badge className={cn("text-xs", getTopicStatusColor(topic.status as any))}>
                                                                    {getTopicStatusLabel(topic.status as any)}
                                                                </Badge>
                                                            </button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="start">
                                                            <DropdownMenuItem
                                                                onClick={() => updateStatus(topic.id, 'NOT_STARTED')}
                                                                className={topic.status === 'NOT_STARTED' ? 'bg-muted' : ''}
                                                            >
                                                                <span className="w-2 h-2 rounded-full bg-gray-400 mr-2" />
                                                                Не начато
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem
                                                                onClick={() => updateStatus(topic.id, 'MEDIUM')}
                                                                className={topic.status === 'MEDIUM' ? 'bg-muted' : ''}
                                                            >
                                                                <span className="w-2 h-2 rounded-full bg-amber-500 mr-2" />
                                                                Знаю немного
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem
                                                                onClick={() => updateStatus(topic.id, 'SUCCESS')}
                                                                className={topic.status === 'SUCCESS' ? 'bg-muted' : ''}
                                                            >
                                                                <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2" />
                                                                Знаю хорошо
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem
                                                                onClick={() => updateStatus(topic.id, 'MASTERED')}
                                                                className={topic.status === 'MASTERED' ? 'bg-muted' : ''}
                                                            >
                                                                <span className="w-2 h-2 rounded-full bg-blue-500 mr-2" />
                                                                Мастерство
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </td>
                                                <td className="p-3 text-muted-foreground">
                                                    {formatInterval(topic.intervalDays)}
                                                </td>
                                                <td className="p-3 text-muted-foreground">
                                                    {formatDaysPast(topic.lastRevisedAt)}
                                                </td>
                                                <td className="p-3 text-muted-foreground">
                                                    {topic.nextReviewAt
                                                        ? new Date(topic.nextReviewAt).toLocaleDateString('ru-RU')
                                                        : '—'
                                                    }
                                                </td>
                                                <td className="p-3">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            className="text-emerald-500 hover:text-emerald-600 hover:bg-emerald-500/10"
                                                            onClick={() => handleReview(topic.id, 'GOOD')}
                                                        >
                                                            <ThumbsUp className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                                                            onClick={() => handleReview(topic.id, 'AGAIN')}
                                                        >
                                                            <ThumbsDown className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            onClick={() => toggleArchived(topic)}
                                                        >
                                                            {topic.archived ? (
                                                                <ArchiveRestore className="h-4 w-4" />
                                                            ) : (
                                                                <Archive className="h-4 w-4" />
                                                            )}
                                                        </Button>
                                                    </div>
                                                </td>
                                            </tr>

                                            {/* Expanded Subtopics Row */}
                                            {isExpanded && (
                                                <tr>
                                                    <td colSpan={7} className="p-0 bg-muted/20">
                                                        <div className="p-4 space-y-3">
                                                            <div className="flex items-center justify-between">
                                                                <h4 className="text-sm font-medium">Subtopics</h4>
                                                                <div className="flex gap-2">
                                                                    <Button
                                                                        size="sm"
                                                                        variant="outline"
                                                                        onClick={() => handleOpenAddSubtopic(topic.id, topic.name)}
                                                                    >
                                                                        <Plus className="h-3.5 w-3.5 mr-1" />
                                                                        Add
                                                                    </Button>
                                                                    <Button
                                                                        size="sm"
                                                                        variant="outline"
                                                                        className="text-purple-500"
                                                                        onClick={() => handleOpenAISubtopics(topic.id, topic.name)}
                                                                    >
                                                                        <Sparkles className="h-3.5 w-3.5 mr-1" />
                                                                        AI Generate
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                            <SubtopicsTable
                                                                topicId={topic.id}
                                                                subtopics={subtopics}
                                                                onSubtopicsChange={() => refreshSubtopics(topic.id)}
                                                            />
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            ))}

            {/* Add Topic Dialog */}
            <AddTopicDialog
                open={showAddDialog}
                onOpenChange={setShowAddDialog}
                subjects={subjects}
                onTopicAdded={(topic) => {
                    setTopics([...topics, topic])
                }}
            />

            {/* Add Subtopic Dialog */}
            {selectedTopicForSubtopic && (
                <AddSubtopicDialog
                    topicId={selectedTopicForSubtopic.id}
                    topicName={selectedTopicForSubtopic.name}
                    open={showAddSubtopic}
                    onOpenChange={setShowAddSubtopic}
                    onSubtopicAdded={() => refreshSubtopics(selectedTopicForSubtopic.id)}
                />
            )}

            {/* AI Subtopics Dialog */}
            {selectedTopicForSubtopic && (
                <AISubtopicsDialog
                    topicId={selectedTopicForSubtopic.id}
                    topicName={selectedTopicForSubtopic.name}
                    open={showAISubtopics}
                    onOpenChange={setShowAISubtopics}
                    onSubtopicsAdded={() => refreshSubtopics(selectedTopicForSubtopic.id)}
                />
            )}
        </div>
    )
}
