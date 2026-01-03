"use client"

import { useState, useEffect } from 'react'
import { WeaknessesTable, AddTopicDialog } from '@/components/mind'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, List, Table2, ChevronRight, ChevronDown, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Topic {
    id: string
    name: string
    status: string
    picked: boolean
    subject: string  // This is just the subject ID
}

interface Subject {
    id: string
    name: string
    emoji: string
    color?: string
}

interface GroupedTopics {
    [subjectId: string]: {
        subject: Subject
        topics: Topic[]
    }
}

export default function TopicsPage() {
    const [topics, setTopics] = useState<Topic[]>([])
    const [subjects, setSubjects] = useState<Subject[]>([])
    const [loading, setLoading] = useState(true)
    const [showAddDialog, setShowAddDialog] = useState(false)
    const [expandedSubjects, setExpandedSubjects] = useState<Set<string>>(new Set())

    useEffect(() => {
        loadData()
    }, [])

    const loadData = async () => {
        setLoading(true)
        try {
            const [topicsRes, subjectsRes] = await Promise.all([
                fetch('/api/topics?filter=all'),
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
        } catch (err) {
            console.error(err)
        } finally {
            setLoading(false)
        }
    }

    const toggleSubject = (subjectId: string) => {
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

    const handleDeleteTopic = async (topicId: string, e: React.MouseEvent) => {
        e.stopPropagation()
        if (!confirm('Удалить эту тему?')) return
        
        try {
            const res = await fetch(`/api/topics/${topicId}`, { method: 'DELETE' })
            if (res.ok || res.status === 204) {
                setTopics(prev => prev.filter(t => t.id !== topicId))
                toast.success('Тема удалена')
            } else {
                toast.error('Не удалось удалить тему')
            }
        } catch (error) {
            console.error(error)
            toast.error('Ошибка при удалении')
        }
    }

    // Create a map of subjects for quick lookup
    const subjectsMap = new Map(subjects.map(s => [s.id, s]))

    // Group topics by subject
    const groupedTopics: GroupedTopics = topics.reduce((acc, topic) => {
        const subjectId = typeof topic.subject === 'object' ? (topic.subject as any).id : topic.subject
        if (!subjectId) return acc
        
        const subjectInfo = subjectsMap.get(subjectId)
        if (!subjectInfo) return acc
        
        if (!acc[subjectId]) {
            acc[subjectId] = {
                subject: subjectInfo,
                topics: [],
            }
        }
        acc[subjectId].topics.push(topic)
        return acc
    }, {} as GroupedTopics)

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'NOT_STARTED': return 'Not started'
            case 'MEDIUM': return 'In progress'
            case 'SUCCESS': return 'Good'
            case 'MASTERED': return 'Mastered'
            default: return status
        }
    }

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'NOT_STARTED': return 'bg-muted/50 text-muted-foreground'
            case 'MEDIUM': return 'bg-amber-500/20 text-amber-400'
            case 'SUCCESS': return 'bg-emerald-500/20 text-emerald-400'
            case 'MASTERED': return 'bg-blue-500/20 text-blue-400'
            default: return 'bg-muted'
        }
    }

    return (
        <div className="container max-w-6xl mx-auto py-6 px-4">
            <div className="mb-4">
                <h1 className="text-xl font-bold">Topics</h1>
                <p className="text-sm text-muted-foreground">
                    Manage your study topics
                </p>
            </div>

            <Tabs defaultValue="list">
                <div className="flex items-center justify-between mb-3">
                    <TabsList className="h-8">
                        <TabsTrigger value="list" className="gap-1.5 text-xs h-7 px-2">
                            <List className="h-3 w-3" />
                            List
                        </TabsTrigger>
                        <TabsTrigger value="table" className="gap-1.5 text-xs h-7 px-2">
                            <Table2 className="h-3 w-3" />
                            Table
                        </TabsTrigger>
                    </TabsList>
                    <Button size="sm" className="h-7 text-xs" onClick={() => setShowAddDialog(true)}>
                        <Plus className="h-3 w-3 mr-1" />
                        Add
                    </Button>
                </div>

                <TabsContent value="list" className="mt-0">
                    {loading ? (
                        <div className="text-center py-6 text-sm text-muted-foreground">Loading...</div>
                    ) : Object.keys(groupedTopics).length === 0 ? (
                        <div className="text-center py-6 text-sm text-muted-foreground">
                            No topics yet
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {Object.entries(groupedTopics).map(([subjectId, { subject, topics: subjectTopics }]) => (
                                <div key={subjectId} className="rounded-md border overflow-hidden">
                                    {/* Subject header - clickable */}
                                    <button
                                        onClick={() => toggleSubject(subjectId)}
                                        className="w-full flex items-center justify-between px-3 py-2 bg-card hover:bg-accent/50 transition-colors"
                                    >
                                        <div className="flex items-center gap-2">
                                            {expandedSubjects.has(subjectId) ? (
                                                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                            ) : (
                                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                            )}
                                            <span className="text-sm">{subject.emoji}</span>
                                            <span className="text-sm font-medium">{subject.name}</span>
                                        </div>
                                        <Badge variant="secondary" className="text-xs h-5 px-1.5">
                                            {subjectTopics.length}
                                        </Badge>
                                    </button>

                                    {/* Topics list - collapsible */}
                                    {expandedSubjects.has(subjectId) && (
                                        <div className="border-t">
                                            {subjectTopics.map((topic, idx) => (
                                                <div
                                                    key={topic.id}
                                                    className={cn(
                                                        "flex items-center justify-between px-3 py-1.5 pl-9 group",
                                                        idx !== subjectTopics.length - 1 && "border-b border-border/50"
                                                    )}
                                                >
                                                    <span className="text-sm">{topic.name}</span>
                                                    <div className="flex items-center gap-2">
                                                        <Badge
                                                            className={cn("text-[10px] h-4 px-1.5", getStatusColor(topic.status))}
                                                        >
                                                            {getStatusLabel(topic.status)}
                                                        </Badge>
                                                        <button
                                                            onClick={(e) => handleDeleteTopic(topic.id, e)}
                                                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-destructive/20 rounded"
                                                        >
                                                            <Trash2 className="h-3 w-3 text-destructive" />
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="table" className="mt-0">
                    <WeaknessesTable hideAddButton />
                </TabsContent>
            </Tabs>

            <AddTopicDialog
                open={showAddDialog}
                onOpenChange={setShowAddDialog}
                subjects={subjects}
                onTopicAdded={() => loadData()}
            />
        </div>
    )
}
