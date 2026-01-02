"use client"

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from '@/components/ui/tabs'
import {
    Plus,
    Trash2,
    Loader2
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
    Block,
    BlockType,
    CreateBlockForm,
    BLOCK_TYPE_CONFIG,
    DEFAULT_LESSON_SEGMENTS,
    DEFAULT_LESSON_SUBTASKS
} from '@/types/study-planner'

interface AddBlockDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    dayPlanId: string
    onBlockAdded: (block: Block) => void
}

const COLORS = [
    '#8b5cf6', // purple
    '#3b82f6', // blue
    '#10b981', // green
    '#f59e0b', // amber
    '#ef4444', // red
    '#ec4899', // pink
    '#06b6d4', // cyan
]

export function AddBlockDialog({ open, onOpenChange, dayPlanId, onBlockAdded }: AddBlockDialogProps) {
    const [loading, setLoading] = useState(false)
    const [blockType, setBlockType] = useState<BlockType>('LESSON')
    const [form, setForm] = useState<CreateBlockForm>({
        type: 'LESSON',
        title: '',
        durationMinutes: 90,
        startTime: '',
        notes: '',
        color: '#8b5cf6',
        segments: [...DEFAULT_LESSON_SEGMENTS],
        subtasks: [...DEFAULT_LESSON_SUBTASKS],
    })

    // Reset form when dialog opens
    React.useEffect(() => {
        if (open) {
            setBlockType('LESSON')
            setForm({
                type: 'LESSON',
                title: '',
                durationMinutes: 90,
                startTime: '',
                notes: '',
                color: '#8b5cf6',
                segments: [...DEFAULT_LESSON_SEGMENTS],
                subtasks: [...DEFAULT_LESSON_SUBTASKS],
            })
        }
    }, [open])

    // Update form when block type changes
    const handleTypeChange = (type: BlockType) => {
        setBlockType(type)
        setForm(prev => ({
            ...prev,
            type,
            color: BLOCK_TYPE_CONFIG[type].defaultColor,
            durationMinutes: type === 'LESSON' ? 90 : type === 'BREAK' ? 10 : 60,
            segments: type === 'LESSON' ? [...DEFAULT_LESSON_SEGMENTS] : [],
            subtasks: type === 'LESSON' ? [...DEFAULT_LESSON_SUBTASKS] : [],
        }))
    }

    // Add segment
    const addSegment = () => {
        setForm(prev => ({
            ...prev,
            segments: [...prev.segments, { title: '', durationMinutes: 30 }],
        }))
    }

    // Remove segment
    const removeSegment = (index: number) => {
        setForm(prev => ({
            ...prev,
            segments: prev.segments.filter((_, i) => i !== index),
        }))
    }

    // Update segment
    const updateSegment = (index: number, field: 'title' | 'durationMinutes', value: string | number) => {
        setForm(prev => ({
            ...prev,
            segments: prev.segments.map((seg, i) =>
                i === index ? { ...seg, [field]: value } : seg
            ),
        }))
    }

    // Add subtask
    const addSubtask = () => {
        setForm(prev => ({
            ...prev,
            subtasks: [...prev.subtasks, { title: '' }],
        }))
    }

    // Remove subtask
    const removeSubtask = (index: number) => {
        setForm(prev => ({
            ...prev,
            subtasks: prev.subtasks.filter((_, i) => i !== index),
        }))
    }

    // Update subtask
    const updateSubtask = (index: number, title: string) => {
        setForm(prev => ({
            ...prev,
            subtasks: prev.subtasks.map((sub, i) =>
                i === index ? { ...sub, title } : sub
            ),
        }))
    }

    // Calculate total duration from segments
    const totalSegmentDuration = form.segments.reduce((acc, seg) => acc + seg.durationMinutes, 0)

    // Submit form
    const handleSubmit = async () => {
        if (!form.title.trim()) return
        if (!dayPlanId) return

        setLoading(true)
        try {
            const response = await fetch('/api/blocks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    dayPlanId,
                    type: blockType,
                    title: form.title.trim(),
                    durationMinutes: blockType === 'LESSON' ? totalSegmentDuration : form.durationMinutes,
                    startTime: form.startTime || null,
                    notes: form.notes || null,
                    color: form.color,
                    segments: blockType === 'LESSON'
                        ? form.segments.filter(s => s.title.trim())
                        : undefined,
                    subtasks: blockType === 'LESSON'
                        ? form.subtasks.filter(s => s.title.trim())
                        : undefined,
                }),
            })

            if (response.ok) {
                const block = await response.json()
                onBlockAdded(block)
            }
        } catch (error) {
            console.error('Error creating block:', error)
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Добавить блок</DialogTitle>
                    <DialogDescription>
                        Создайте урок, событие или перерыв для вашего плана на день
                    </DialogDescription>
                </DialogHeader>

                <Tabs value={blockType} onValueChange={(v) => handleTypeChange(v as BlockType)}>
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="LESSON" className="gap-2">
                            📚 Урок
                        </TabsTrigger>
                        <TabsTrigger value="EVENT" className="gap-2">
                            📅 Событие
                        </TabsTrigger>
                        <TabsTrigger value="BREAK" className="gap-2">
                            ☕ Перерыв
                        </TabsTrigger>
                    </TabsList>

                    {/* Common fields */}
                    <div className="space-y-4 mt-6">
                        <div className="grid gap-2">
                            <Label htmlFor="title">Название</Label>
                            <Input
                                id="title"
                                placeholder={blockType === 'LESSON' ? 'Математика: производные' : blockType === 'BREAK' ? 'Перерыв' : 'Встреча'}
                                value={form.title}
                                onChange={(e) => setForm(prev => ({ ...prev, title: e.target.value }))}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="startTime">Время начала (опционально)</Label>
                                <Input
                                    id="startTime"
                                    type="time"
                                    value={form.startTime}
                                    onChange={(e) => setForm(prev => ({ ...prev, startTime: e.target.value }))}
                                />
                            </div>

                            {blockType !== 'LESSON' && (
                                <div className="grid gap-2">
                                    <Label htmlFor="duration">Длительность (мин)</Label>
                                    <Input
                                        id="duration"
                                        type="number"
                                        min={1}
                                        value={form.durationMinutes}
                                        onChange={(e) => setForm(prev => ({ ...prev, durationMinutes: parseInt(e.target.value) || 1 }))}
                                    />
                                </div>
                            )}
                        </div>

                        <div className="grid gap-2">
                            <Label>Цвет</Label>
                            <div className="flex gap-2">
                                {COLORS.map(color => (
                                    <button
                                        key={color}
                                        className={cn(
                                            "w-8 h-8 rounded-full border-2 transition-transform",
                                            form.color === color ? "border-foreground scale-110" : "border-transparent"
                                        )}
                                        style={{ backgroundColor: color }}
                                        onClick={() => setForm(prev => ({ ...prev, color }))}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Lesson-specific fields */}
                    <TabsContent value="LESSON" className="space-y-4 mt-4">
                        {/* Segments */}
                        <div className="grid gap-2">
                            <div className="flex items-center justify-between">
                                <Label>Сегменты (общее время: {totalSegmentDuration} мин)</Label>
                                <Button type="button" variant="outline" size="sm" onClick={addSegment}>
                                    <Plus className="h-4 w-4 mr-1" /> Добавить
                                </Button>
                            </div>
                            <div className="space-y-2">
                                {form.segments.map((segment, idx) => (
                                    <div key={idx} className="flex items-center gap-2">
                                        <Input
                                            placeholder="Название сегмента"
                                            value={segment.title}
                                            onChange={(e) => updateSegment(idx, 'title', e.target.value)}
                                            className="flex-1"
                                        />
                                        <Input
                                            type="number"
                                            min={1}
                                            value={segment.durationMinutes}
                                            onChange={(e) => updateSegment(idx, 'durationMinutes', parseInt(e.target.value) || 1)}
                                            className="w-20"
                                        />
                                        <span className="text-sm text-muted-foreground">мин</span>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => removeSegment(idx)}
                                            disabled={form.segments.length <= 1}
                                        >
                                            <Trash2 className="h-4 w-4 text-destructive" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Subtasks */}
                        <div className="grid gap-2">
                            <div className="flex items-center justify-between">
                                <Label>Чек-лист</Label>
                                <Button type="button" variant="outline" size="sm" onClick={addSubtask}>
                                    <Plus className="h-4 w-4 mr-1" /> Добавить
                                </Button>
                            </div>
                            <div className="space-y-2">
                                {form.subtasks.map((subtask, idx) => (
                                    <div key={idx} className="flex items-center gap-2">
                                        <Input
                                            placeholder="Задача"
                                            value={subtask.title}
                                            onChange={(e) => updateSubtask(idx, e.target.value)}
                                            className="flex-1"
                                        />
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => removeSubtask(idx)}
                                        >
                                            <Trash2 className="h-4 w-4 text-destructive" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </TabsContent>

                    {/* Event-specific fields */}
                    <TabsContent value="EVENT" className="space-y-4 mt-4">
                        <div className="grid gap-2">
                            <Label htmlFor="notes">Заметки</Label>
                            <Textarea
                                id="notes"
                                placeholder="Дополнительная информация..."
                                value={form.notes}
                                onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))}
                            />
                        </div>
                    </TabsContent>

                    {/* Break - no extra fields */}
                    <TabsContent value="BREAK" className="mt-4">
                        <p className="text-sm text-muted-foreground">
                            Перерыв — простой блок для отдыха между занятиями.
                        </p>
                    </TabsContent>
                </Tabs>

                <DialogFooter className="mt-6">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Отмена
                    </Button>
                    <Button onClick={handleSubmit} disabled={!form.title.trim() || loading}>
                        {loading ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                Создание...
                            </>
                        ) : (
                            <>
                                <Plus className="h-4 w-4 mr-2" />
                                Создать
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
