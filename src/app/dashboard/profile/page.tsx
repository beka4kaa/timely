"use client"

import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
    User,
    Target,
    Clock,
    Brain,
    Loader2,
    Save,
    Trash2,
    Plus,
    Sparkles,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface UserProfile {
    name: string
    goal: string
    learningStyle: string
    preferredSessionLength: number
    morningPerson: boolean
    focusAreas: string[]
    weakSubjects: string[]
    notes: string
}

interface AIMemory {
    id: string
    type: string
    content: string
    importance: number
    createdAt: string
}

export default function ProfilePage() {
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [memories, setMemories] = useState<AIMemory[]>([])
    const [profile, setProfile] = useState<UserProfile>({
        name: '',
        goal: '',
        learningStyle: 'mixed',
        preferredSessionLength: 45,
        morningPerson: true,
        focusAreas: [],
        weakSubjects: [],
        notes: '',
    })
    const [newFocusArea, setNewFocusArea] = useState('')

    useEffect(() => {
        loadProfile()
        loadMemories()
    }, [])

    const loadProfile = async () => {
        try {
            const res = await fetch('/api/ai/context')
            if (res.ok) {
                const data = await res.json()
                if (data.profile) {
                    setProfile(prev => ({
                        ...prev,
                        ...JSON.parse(data.profile),
                    }))
                }
            }
        } catch (error) {
            console.error('Error loading profile:', error)
        } finally {
            setLoading(false)
        }
    }

    const loadMemories = async () => {
        try {
            const res = await fetch('/api/ai/memory')
            if (res.ok) {
                const data = await res.json()
                setMemories(data.memories || [])
            }
        } catch (error) {
            console.error('Error loading memories:', error)
        }
    }

    const saveProfile = async () => {
        setSaving(true)
        try {
            await fetch('/api/ai/context', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    key: 'profile',
                    value: profile,
                }),
            })
        } catch (error) {
            console.error('Error saving profile:', error)
        } finally {
            setSaving(false)
        }
    }

    const clearMemories = async () => {
        if (!confirm('Очистить всю память AI о вас?')) return
        try {
            await fetch('/api/ai/memory', { method: 'DELETE' })
            setMemories([])
        } catch (error) {
            console.error('Error clearing memories:', error)
        }
    }

    const addFocusArea = () => {
        if (newFocusArea.trim() && !profile.focusAreas.includes(newFocusArea.trim())) {
            setProfile(prev => ({
                ...prev,
                focusAreas: [...prev.focusAreas, newFocusArea.trim()],
            }))
            setNewFocusArea('')
        }
    }

    const removeFocusArea = (area: string) => {
        setProfile(prev => ({
            ...prev,
            focusAreas: prev.focusAreas.filter(a => a !== area),
        }))
    }

    if (loading) {
        return (
            <div className="container max-w-4xl mx-auto py-6 px-4">
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            </div>
        )
    }

    return (
        <div className="container max-w-4xl mx-auto py-6 px-4">
            <div className="mb-6">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <User className="h-6 w-6" />
                    Профиль для AI
                </h1>
                <p className="text-muted-foreground">
                    Расскажите AI о себе для персонализированных рекомендаций
                </p>
            </div>

            <div className="grid gap-6">
                {/* Basic Info */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <User className="h-5 w-5" />
                            Основное
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-2">
                            <Label htmlFor="name">Как вас зовут?</Label>
                            <Input
                                id="name"
                                placeholder="Имя"
                                value={profile.name}
                                onChange={e => setProfile(prev => ({ ...prev, name: e.target.value }))}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="goal">Главная цель обучения</Label>
                            <Textarea
                                id="goal"
                                placeholder="Например: Подготовиться к A Level экзаменам по физике и математике"
                                value={profile.goal}
                                onChange={e => setProfile(prev => ({ ...prev, goal: e.target.value }))}
                                rows={2}
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Learning Preferences */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <Brain className="h-5 w-5" />
                            Предпочтения в обучении
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-2">
                            <Label>Стиль обучения</Label>
                            <Select
                                value={profile.learningStyle}
                                onValueChange={v => setProfile(prev => ({ ...prev, learningStyle: v }))}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="visual">Визуальный (схемы, видео)</SelectItem>
                                    <SelectItem value="reading">Чтение (тексты, книги)</SelectItem>
                                    <SelectItem value="practice">Практика (задачи, упражнения)</SelectItem>
                                    <SelectItem value="mixed">Смешанный</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid gap-2">
                            <Label>Предпочтительная длина сессии (минуты)</Label>
                            <Select
                                value={profile.preferredSessionLength.toString()}
                                onValueChange={v => setProfile(prev => ({ ...prev, preferredSessionLength: parseInt(v) }))}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="25">25 минут (Pomodoro)</SelectItem>
                                    <SelectItem value="45">45 минут</SelectItem>
                                    <SelectItem value="60">60 минут</SelectItem>
                                    <SelectItem value="90">90 минут</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="flex items-center justify-between">
                            <div>
                                <Label>Утренний человек?</Label>
                                <p className="text-sm text-muted-foreground">
                                    Лучше учитесь утром
                                </p>
                            </div>
                            <Switch
                                checked={profile.morningPerson}
                                onCheckedChange={v => setProfile(prev => ({ ...prev, morningPerson: v }))}
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* Focus Areas */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                            <Target className="h-5 w-5" />
                            Фокус внимания
                        </CardTitle>
                        <CardDescription>
                            На что AI должен обращать особое внимание
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex gap-2">
                            <Input
                                placeholder="Например: Интегралы, Волновая оптика..."
                                value={newFocusArea}
                                onChange={e => setNewFocusArea(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && addFocusArea()}
                            />
                            <Button onClick={addFocusArea}>
                                <Plus className="h-4 w-4" />
                            </Button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {profile.focusAreas.map(area => (
                                <Badge
                                    key={area}
                                    variant="secondary"
                                    className="cursor-pointer hover:bg-destructive/20"
                                    onClick={() => removeFocusArea(area)}
                                >
                                    {area} ×
                                </Badge>
                            ))}
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="notes">Дополнительные заметки для AI</Label>
                            <Textarea
                                id="notes"
                                placeholder="Любая информация, которую AI должен знать о вашем обучении..."
                                value={profile.notes}
                                onChange={e => setProfile(prev => ({ ...prev, notes: e.target.value }))}
                                rows={3}
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* AI Memory */}
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <Sparkles className="h-5 w-5 text-purple-500" />
                                Память AI
                            </CardTitle>
                            {memories.length > 0 && (
                                <Button variant="ghost" size="sm" onClick={clearMemories}>
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Очистить
                                </Button>
                            )}
                        </div>
                        <CardDescription>
                            Что AI узнал о вас в процессе работы
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {memories.length === 0 ? (
                            <p className="text-muted-foreground text-sm">
                                Пока пусто. AI будет запоминать важные факты по мере использования.
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {memories.map(m => (
                                    <div key={m.id} className="p-2 rounded-lg bg-muted/50 text-sm">
                                        <Badge variant="outline" className="mr-2">
                                            {m.type}
                                        </Badge>
                                        {m.content}
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Save Button */}
                <Button onClick={saveProfile} disabled={saving} size="lg">
                    {saving ? (
                        <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            Сохранение...
                        </>
                    ) : (
                        <>
                            <Save className="h-4 w-4 mr-2" />
                            Сохранить профиль
                        </>
                    )}
                </Button>
            </div>
        </div>
    )
}
