"use client"

import React, { useState, useEffect, useCallback, useMemo } from 'react'
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
    GripVertical,
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

// Drag and Drop
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
    DragStartEvent,
    DragOverlay,
    defaultDropAnimationSideEffects,
} from '@dnd-kit/core'
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface WeaknessesTableProps {
    className?: string
    hideAddButton?: boolean
}

type FilterType = 'overall' | 'picked' | 'urgent' | 'archived'

// Sortable Row Component
interface SortableRowProps {
    topic: Topic
    isExpanded: boolean
    subtopics: any[]
    isSelected: boolean
    onToggleSelect: (id: string | number) => void
    onToggleExpand: (id: string) => void
    onTogglePicked: (topic: Topic) => void
    onReview: (id: string, rating: 'GOOD' | 'AGAIN') => void
    onToggleArchived: (topic: Topic) => void
    onUpdateStatus: (id: string, status: string) => void
    onOpenAddSubtopic: (id: string, name: string) => void
    onOpenAISubtopics: (id: string, name: string) => void
    onRefreshSubtopics: (id: string) => void
    isDragging?: boolean
}

function SortableRow({
    topic,
    isExpanded,
    subtopics,
    isSelected,
    onToggleSelect,
    onToggleExpand,
    onTogglePicked,
    onReview,
    onToggleArchived,
    onUpdateStatus,
    onOpenAddSubtopic,
    onOpenAISubtopics,
    onRefreshSubtopics,
    isDragging = false,
}: SortableRowProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging: isSortableDragging,
    } = useSortable({ id: String(topic.id) })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isSortableDragging ? 0.5 : 1,
        zIndex: isSortableDragging ? 1000 : undefined,
    }

    return (
        <React.Fragment>
            <tr
                ref={setNodeRef}
                style={style}
                className={cn(
                    "border-t hover:bg-muted/30 transition-all",
                    isDueToday(topic.nextReviewAt) && "bg-amber-500/10",
                    isSelected && "bg-primary/5",
                    isSortableDragging && "bg-primary/10 shadow-lg"
                )}
            >
                <td className="p-2 md:p-3 w-[30px]">
                    <div
                        {...attributes}
                        {...listeners}
                        className="cursor-grab active:cursor-grabbing touch-none"
                    >
                        <GripVertical className="h-4 w-4 text-muted-foreground" />
                    </div>
                </td>
                <td className="p-2 md:p-3">
                    <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => onToggleSelect(topic.id)}
                    />
                </td>
                <td className="p-2 md:p-3">
                    <div className="flex items-center gap-1 md:gap-2">
                        <button
                            onClick={() => onToggleExpand(topic.id)}
                            className="hover:bg-muted p-0.5 rounded flex-shrink-0"
                        >
                            {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                        </button>
                        <button onClick={() => onTogglePicked(topic)} className="flex-shrink-0">
                            {topic.picked ? (
                                <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                            ) : (
                                <StarOff className="h-4 w-4 text-muted-foreground" />
                            )}
                        </button>
                        <span className={cn("truncate max-w-[150px] md:max-w-none", topic.archived && "line-through text-muted-foreground")}>
                            {topic.name}
                        </span>
                        {isDueToday(topic.nextReviewAt) && (
                            <Badge variant="destructive" className="text-xs flex-shrink-0">
                                Сегодня
                            </Badge>
                        )}
                    </div>
                </td>
                <td className="p-2 md:p-3">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button className="cursor-pointer hover:opacity-80 transition-opacity">
                                <Badge className={cn("text-xs whitespace-nowrap", getTopicStatusColor(topic.status as any))}>
                                    {getTopicStatusLabel(topic.status as any)}
                                </Badge>
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                            <DropdownMenuItem
                                onClick={() => onUpdateStatus(topic.id, 'NOT_STARTED')}
                                className={topic.status === 'NOT_STARTED' ? 'bg-muted' : ''}
                            >
                                <span className="w-2 h-2 rounded-full bg-gray-400 mr-2" />
                                Не начато
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={() => onUpdateStatus(topic.id, 'MEDIUM')}
                                className={topic.status === 'MEDIUM' ? 'bg-muted' : ''}
                            >
                                <span className="w-2 h-2 rounded-full bg-amber-500 mr-2" />
                                Знаю немного
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={() => onUpdateStatus(topic.id, 'SUCCESS')}
                                className={topic.status === 'SUCCESS' ? 'bg-muted' : ''}
                            >
                                <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2" />
                                Знаю хорошо
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={() => onUpdateStatus(topic.id, 'MASTERED')}
                                className={topic.status === 'MASTERED' ? 'bg-muted' : ''}
                            >
                                <span className="w-2 h-2 rounded-full bg-blue-500 mr-2" />
                                Мастерство
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </td>
                <td className="p-2 md:p-3 text-muted-foreground whitespace-nowrap hidden sm:table-cell">
                    {formatInterval(topic.intervalDays)}
                </td>
                <td className="p-2 md:p-3 text-muted-foreground whitespace-nowrap hidden md:table-cell">
                    {formatDaysPast(topic.lastRevisedAt)}
                </td>
                <td className="p-2 md:p-3 text-muted-foreground whitespace-nowrap hidden lg:table-cell">
                    {topic.nextReviewAt
                        ? new Date(topic.nextReviewAt).toLocaleDateString('ru-RU')
                        : '—'
                    }
                </td>
                <td className="p-2 md:p-3">
                    <div className="flex items-center justify-end gap-0.5 md:gap-1">
                        <Button
                            size="sm"
                            variant="ghost"
                            className="text-emerald-500 hover:text-emerald-600 hover:bg-emerald-500/10 h-8 w-8 p-0"
                            onClick={() => onReview(topic.id, 'GOOD')}
                        >
                            <ThumbsUp className="h-4 w-4" />
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-500 hover:text-red-600 hover:bg-red-500/10 h-8 w-8 p-0"
                            onClick={() => onReview(topic.id, 'AGAIN')}
                        >
                            <ThumbsDown className="h-4 w-4" />
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 hidden sm:flex"
                            onClick={() => onToggleArchived(topic)}
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
                    <td colSpan={8} className="p-0 bg-muted/20">
                        <div className="p-4 space-y-3">
                            <div className="flex items-center justify-between">
                                <h4 className="text-sm font-medium">Subtopics</h4>
                                <div className="flex gap-2">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => onOpenAddSubtopic(topic.id, topic.name)}
                                    >
                                        <Plus className="h-3.5 w-3.5 mr-1" />
                                        Add
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="text-purple-500"
                                        onClick={() => onOpenAISubtopics(topic.id, topic.name)}
                                    >
                                        <Sparkles className="h-3.5 w-3.5 mr-1" />
                                        AI Generate
                                    </Button>
                                </div>
                            </div>
                            <SubtopicsTable
                                topicId={topic.id}
                                subtopics={subtopics}
                                onSubtopicsChange={() => onRefreshSubtopics(topic.id)}
                            />
                        </div>
                    </td>
                </tr>
            )}
        </React.Fragment>
    )
}

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
    const [activeId, setActiveId] = useState<string | null>(null)

    // DnD sensors
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { distance: 8 },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    )

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
    // topic.subject is the ID (string), subjectName/subjectEmoji/subjectColor are separate fields
    const groupedTopics = topics.reduce((acc, topic) => {
        // Get subject ID as string
        const subjectId = typeof topic.subject === 'string' 
            ? topic.subject 
            : (topic.subject?.id || 'no-subject')
        const subjectName = topic.subjectName || 'Без предмета'
        
        if (!acc[subjectId]) {
            acc[subjectId] = {
                subject: topic.subjectName ? {
                    id: subjectId,
                    name: subjectName,
                    emoji: topic.subjectEmoji || '📚',
                    color: topic.subjectColor || '#6b7280',
                } as Subject : undefined,
                topics: [],
            }
        }
        acc[subjectId].topics.push(topic)
        return acc
    }, {} as Record<string, { subject: Subject | undefined; topics: Topic[] }>)

    // Sort topics within each group by orderIndex to match Program page order
    Object.values(groupedTopics).forEach(group => {
        group.topics.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
    })

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
        console.log('🗑️ Bulk delete called, selectedTopics:', selectedTopics)
        console.log('🗑️ Selected IDs:', Array.from(selectedTopics))
        
        if (selectedTopics.size === 0) {
            toast.error("Выберите темы для удаления")
            return
        }
        
        // Убрал confirm для теста
        console.log('🗑️ Starting delete...')

        try {
            const idsToDelete = Array.from(selectedTopics)
            console.log('🗑️ IDs to delete:', idsToDelete)
            
            const results = await Promise.all(
                idsToDelete.map(async id => {
                    console.log('🗑️ Sending DELETE request for:', id)
                    const res = await fetch(`/api/topics/${id}`, { method: 'DELETE' })
                    console.log('🗑️ Delete response:', id, res.status, res.ok)
                    return { id, ok: res.ok || res.status === 204 }
                })
            )
            
            console.log('🗑️ All results:', results)
            
            const deleted = results.filter(r => r.ok).map(r => r.id)
            const failed = results.filter(r => !r.ok).length

            setTopics(prev => prev.filter(t => !deleted.includes(String(t.id))))
            setSelectedTopics(new Set())
            
            if (failed > 0) {
                toast.error(`${failed} тем(ы) не удалось удалить`)
            }
            if (deleted.length > 0) {
                toast.success(`${deleted.length} тем(ы) удалено`)
            }
        } catch (error) {
            console.error('🗑️ Error:', error)
            toast.error("Ошибка при удалении")
        }
    }

    const toggleSelectAll = (subjectTopics: Topic[]) => {
        console.log('📋 toggleSelectAll called, topics:', subjectTopics.map(t => ({ id: t.id, name: t.name })))
        const allSelected = subjectTopics.every(t => selectedTopics.has(String(t.id)))
        const newSelected = new Set(selectedTopics)

        if (allSelected) {
            subjectTopics.forEach(t => newSelected.delete(String(t.id)))
        } else {
            subjectTopics.forEach(t => newSelected.add(String(t.id)))
        }
        console.log('📋 New selected:', Array.from(newSelected))
        setSelectedTopics(newSelected)
    }

    const toggleSelect = (id: string | number) => {
        const strId = String(id)
        console.log('☑️ toggleSelect called, id:', id, 'strId:', strId)
        const newSelected = new Set(selectedTopics)
        if (newSelected.has(strId)) {
            newSelected.delete(strId)
        } else {
            newSelected.add(strId)
        }
        console.log('☑️ New selected:', Array.from(newSelected))
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

    // Drag and Drop handlers
    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(String(event.active.id))
    }

    const handleDragEnd = async (event: DragEndEvent, subjectId: string, subjectTopics: Topic[]) => {
        const { active, over } = event
        setActiveId(null)

        if (!over || active.id === over.id) return

        const oldIndex = subjectTopics.findIndex(t => String(t.id) === active.id)
        const newIndex = subjectTopics.findIndex(t => String(t.id) === over.id)

        if (oldIndex === -1 || newIndex === -1) return

        // Check if we're moving multiple selected items
        const movingIds = selectedTopics.has(String(active.id)) && selectedTopics.size > 1
            ? Array.from(selectedTopics)
            : [String(active.id)]

        // Reorder locally first for instant feedback
        let newSubjectTopics = [...subjectTopics]
        
        if (movingIds.length === 1) {
            newSubjectTopics = arrayMove(subjectTopics, oldIndex, newIndex)
        } else {
            // Move multiple selected items
            const selectedItems = subjectTopics.filter(t => movingIds.includes(String(t.id)))
            const otherItems = subjectTopics.filter(t => !movingIds.includes(String(t.id)))
            
            // Find where to insert (at the over position among non-selected items)
            const overIndexInOthers = otherItems.findIndex(t => String(t.id) === String(over.id))
            if (overIndexInOthers !== -1) {
                otherItems.splice(overIndexInOthers, 0, ...selectedItems)
                newSubjectTopics = otherItems
            } else {
                newSubjectTopics = [...otherItems, ...selectedItems]
            }
        }

        // Update local state
        setTopics(prev => {
            const otherTopics = prev.filter(t => {
                const tSubjectId = typeof t.subject === 'string' ? t.subject : (t.subject?.id || 'no-subject')
                return tSubjectId !== subjectId
            })
            return [...otherTopics, ...newSubjectTopics]
        })

        // Save to backend
        try {
            const newIds = newSubjectTopics.map(t => t.id)
            await fetch('/api/topics/reorder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: newIds, subjectId }),
            })
        } catch (error) {
            console.error('Error reordering topics:', error)
            toast.error('Ошибка сохранения порядка')
            fetchData() // Reload on error
        }
    }

    const filters: { key: FilterType; label: string }[] = [
        { key: 'overall', label: 'Все' },
        { key: 'picked', label: 'Избранное' },
        { key: 'urgent', label: 'Срочные' },
        { key: 'archived', label: 'Архив' },
    ]

    return (
        <div className={cn("space-y-4 md:space-y-6", className)}>
            {/* Filters */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
                    <Filter className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex gap-1">
                        {filters.map((f) => (
                            <Button
                                key={f.key}
                                variant={filter === f.key ? "secondary" : "ghost"}
                                size="sm"
                                onClick={() => setFilter(f.key)}
                                className="whitespace-nowrap"
                            >
                                {f.label}
                            </Button>
                        ))}
                    </div>
                </div>
                <div className="flex gap-2 w-full sm:w-auto">
                    {selectedTopics.size > 0 && (
                        <Button variant="destructive" size="sm" onClick={handleBulkDelete} className="flex-1 sm:flex-none">
                            <Trash2 className="h-4 w-4 mr-1 sm:mr-2" />
                            <span className="hidden sm:inline">Удалить</span> ({selectedTopics.size})
                        </Button>
                    )}
                    {!hideAddButton && (
                        <Button onClick={() => setShowAddDialog(true)} size="sm" className="flex-1 sm:flex-none">
                            <Plus className="h-4 w-4 mr-1 sm:mr-2" />
                            <span className="hidden sm:inline">Новая тема</span>
                            <span className="sm:hidden">Добавить</span>
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

            {!loading && Object.entries(groupedTopics).map(([subjectId, { subject, topics: subjectTopics }]) => (
                <div key={subjectId} className="space-y-2">
                    <div className="flex items-center gap-2 px-2">
                        <span className="text-lg">{subject?.emoji || '📚'}</span>
                        <h3 className="font-semibold truncate">{subject?.name || 'Без предмета'}</h3>
                        <Badge variant="secondary" className="ml-auto flex-shrink-0">
                            {subjectTopics.length}
                        </Badge>
                    </div>

                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragStart={handleDragStart}
                        onDragEnd={(event) => handleDragEnd(event, subjectId, subjectTopics)}
                    >
                        <div className="rounded-lg border overflow-x-auto">
                            <table className="w-full text-sm min-w-[700px]">
                                <thead className="bg-muted/50">
                                    <tr>
                                        <th className="w-[40px] p-2 md:p-3"></th>
                                        <th className="w-[30px] p-2 md:p-3">
                                            <Checkbox
                                                checked={subjectTopics.every(t => selectedTopics.has(String(t.id)))}
                                                onCheckedChange={() => toggleSelectAll(subjectTopics)}
                                            />
                                        </th>
                                        <th className="text-left p-2 md:p-3 font-medium">Тема</th>
                                        <th className="text-left p-2 md:p-3 font-medium whitespace-nowrap">Статус</th>
                                        <th className="text-left p-2 md:p-3 font-medium whitespace-nowrap hidden sm:table-cell">Интервал</th>
                                        <th className="text-left p-2 md:p-3 font-medium whitespace-nowrap hidden md:table-cell">Прошло</th>
                                        <th className="text-left p-2 md:p-3 font-medium whitespace-nowrap hidden lg:table-cell">След. повтор</th>
                                        <th className="text-right p-2 md:p-3 font-medium">Действия</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <SortableContext
                                        items={subjectTopics.map(t => String(t.id))}
                                        strategy={verticalListSortingStrategy}
                                    >
                                        {subjectTopics.map((topic) => (
                                            <SortableRow
                                                key={topic.id}
                                                topic={topic}
                                                isExpanded={expandedTopics.has(topic.id)}
                                                subtopics={topicSubtopics[topic.id] || []}
                                                isSelected={selectedTopics.has(String(topic.id))}
                                                onToggleSelect={toggleSelect}
                                                onToggleExpand={toggleExpanded}
                                                onTogglePicked={togglePicked}
                                                onReview={handleReview}
                                                onToggleArchived={toggleArchived}
                                                onUpdateStatus={updateStatus}
                                                onOpenAddSubtopic={handleOpenAddSubtopic}
                                                onOpenAISubtopics={handleOpenAISubtopics}
                                                onRefreshSubtopics={refreshSubtopics}
                                            />
                                        ))}
                                    </SortableContext>
                                </tbody>
                            </table>
                        </div>
                    </DndContext>
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
