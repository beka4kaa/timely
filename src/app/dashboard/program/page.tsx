"use client"

import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/ui/date-picker'
import {
    Sparkles,
    Loader2,
    Calendar,
    Clock,
    BookOpen,
    Target,
    AlertCircle,
    CheckCircle,
    ChevronLeft,
    ChevronRight,
    FileText,
    RefreshCw,
    AlertTriangle,
    GripVertical,
    ChevronDown,
    ChevronUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// Drag and Drop
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent,
} from '@dnd-kit/core'
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// Subject with topics for program creation
interface SubjectWithTopics {
    id: string
    name: string
    emoji: string
    color: string
    topics: Array<{
        id: string
        name: string
        orderIndex: number
        status: string // NOT_STARTED, MEDIUM, SUCCESS, MASTERED
    }>
}

// Deadline configuration per subject
interface SubjectDeadline {
    subjectId: string
    milestoneTopicId: string | null // Which topic to finish by deadline (null = all)
    deadline: string | null // ISO date string
}


interface TopicPlan {
    id: string
    topicId: string
    plannedWeek: number
    estimatedHours: number
    priority: number
    reinforceWeek1: number | null
    reinforceWeek2: number | null
    status: string
    deadline: string | null
    isFlexible: boolean
    manuallyMoved: boolean
    topic: {
        id: string
        name: string
        subject: {
            id: string
            name: string
            emoji: string
            color: string
        }
    }
}

interface WeekPlan {
    id: string
    weekNumber: number
    startDate: string
    endDate: string
    subjectHours: string
    focus: string | null
    notes: string | null
}

interface ScheduledTest {
    id: string
    scheduledDate: string
    scheduledTime: string | null
    title: string
    description: string | null
    type: string
    status: string
    subject: {
        id: string
        name: string
        emoji: string
    }
}

interface LearningProgram {
    id: string
    name: string
    startDate: string
    endDate: string | null
    totalWeeks: number
    hoursPerWeek: number
    description: string | null
    strategy: string | null
    generatedAt: string
    weekPlans: WeekPlan[]
    topicPlans: TopicPlan[]
    scheduledTests: ScheduledTest[]
}

import { ProgramChatDialog } from '@/components/mind/program-chat-dialog'

// Sortable Topic Item for drag-and-drop
interface SortableTopicItemProps {
    topic: { id: string; name: string; status: string; orderIndex: number }
}

function SortableTopicItem({ topic }: SortableTopicItemProps) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: topic.id })

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 1000 : undefined,
    }

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                "flex items-center gap-2 p-2 rounded text-sm",
                topic.status === 'MASTERED' || topic.status === 'SUCCESS'
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-muted/50"
            )}
        >
            <div
                {...attributes}
                {...listeners}
                className="cursor-grab active:cursor-grabbing touch-none"
            >
                <GripVertical className="h-3 w-3 text-muted-foreground" />
            </div>
            {(topic.status === 'MASTERED' || topic.status === 'SUCCESS') && (
                <CheckCircle className="h-3 w-3 text-emerald-500" />
            )}
            <span className="flex-1">{topic.name}</span>
            {topic.status === 'MEDIUM' && (
                <Badge variant="secondary" className="text-xs">В процессе</Badge>
            )}
        </div>
    )
}

