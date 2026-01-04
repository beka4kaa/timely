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
    plannedDay: number
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

// Study session types for spaced repetition
interface StudySession {
    id: string
    session_type: 'THEORY' | 'PRACTICE' | 'REVIEW' | 'TEST'
    scheduled_date: string
    scheduled_time: string
    duration_minutes: number
    day_number: number
    order_in_day: number
    status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED'
    topic_name: string | null
    subject_name: string
    title: string
    topic?: {
        id: string
        name: string
        subject: {
            id: string
            name: string
            emoji: string
            color: string
        }
    }
    subject?: {
        id: string
        name: string
        emoji: string
        color: string
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
    study_sessions?: StudySession[]
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
    
    // New intensity settings
    const [hoursPerDay, setHoursPerDay] = useState(4)
    const [intensityLevel, setIntensityLevel] = useState<'relaxed' | 'normal' | 'intense' | 'extreme'>('normal')
    const [studyDays, setStudyDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]) // 1=Mon, 7=Sun
    
    // Day names for UI
    const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
    
    // Intensity presets
    const intensityPresets = {
        relaxed: { hoursPerDay: 2, minTopicsPerDay: 1, label: '😌 Расслабленный', description: '1-2 темы/день, без спешки' },
        normal: { hoursPerDay: 4, minTopicsPerDay: 3, label: '📚 Нормальный', description: '3-4 темы/день, стабильный прогресс' },
        intense: { hoursPerDay: 6, minTopicsPerDay: 5, label: '🔥 Интенсивный', description: '5-6 тем/день, быстрый прогресс' },
        extreme: { hoursPerDay: 10, minTopicsPerDay: 8, label: '⚡ Экстремальный', description: '8+ тем/день, максимум' },
    }

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
    // Use intensity settings for calculations
    const minTopicsPerDay = intensityPresets[intensityLevel].minTopicsPerDay
    const maxTopicsPerDay = intensityLevel === 'extreme' ? 12 : intensityLevel === 'intense' ? 8 : 6
    
    const calculateWorkloadEstimates = (): Array<{
        totalTopics: number
        daysAvailable: number
        studyDaysAvailable: number
        actualDaysNeeded: number
        topicsPerDay: number
        deadline: Date
        isHighIntensity: boolean
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
            studyDaysUntil: number
        }> = []