export default function ProgramPage() {
    const [loading, setLoading] = useState(true)
    const [generating, setGenerating] = useState(false)
    const [program, setProgram] = useState<LearningProgram | null>(null)
    const [error, setError] = useState<string | null>(null)

    // Generation settings
    const [totalWeeks, setTotalWeeks] = useState(12)
    const [hoursPerWeek, setHoursPerWeek] = useState(20)
    const [selectedWeek, setSelectedWeek] = useState(1)
    const [rebalancing, setRebalancing] = useState(false)

    // Subjects and deadlines for program creation
    const [subjects, setSubjects] = useState<SubjectWithTopics[]>([])
    const [subjectDeadlines, setSubjectDeadlines] = useState<SubjectDeadline[]>([])
    const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set())

    // DnD sensors
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: { distance: 8 },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    )

    useEffect(() => {
        loadProgram()
        fetchSubjects()
    }, [])

    const fetchSubjects = async () => {
        try {
            const res = await fetch('/api/subjects')
            if (res.ok) {
                const data = await res.json()
                setSubjects(data.map((s: SubjectWithTopics) => ({
                    ...s,
                    topics: s.topics?.sort((a, b) => a.orderIndex - b.orderIndex) || []
                })))
                // Initialize empty deadlines for each subject
                setSubjectDeadlines(data.map((s: SubjectWithTopics) => ({
                    subjectId: s.id,
                    milestoneTopicId: null,
                    deadline: null
                })))
            }
        } catch (err) {
            console.error('Error fetching subjects:', err)
        }
    }

    const toggleSubjectExpanded = (subjectId: string) => {
        setExpandedSubjects(prev => {
            const next = new Set(prev)
            if (next.has(subjectId)) {
                next.delete(subjectId)
            } else {
                next.add(subjectId)
            }
            return next
        })
    }

    const updateSubjectDeadline = (subjectId: string, updates: Partial<SubjectDeadline>) => {
        setSubjectDeadlines(prev => prev.map(sd =>
            sd.subjectId === subjectId ? { ...sd, ...updates } : sd
        ))
    }

    // Handle topic drag and drop reorder
    const handleTopicDragEnd = async (event: DragEndEvent, subjectId: string) => {
        const { active, over } = event
        if (!over || active.id === over.id) return

        const subject = subjects.find(s => s.id === subjectId)
        if (!subject) return

        const oldIndex = subject.topics.findIndex(t => t.id === active.id)
        const newIndex = subject.topics.findIndex(t => t.id === over.id)

        if (oldIndex === -1 || newIndex === -1) return

        const newTopics = arrayMove(subject.topics, oldIndex, newIndex).map((t, idx) => ({
            ...t,
            orderIndex: idx
        }))

        // Update local state
        setSubjects(prev => prev.map(s =>
            s.id === subjectId ? { ...s, topics: newTopics } : s
        ))

        // Save to API
        try {
            await fetch('/api/topics/reorder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subjectId, ids: newTopics.map(t => t.id) })
            })
        } catch (error) {
            console.error('Error reordering topics:', error)
            toast.error('Ошибка сохранения порядка')
        }
    }

    const loadProgram = async () => {
        setLoading(true)
        try {
            const res = await fetch('/api/learning-program')
            if (res.ok) {
                const data = await res.json()
                // Check if program exists (not just { notFound: true })
                if (data && !data.notFound && data.id) {
                    setProgram(data)
                } else {
                    setProgram(null)
                }
            }
        } catch (err) {
            console.error('Error loading program:', err)
        } finally {
            setLoading(false)
        }
    }

    const rebalanceProgram = async () => {
        if (!program) return
        setRebalancing(true)
        try {
            const res = await fetch('/api/learning-program/rebalance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    programId: program.id,
                    maxHoursPerWeek: program.hoursPerWeek,
                    applyChanges: true
                })
            })
            const data = await res.json()
            if (data.success) {
                toast.success(`Программа обновлена: ${data.changesCount} изменений`)
                loadProgram()
            } else if (data.conflicts?.length > 0) {
                toast.warning(`${data.conflicts.length} конфликтов дедлайнов. Проверьте программу.`)
                loadProgram()
            }
        } catch (err) {
            toast.error('Ошибка ребалансировки')
        } finally {
            setRebalancing(false)
        }
    }

    const updateTopicPlan = async (topicPlanId: string, updates: {
        plannedWeek?: number
        deadline?: string | null
        priority?: number
    }) => {
        try {
            const res = await fetch(`/api/topic-plans/${topicPlanId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            })
            if (res.ok) {
                toast.success('Обновлено')
                loadProgram()
            }
        } catch (err) {
            toast.error('Ошибка обновления')
        }
    }

    // Calculate workload estimation based on deadlines and topics
    const calculateWorkloadEstimates = (): Array<{
        totalTopics: number
        daysAvailable: number
        topicsPerDay: number
        deadline: Date
        isIntense: boolean
        isExtreme: boolean
        subjectsAffected: string[]
    }> => {
        const today = new Date()
        today.setHours(0, 0, 0, 0)

        // Build array of subjects with their topic counts and deadlines
        const subjectData: Array<{
            name: string
            topicCount: number
            deadline: Date
            daysUntil: number
        }> = []

        subjects.forEach(subject => {
            const deadline = subjectDeadlines.find(sd => sd.subjectId === subject.id)
            if (deadline?.deadline) {
                const deadlineDate = new Date(deadline.deadline)
                const daysUntil = Math.max(1, Math.ceil((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)))

                // Count topics up to milestone
                let topicCount = 0
                if (deadline.milestoneTopicId) {
                    const milestoneIndex = subject.topics.findIndex(t => t.id === deadline.milestoneTopicId)
                    topicCount = milestoneIndex >= 0 ? milestoneIndex + 1 : subject.topics.length
                } else {
                    topicCount = subject.topics.length
                }

                subjectData.push({
                    name: subject.name,
                    topicCount,
                    deadline: deadlineDate,
                    daysUntil
                })
            }
        })

        if (subjectData.length === 0) {
            return []
        }

        // Group subjects by deadline (± 1 day tolerance)
        const groups: Map<number, typeof subjectData> = new Map()
        subjectData.forEach(s => {
            // Round to nearest day group
            const dayKey = s.daysUntil
            const existingGroup = Array.from(groups.entries()).find(([key]) => Math.abs(key - dayKey) <= 1)
            if (existingGroup) {
                existingGroup[1].push(s)
            } else {
                groups.set(dayKey, [s])
            }
        })

        // Convert groups to estimates, sorted by urgency
        const estimates = Array.from(groups.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([days, subjects]) => {
                const totalTopics = subjects.reduce((sum, s) => sum + s.topicCount, 0)
                const topicsPerDay = Math.ceil(totalTopics / days)
                return {
                    totalTopics,
                    daysAvailable: days,
                    topicsPerDay,
                    deadline: subjects[0].deadline,
                    isIntense: topicsPerDay > 5,
                    isExtreme: topicsPerDay > 10,
                    subjectsAffected: subjects.map(s => s.name)
                }
            })

        return estimates
    }

    const workloadEstimates = calculateWorkloadEstimates()

    const generateProgram = async () => {
        // Validate at least one deadline is set
        const deadlinesSet = subjectDeadlines.filter(sd => sd.deadline)
        if (deadlinesSet.length === 0) {
            setError('Укажите хотя бы один дедлайн для создания программы')
            return
        }

        setGenerating(true)
        setError(null)
        try {
            const res = await fetch('/api/ai/generate-program', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    totalWeeks,
                    hoursPerWeek,
                    name: 'Моя программа обучения',
                    subjectDeadlines: deadlinesSet,
                }),
            })

            if (!res.ok) {
                const data = await res.json()
                throw new Error(data.error || 'Failed to generate')
            }

            // Program created successfully - now load the full program data
            toast.success('Программа создана! Загружаю...')

            // Wait a moment for DB to sync, then load program
            await new Promise(resolve => setTimeout(resolve, 500))
            await loadProgram()

            toast.success('Программа готова!')
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Ошибка генерации')
        } finally {
            setGenerating(false)
        }
    }

    const getCurrentWeek = () => {
        if (!program) return 1
        const start = new Date(program.startDate)
        const now = new Date()
        const diff = Math.floor((now.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000))
        return Math.max(1, Math.min(diff + 1, program.totalWeeks))
    }

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('ru-RU', {
            day: 'numeric',
            month: 'short',
        })
    }

    if (loading) {
        return (
            <div className="container max-w-6xl mx-auto py-6 px-4">
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            </div>
        )
    }

    // No program - show generation UI
    if (!program) {
        return (
            <div className="container max-w-3xl mx-auto py-6 px-4">
                <div className="mb-6">
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        📚 Программа обучения
                    </h1>
                    <p className="text-muted-foreground">
                        AI создаст персонализированный план на основе ваших предметов
                    </p>
                </div>

                <Card className="border-border">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Sparkles className="h-5 w-5" />
                            Создать программу
                        </CardTitle>
                        <CardDescription>
                            AI проанализирует ваши предметы, темы и прогресс для создания плана
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label>Часов в неделю (максимум)</Label>
                            <Input
                                type="number"
                                min={5}
                                max={60}
                                value={hoursPerWeek}
                                onChange={e => setHoursPerWeek(parseInt(e.target.value) || 20)}
                            />
                            <p className="text-xs text-muted-foreground">
                                Количество недель рассчитается автоматически на основе дедлайнов
                            </p>
                        </div>

                        {/* Subject deadlines configuration */}
                        {subjects.length > 0 && (
                            <div className="space-y-3">
                                <Label className="text-base">Дедлайны по предметам</Label>
                                <p className="text-xs text-muted-foreground mb-3">
                                    Укажите к какой теме и к какой дате нужно выучить материал
                                </p>

                                {subjects.map(subject => {
                                    const isExpanded = expandedSubjects.has(subject.id)
                                    const deadline = subjectDeadlines.find(sd => sd.subjectId === subject.id)

                                    return (
                                        <div
                                            key={subject.id}
                                            className="border rounded-lg p-3"
                                            style={{ borderLeftColor: subject.color, borderLeftWidth: 3 }}
                                        >
                                            {/* Subject header */}
                                            <div
                                                className="flex items-center justify-between cursor-pointer"
                                                onClick={() => toggleSubjectExpanded(subject.id)}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span>{subject.emoji}</span>
                                                    <span className="font-medium">{subject.name}</span>
                                                    <Badge variant="secondary" className="text-xs">
                                                        {subject.topics.length} тем
                                                    </Badge>
                                                </div>
                                                {isExpanded ? (
                                                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                                ) : (
                                                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                                )}
                                            </div>

                                            {/* Expanded content */}
                                            {isExpanded && (
                                                <div className="mt-3 space-y-3">
                                                    {/* Topic list with drag-and-drop reorder */}
                                                    <DndContext
                                                        sensors={sensors}
                                                        collisionDetection={closestCenter}
                                                        onDragEnd={(event) => handleTopicDragEnd(event, subject.id)}
                                                    >
                                                        <SortableContext
                                                            items={subject.topics.map(t => t.id)}
                                                            strategy={verticalListSortingStrategy}
                                                        >
                                                            <div className="space-y-1">
                                                                {subject.topics.map((topic) => (
                                                                    <SortableTopicItem key={topic.id} topic={topic} />
                                                                ))}
                                                            </div>
                                                        </SortableContext>
                                                    </DndContext>

                                                    {/* Deadline configuration */}
                                                    <div className="grid gap-3 md:grid-cols-2 pt-2 border-t">
                                                        <div className="space-y-1">
                                                            <Label className="text-xs">Выучить до темы</Label>
                                                            <select
                                                                value={deadline?.milestoneTopicId || ''}
                                                                onChange={(e) => updateSubjectDeadline(subject.id, {
                                                                    milestoneTopicId: e.target.value || null
                                                                })}
                                                                className="w-full text-sm bg-background border rounded px-2 py-1.5"
                                                            >
                                                                <option value="">Все темы</option>
                                                                {subject.topics.map(topic => (
                                                                    <option key={topic.id} value={topic.id}>
                                                                        {topic.name}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        </div>
                                                        <div className="space-y-1">
                                                            <Label className="text-xs">К дате</Label>
                                                            <DatePicker
                                                                date={deadline?.deadline ? new Date(deadline.deadline) : undefined}
                                                                onDateChange={(date) => updateSubjectDeadline(subject.id, {
                                                                    deadline: date ? date.toISOString() : null
                                                                })}
                                                                placeholder="Выберите дату"
                                                                className="w-full text-sm"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        )}

                        {/* Workload estimation - show ALL deadline groups */}
                        {workloadEstimates.length > 0 && (
                            <div className="space-y-3">
                                {workloadEstimates.map((estimate, idx) => (
                                    <div key={idx} className={cn(
                                        "p-4 rounded-lg border",
                                        estimate.isExtreme
                                            ? "bg-red-500/10 border-red-500/30"
                                            : estimate.isIntense
                                                ? "bg-yellow-500/10 border-yellow-500/30"
                                                : "bg-emerald-500/10 border-emerald-500/30"
                                    )}>
                                        <div className="flex items-start gap-3">
                                            {estimate.isExtreme ? (
                                                <AlertTriangle className="h-5 w-5 text-red-400 mt-0.5" />
                                            ) : estimate.isIntense ? (
                                                <AlertCircle className="h-5 w-5 text-yellow-400 mt-0.5" />
                                            ) : (
                                                <CheckCircle className="h-5 w-5 text-emerald-400 mt-0.5" />
                                            )}
                                            <div className="flex-1">
                                                <div className="font-medium mb-1">
                                                    {estimate.isExtreme
                                                        ? "⚠️ Невыполнимо — только быстрый обзор"
                                                        : estimate.isIntense
                                                            ? "⏰ Интенсивный режим"
                                                            : "✅ Нагрузка в норме"
                                                    }
                                                </div>
                                                <div className="text-sm text-muted-foreground space-y-1">
                                                    <p>
                                                        <strong>{estimate.subjectsAffected.join(', ')}</strong>
                                                    </p>
                                                    <p>
                                                        <strong>{estimate.totalTopics}</strong> тем за <strong>{estimate.daysAvailable}</strong> дней =
                                                        <strong className={cn(
                                                            "ml-1",
                                                            estimate.isExtreme && "text-red-400",
                                                            estimate.isIntense && !estimate.isExtreme && "text-yellow-400"
                                                        )}>
                                                            {estimate.topicsPerDay} тем/день
                                                        </strong>
                                                    </p>
                                                    <p className="text-xs">
                                                        Дедлайн: {estimate.deadline.toLocaleDateString('ru-RU', {
                                                            day: 'numeric',
                                                            month: 'long',
                                                            year: 'numeric'
                                                        })}
                                                    </p>
                                                    {estimate.isExtreme && (
                                                        <p className="text-xs text-red-400 mt-2">
                                                            Будет создан быстрый обзор тем (20-30 мин каждая)
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {error && (
                            <div className="p-3 rounded-lg bg-red-500/10 text-red-400 flex items-center gap-2">
                                <AlertCircle className="h-4 w-4" />
                                {error}
                            </div>
                        )}

                        <Button
                            size="lg"
                            className="w-full"
                            onClick={generateProgram}
                            disabled={generating || !subjectDeadlines.some(sd => sd.deadline)}
                        >
                            {generating ? (
                                <>
                                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                                    Генерация...
                                </>
                            ) : (
                                <>
                                    <Sparkles className="h-5 w-5 mr-2" />
                                    Создать программу
                                </>
                            )}
                        </Button>

                        {!subjectDeadlines.some(sd => sd.deadline) && (
                            <p className="text-xs text-muted-foreground text-center">
                                Укажите дедлайн хотя бы для одного предмета
                            </p>
                        )}
                    </CardContent>
                </Card>
            </div>
        )
    }

    // Show program
    const currentWeek = getCurrentWeek()
    const currentWeekPlan = program.weekPlans?.find(w => w.weekNumber === selectedWeek)
    const weekTopics = program.topicPlans?.filter(tp => tp.plannedWeek === selectedWeek) || []

    // Generate days for the selected week (7 days)
    const getWeekDays = () => {
        // Fallback: if no weekPlan, use today as start
        const startDate = currentWeekPlan
            ? new Date(currentWeekPlan.startDate)
            : new Date()

        // If no weekPlan but we have topics, show ALL topics distributed across days
        const topicsToShow = weekTopics.length > 0
            ? weekTopics
            : (program.topicPlans || [])

        const days = []
        const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

        // Calculate how many days we actually need based on topics
        const daysNeeded = currentWeekPlan ? 7 : Math.min(7, Math.ceil(topicsToShow.length / 4) || 2)

        for (let i = 0; i < daysNeeded; i++) {
            const date = new Date(startDate)
            date.setDate(startDate.getDate() + i)

            // Distribute topics across days more evenly
            const topicsPerDay = Math.ceil(topicsToShow.length / daysNeeded)
            const startIdx = i * topicsPerDay
            const dayTopics = topicsToShow.slice(startIdx, startIdx + topicsPerDay)

            days.push({
                dayNumber: i + 1,
                dayName: dayNames[i % 7],
                date: date,
                isToday: date.toDateString() === new Date().toDateString(),
                topics: dayTopics
            })
        }
        return days
    }

    const weekDays = getWeekDays()

    return (
        <div className="container max-w-6xl mx-auto py-6 px-4">
            {/* Header */}
            <div className="mb-6 flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        📚 {program.name}
                    </h1>
                    <p className="text-muted-foreground">
                        {program.totalWeeks} недель • {program.hoursPerWeek} ч/неделю •
                        Создано {formatDate(program.generatedAt)}
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={rebalanceProgram} disabled={rebalancing}>
                        {rebalancing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                        Ребалансировать
                    </Button>
                    <ProgramChatDialog programId={program.id} onProgramUpdated={loadProgram} />
                    <Button variant="outline" onClick={() => setProgram(null)}>Пересоздать</Button>
                </div>
            </div>

            {/* Calendar Header with Navigation */}
            <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            const today = new Date()
                            const start = new Date(program.startDate)
                            const diff = Math.floor((today.getTime() - start.getTime()) / (7 * 24 * 60 * 60 * 1000))
                            setSelectedWeek(Math.max(1, Math.min(diff + 1, program.totalWeeks)))
                        }}
                    >
                        Сегодня
                    </Button>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSelectedWeek(Math.max(1, selectedWeek - 1))}
                            disabled={selectedWeek <= 1}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSelectedWeek(Math.min(program.totalWeeks, selectedWeek + 1))}
                            disabled={selectedWeek >= program.totalWeeks}
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                    <h2 className="text-lg font-semibold ml-2">
                        {(() => {
                            const start = new Date(program.startDate)
                            start.setDate(start.getDate() + (selectedWeek - 1) * 7)
                            const end = new Date(start)
                            end.setDate(end.getDate() + 6)
                            const startMonth = start.toLocaleDateString('ru-RU', { month: 'short' })
                            const endMonth = end.toLocaleDateString('ru-RU', { month: 'short', year: 'numeric' })
                            return `${start.getDate()} ${startMonth} — ${end.getDate()} ${endMonth}`
                        })()}
                    </h2>
                    <Badge variant="outline" className="ml-2">Неделя {selectedWeek}</Badge>
                </div>
                <div className="text-sm text-muted-foreground">
                    {weekTopics.length} тем на неделе
                </div>
            </div>

            {/* Week Focus Card */}
            {currentWeekPlan?.focus && (
                <div className="mb-4 p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                    <p className="text-sm">🎯 <span className="font-medium">Фокус недели:</span> {currentWeekPlan.focus}</p>
                </div>
            )}

            {/* Calendar Grid */}
            <div className="border rounded-lg overflow-hidden bg-card">
                {/* Day Headers */}
                <div className="grid grid-cols-7 border-b bg-muted/30">
                    {['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'].map((dayName, idx) => {
                        const start = new Date(program.startDate)
                        start.setDate(start.getDate() + (selectedWeek - 1) * 7 + idx)
                        const isToday = start.toDateString() === new Date().toDateString()
                        const isSunday = idx === 6

                        return (
                            <div
                                key={dayName}
                                className={cn(
                                    "p-3 text-center border-r last:border-r-0",
                                    isSunday && "text-red-400"
                                )}
                            >
                                <p className="text-xs text-muted-foreground font-medium">{dayName}</p>
                                <p className={cn(
                                    "text-xl font-semibold mt-1",
                                    isToday && "bg-purple-500 text-white rounded-full w-9 h-9 flex items-center justify-center mx-auto"
                                )}>
                                    {start.getDate()}
                                </p>
                            </div>
                        )
                    })}
                </div>

                {/* Day Content */}
                <div className="grid grid-cols-7 min-h-[400px]">
                    {weekDays.map((day, idx) => (
                        <div
                            key={day.dayNumber}
                            className={cn(
                                "border-r last:border-r-0 p-2",
                                day.isToday && "bg-purple-500/5"
                            )}
                        >
                            {day.topics.length > 0 ? (
                                <div className="space-y-2">
                                    {day.topics.map((tp) => (
                                        <div
                                            key={tp.id}
                                            className={cn(
                                                "p-2 rounded text-xs cursor-pointer hover:opacity-80 transition-opacity",
                                                tp.status === 'COMPLETED' ? "bg-emerald-500/20 border-l-2 border-emerald-500" : "bg-muted/50 border-l-2"
                                            )}
                                            style={{ borderLeftColor: tp.topic?.subject?.color || '#8b5cf6' }}
                                        >
                                            <div className="flex items-center gap-1 mb-1">
                                                <span>{tp.topic?.subject?.emoji || '📚'}</span>
                                                <span className="font-medium truncate">{tp.topic?.name || 'Тема'}</span>
                                            </div>
                                            <p className="text-muted-foreground truncate text-[10px]">
                                                {tp.topic?.subject?.name}
                                            </p>
                                            {tp.status === 'COMPLETED' && (
                                                <Badge variant="default" className="mt-1 text-[10px] h-4">✓</Badge>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
                                    —
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Tests Section */}
            {(program.scheduledTests?.length || 0) > 0 && (
                <Card className="mt-6">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-lg flex items-center gap-2">
                            <FileText className="h-5 w-5" />
                            Тесты
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            {program.scheduledTests?.slice(0, 5).map(test => (
                                <div key={test.id} className="p-3 rounded-lg border bg-muted/30">
                                    <div className="flex items-center gap-2">
                                        <span>{test.subject?.emoji || '📝'}</span>
                                        <span className="font-medium">{test.title}</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        {formatDate(test.scheduledDate)}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}