        subjects.forEach(subject => {
            const deadline = subjectDeadlines.find(sd => sd.subjectId === subject.id)
            if (deadline?.deadline) {
                const deadlineDate = new Date(deadline.deadline)
                const daysUntil = Math.max(1, Math.ceil((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)))
                
                // Calculate actual study days (accounting for selected study days)
                const weeksUntil = Math.ceil(daysUntil / 7)
                const studyDaysUntil = Math.max(1, weeksUntil * studyDays.length)

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
                    daysUntil,
                    studyDaysUntil
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
                const studyDaysAvailable = subjects.reduce((sum, s) => sum + s.studyDaysUntil, 0) / subjects.length
                const rawTopicsPerDay = Math.ceil(totalTopics / studyDaysAvailable)
                
                // Apply intensity settings
                let topicsPerDay = rawTopicsPerDay
                let actualDaysNeeded = Math.ceil(studyDaysAvailable)
                let isHighIntensity = false
                
                if (rawTopicsPerDay < minTopicsPerDay) {
                    // Schedule is too relaxed - will be compressed
                    topicsPerDay = minTopicsPerDay
                    actualDaysNeeded = Math.ceil(totalTopics / minTopicsPerDay)
                    isHighIntensity = true
                } else if (rawTopicsPerDay > maxTopicsPerDay) {
                    topicsPerDay = maxTopicsPerDay
                }
                
                return {
                    totalTopics,
                    daysAvailable: days,
                    studyDaysAvailable: Math.ceil(studyDaysAvailable),
                    actualDaysNeeded,
                    topicsPerDay,
                    deadline: subjects[0].deadline,
                    isHighIntensity,
                    isIntense: topicsPerDay > 5,
                    isExtreme: topicsPerDay > maxTopicsPerDay,
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
                    hoursPerWeek: hoursPerDay * studyDays.length,
                    hoursPerDay,
                    intensityLevel,
                    minTopicsPerDay: intensityPresets[intensityLevel].minTopicsPerDay,
                    studyDays,
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
                    <CardContent className="space-y-6">
                        {/* Intensity Level Selection */}
                        <div className="space-y-3">
                            <Label className="text-base">Уровень интенсивности</Label>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                {(Object.entries(intensityPresets) as [typeof intensityLevel, typeof intensityPresets[typeof intensityLevel]][]).map(([key, preset]) => (
                                    <button
                                        key={key}
                                        type="button"
                                        onClick={() => {
                                            setIntensityLevel(key)
                                            setHoursPerDay(preset.hoursPerDay)
                                        }}
                                        className={cn(
                                            "p-3 rounded-lg border text-left transition-all",
                                            intensityLevel === key
                                                ? "border-primary bg-primary/10 ring-2 ring-primary/20"
                                                : "border-border hover:border-primary/50"
                                        )}
                                    >
                                        <div className="font-medium text-sm">{preset.label}</div>
                                        <div className="text-xs text-muted-foreground mt-1">{preset.description}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                        
                        {/* Hours per Day */}
                        <div className="space-y-2">
                            <Label>Часов в день</Label>
                            <div className="flex items-center gap-4">
                                <Input
                                    type="number"
                                    min={1}
                                    max={16}
                                    value={hoursPerDay}
                                    onChange={e => setHoursPerDay(Math.min(16, Math.max(1, parseInt(e.target.value) || 4)))}
                                    className="w-24"
                                />
                                <div className="flex-1">
                                    <input
                                        type="range"
                                        min={1}
                                        max={16}
                                        value={hoursPerDay}
                                        onChange={e => setHoursPerDay(parseInt(e.target.value))}
                                        className="w-full accent-primary"
                                    />
                                </div>
                                <span className="text-sm text-muted-foreground w-20">
                                    {hoursPerDay * studyDays.length}ч/нед
                                </span>
                            </div>
                        </div>
                        
                        {/* Study Days Selection */}
                        <div className="space-y-2">
                            <Label>Дни для учёбы</Label>
                            <div className="flex gap-2">
                                {dayNames.map((day, idx) => {
                                    const dayNum = idx + 1
                                    const isSelected = studyDays.includes(dayNum)
                                    return (
                                        <button
                                            key={dayNum}
                                            type="button"
                                            onClick={() => {
                                                if (isSelected) {
                                                    if (studyDays.length > 1) {
                                                        setStudyDays(studyDays.filter(d => d !== dayNum))
                                                    }
                                                } else {
                                                    setStudyDays([...studyDays, dayNum].sort())
                                                }
                                            }}
                                            className={cn(
                                                "w-10 h-10 rounded-full text-sm font-medium transition-all",
                                                isSelected
                                                    ? "bg-primary text-primary-foreground"
                                                    : "bg-muted text-muted-foreground hover:bg-muted/80",
                                                dayNum === 6 || dayNum === 7 ? "ring-1 ring-orange-500/30" : ""
                                            )}
                                        >
                                            {day}
                                        </button>
                                    )
                                })}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                {studyDays.length} дней × {hoursPerDay}ч = <strong>{studyDays.length * hoursPerDay}ч в неделю</strong>
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

                        {/* Workload estimation - show ALL deadline groups with intensity settings */}
                        {workloadEstimates.length > 0 && (
                            <div className="space-y-3">
                                {workloadEstimates.map((estimate, idx) => (
                                    <div key={idx} className={cn(
                                        "p-4 rounded-lg border",
                                        estimate.isExtreme
                                            ? "bg-red-500/10 border-red-500/30"
                                            : estimate.isIntense
                                                ? "bg-yellow-500/10 border-yellow-500/30"
                                                : estimate.isHighIntensity
                                                    ? "bg-blue-500/10 border-blue-500/30"
                                                    : "bg-emerald-500/10 border-emerald-500/30"
                                    )}>
                                        <div className="flex items-start gap-3">
                                            {estimate.isExtreme ? (
                                                <AlertTriangle className="h-5 w-5 text-red-400 mt-0.5" />
                                            ) : estimate.isIntense ? (
                                                <AlertCircle className="h-5 w-5 text-yellow-400 mt-0.5" />
                                            ) : estimate.isHighIntensity ? (
                                                <Target className="h-5 w-5 text-blue-400 mt-0.5" />
                                            ) : (
                                                <CheckCircle className="h-5 w-5 text-emerald-400 mt-0.5" />
                                            )}
                                            <div className="flex-1">
                                                <div className="font-medium mb-1">
                                                    {estimate.isExtreme
                                                        ? "⚠️ Невыполнимо — только быстрый обзор"
                                                        : estimate.isIntense
                                                            ? "⏰ Интенсивный режим"
                                                            : estimate.isHighIntensity
                                                                ? "🚀 Режим высокой интенсивности"
                                                                : "✅ Нагрузка в норме"
                                                    }
                                                </div>
                                                <div className="text-sm text-muted-foreground space-y-1">
                                                    <p>
                                                        <strong>{estimate.subjectsAffected.join(', ')}</strong>
                                                    </p>
                                                    <p>
                                                        <strong>{estimate.totalTopics}</strong> тем за <strong>{estimate.studyDaysAvailable}</strong> учебных дней
                                                        {estimate.actualDaysNeeded < estimate.studyDaysAvailable && (
                                                            <span className="text-blue-400"> (сжато до {estimate.actualDaysNeeded})</span>
                                                        )}
                                                        {' = '}
                                                        <strong className={cn(
                                                            "ml-1",
                                                            estimate.isExtreme && "text-red-400",
                                                            estimate.isIntense && !estimate.isExtreme && "text-yellow-400",
                                                            estimate.isHighIntensity && "text-blue-400"
                                                        )}>
                                                            {estimate.topicsPerDay} тем/день × {hoursPerDay}ч
                                                        </strong>
                                                    </p>
                                                    <p className="text-xs">
                                                        Дедлайн: {estimate.deadline.toLocaleDateString('ru-RU', {
                                                            day: 'numeric',
                                                            month: 'long',
                                                            year: 'numeric'
                                                        })} ({estimate.daysAvailable} дней, {estimate.studyDaysAvailable} учебных)
                                                    </p>
                                                    {estimate.isHighIntensity && !estimate.isIntense && !estimate.isExtreme && (
                                                        <p className="text-xs text-blue-400 mt-2">
                                                            📚 Программа сжата для эффективного обучения (мин. {minTopicsPerDay} тем/день)
                                                        </p>
                                                    )}
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

    // Filter topics for the selected week based on plannedDay
    // plannedDay 1-7 = week 1, plannedDay 8-14 = week 2, etc.
    const weekStartDay = (selectedWeek - 1) * 7 + 1  // e.g. week 1 = day 1, week 2 = day 8
    const weekEndDay = selectedWeek * 7  // e.g. week 1 = day 7, week 2 = day 14

    const weekTopics = program.topicPlans?.filter(tp => {
        // If plannedWeek is set, use it
        if (tp.plannedWeek) {
            return tp.plannedWeek === selectedWeek
        }
        // Otherwise calculate from plannedDay
        if (tp.plannedDay) {
            return tp.plannedDay >= weekStartDay && tp.plannedDay <= weekEndDay
        }
        return false
    }) || []

    // Generate days for the selected week (always 7 days)
    const getWeekDays = () => {
        const startDate = new Date(program.startDate)
        startDate.setDate(startDate.getDate() + (selectedWeek - 1) * 7)

        const days = []
        const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

        for (let i = 0; i < 7; i++) {
            const date = new Date(startDate)
            date.setDate(startDate.getDate() + i)

            // Filter topics for this specific day
            const absoluteDay = weekStartDay + i  // e.g. week 2, day 0 = day 8
            const dayTopics = program.topicPlans?.filter(tp => tp.plannedDay === absoluteDay) || []
            
            // Filter study sessions for this specific date
            const dateStr = date.toISOString().split('T')[0]
            const daySessions = program.study_sessions?.filter(s => 
                s.scheduled_date === dateStr || s.day_number === absoluteDay
            ).sort((a, b) => {
                // Sort by time, then by order_in_day
                if (a.scheduled_time !== b.scheduled_time) {
                    return a.scheduled_time.localeCompare(b.scheduled_time)
                }
                return a.order_in_day - b.order_in_day
            }) || []

            days.push({
                dayNumber: i + 1,
                dayName: dayNames[i],
                date: date,
                isToday: date.toDateString() === new Date().toDateString(),
                topics: dayTopics.length > 0 ? dayTopics : weekTopics.filter((_, idx) => idx % 7 === i).slice(0, 3),
                sessions: daySessions
            })
        }
        return days
    }

    const weekDays = getWeekDays()
    
    // Helper function to get session type badge color and icon
    const getSessionTypeStyle = (type: string) => {
        switch (type) {
            case 'THEORY':
                return { bg: 'bg-blue-500/20', border: 'border-blue-500', text: 'text-blue-400', icon: '📖', label: 'Theory' }
            case 'PRACTICE':
                return { bg: 'bg-green-500/20', border: 'border-green-500', text: 'text-green-400', icon: '✍️', label: 'Practice' }
            case 'REVIEW':
                return { bg: 'bg-purple-500/20', border: 'border-purple-500', text: 'text-purple-400', icon: '🔄', label: 'Review' }
            case 'TEST':
                return { bg: 'bg-amber-500/20', border: 'border-amber-500', text: 'text-amber-400', icon: '📝', label: 'Test' }
            default:
                return { bg: 'bg-muted/50', border: 'border-muted-foreground', text: 'text-muted-foreground', icon: '📚', label: 'Study' }
        }
    }

    return (
        <div className="container max-w-6xl mx-auto py-6 px-4">
            {/* Header */}
            <div className="mb-6 flex items-start justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        📚 {program.name}
                    </h1>
                    <p className="text-muted-foreground">
                        {program.totalWeeks} weeks • {program.hoursPerWeek} hrs/week •
                        Created {formatDate(program.generatedAt)}
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={rebalanceProgram} disabled={rebalancing}>
                        {rebalancing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                        Rebalance
                    </Button>
                    <ProgramChatDialog programId={program.id} onProgramUpdated={loadProgram} />
                    <Button variant="outline" onClick={() => setProgram(null)}>Recreate</Button>
                </div>
            </div>

            {/* Goals Section - compact, above calendar */}
            {program && program.topicPlans && program.topicPlans.length > 0 && (() => {
                // Group topics by subject and find deadlines per subject
                const subjectsInProgram = new Map<string, { 
                    id: string; name: string; emoji: string; color: string; 
                    topicCount: number; deadline: Date | null 
                }>()
                
                program.topicPlans.forEach(tp => {
                    const subject = tp.topic?.subject
                    if (subject) {
                        const existing = subjectsInProgram.get(subject.id)
                        const topicDeadline = tp.deadline ? new Date(tp.deadline) : null
                        
                        if (existing) {
                            existing.topicCount++
                            // Keep the latest deadline for this subject
                            if (topicDeadline && (!existing.deadline || topicDeadline > existing.deadline)) {
                                existing.deadline = topicDeadline
                            }
                        } else {
                            subjectsInProgram.set(subject.id, {
                                id: subject.id, name: subject.name, emoji: subject.emoji || '📚',
                                color: subject.color || '#8b5cf6', topicCount: 1,
                                deadline: topicDeadline
                            })
                        }
                    }
                })
                const subjectsList = Array.from(subjectsInProgram.values())

                return subjectsList.length > 0 ? (
                    <div className="mb-4 space-y-2">
                        <div className="flex items-center gap-4 text-sm flex-wrap">
                            <span className="text-muted-foreground">🎯 Goals:</span>
                            {subjectsList.map(s => (
                                <span key={s.id} className="flex items-center gap-1">
                                    <span style={{ color: s.color }}>{s.emoji}</span>
                                    <span className="font-medium">{s.name}</span>
                                    <span className="text-muted-foreground">({s.topicCount})</span>
                                </span>
                            ))}
                        </div>
                        {/* Deadlines per subject */}
                        <div className="flex items-center gap-4 text-sm flex-wrap">
                            <span className="text-muted-foreground">📅 Deadlines:</span>
                            {subjectsList.filter(s => s.deadline).map(s => (
                                <span key={s.id} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/50">
                                    <span style={{ color: s.color }}>{s.emoji}</span>
                                    <span className="font-medium">{s.name}</span>
                                    <span className="text-muted-foreground">→</span>
                                    <span className={cn(
                                        "font-medium",
                                        s.deadline && s.deadline < new Date() && "text-red-500",
                                        s.deadline && s.deadline >= new Date() && s.deadline <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) && "text-yellow-500"
                                    )}>
                                        {s.deadline?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    </span>
                                </span>
                            ))}
                            {subjectsList.filter(s => s.deadline).length === 0 && (
                                <span className="text-muted-foreground">No deadlines set</span>
                            )}
                        </div>
                    </div>
                ) : null
            })()}

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
                        Today
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
                            onClick={() => setSelectedWeek(selectedWeek + 1)}
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
                            const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                            const endStr = end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                            return `${startStr} – ${endStr}`
                        })()}
                    </h2>
                    <Badge variant="outline" className="ml-2">Week {selectedWeek}</Badge>
                </div>
                <div className="text-sm text-muted-foreground">
                    {weekTopics.length} topics this week
                </div>
            </div>

            {/* Week Focus Card */}
            {currentWeekPlan?.focus && (
                <div className="mb-4 p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                    <p className="text-sm">🎯 <span className="font-medium">Week Focus:</span> {currentWeekPlan.focus}</p>
                </div>
            )}

            {/* Calendar Grid */}
            <div className="border rounded-lg overflow-hidden bg-card">
                {/* Day Headers */}
                <div className="grid grid-cols-7 border-b bg-muted/30">
                    {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((dayName, idx) => {
                        const start = new Date(program.startDate)
                        start.setDate(start.getDate() + (selectedWeek - 1) * 7 + idx)
                        const isToday = start.toDateString() === new Date().toDateString()
                        const isSunday = idx === 6

                        // Calculate total hours for this day (prefer sessions over topics)
                        const daySessions = weekDays[idx]?.sessions || []
                        const dayTopics = weekDays[idx]?.topics || []
                        const totalMinutes = daySessions.reduce((sum, s) => sum + s.duration_minutes, 0)
                        const totalHours = daySessions.length > 0 
                            ? (totalMinutes / 60).toFixed(1)
                            : dayTopics.reduce((sum, tp) => sum + (tp.estimatedHours || 1), 0).toFixed(1)
                        const sessionCount = daySessions.length

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
                                {parseFloat(totalHours) > 0 && (
                                    <p className="text-[10px] text-muted-foreground mt-1">
                                        {totalHours}h {sessionCount > 0 && `• ${sessionCount} sessions`}
                                    </p>
                                )}
                            </div>
                        )
                    })}
                </div>

                {/* Day Content */}
                <div className="grid grid-cols-7 min-h-[400px]">
                    {weekDays.map((day, idx) => {
                        // Calculate total hours for this day
                        const totalMinutes = day.sessions.reduce((sum, s) => sum + s.duration_minutes, 0)
                        const totalHours = (totalMinutes / 60).toFixed(1)
                        
                        return (
                            <div
                                key={day.dayNumber}
                                className={cn(
                                    "border-r last:border-r-0 p-2",
                                    day.isToday && "bg-purple-500/5"
                                )}
                            >
                                {/* Show sessions if available, otherwise fall back to topics */}
                                {day.sessions.length > 0 ? (
                                    <div className="space-y-1">
                                        {day.sessions.map((session) => {
                                            const style = getSessionTypeStyle(session.session_type)
                                            return (
                                                <div
                                                    key={session.id}
                                                    className={cn(
                                                        "p-1.5 rounded text-xs cursor-pointer hover:opacity-80 transition-opacity border-l-2",
                                                        style.bg,
                                                        style.border,
                                                        session.status === 'COMPLETED' && "opacity-60"
                                                    )}
                                                >
                                                    <div className="flex items-center gap-1 mb-0.5">
                                                        <span className="text-[10px]">{style.icon}</span>
                                                        <span className={cn("font-medium truncate text-[11px]", style.text)}>
                                                            {session.topic_name || session.title || style.label}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[9px] text-muted-foreground">
                                                            {session.scheduled_time} • {session.duration_minutes}min
                                                        </span>
                                                        {session.status === 'COMPLETED' && (
                                                            <CheckCircle className="h-3 w-3 text-emerald-500" />
                                                        )}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                        {/* Show total hours for the day */}
                                        <div className="text-[10px] text-muted-foreground text-center pt-1 border-t border-dashed mt-1">
                                            Total: {totalHours}h
                                        </div>
                                    </div>
                                ) : day.topics.length > 0 ? (
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
                                                    <span className="font-medium truncate">{tp.topic?.name || 'Topic'}</span>
                                                </div>
                                                <p className="text-muted-foreground truncate text-[10px]">
                                                    {tp.topic?.subject?.name}
                                                </p>
                                                <div className="flex items-center justify-between mt-1">
                                                    <span className="text-[10px] text-muted-foreground">
                                                        ⏱ {tp.estimatedHours || 1}h
                                                    </span>
                                                    {tp.status === 'COMPLETED' && (
                                                        <Badge variant="default" className="text-[10px] h-4">✓</Badge>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
                                        —
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>

            {/* Tests Section */}
            {(program.scheduledTests?.length || 0) > 0 && (
                <Card className="mt-6">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-lg flex items-center gap-2">
                            <FileText className="h-5 w-5" />
                            Tests
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

