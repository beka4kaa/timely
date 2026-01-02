"use client"

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Loader2, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SUBJECT_COLORS, SUBJECT_EMOJIS, Subject } from '@/types/mind'

interface AddSubjectDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSubjectAdded: (subject: Subject) => void
}

export function AddSubjectDialog({ open, onOpenChange, onSubjectAdded }: AddSubjectDialogProps) {
    const [loading, setLoading] = useState(false)
    const [name, setName] = useState('')
    const [emoji, setEmoji] = useState('📚')
    const [color, setColor] = useState('#8b5cf6')
    const [targetHoursWeek, setTargetHoursWeek] = useState(5)

    const handleSubmit = async () => {
        if (!name.trim()) return

        setLoading(true)
        try {
            const response = await fetch('/api/subjects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name.trim(),
                    emoji,
                    color,
                    targetHoursWeek,
                }),
            })

            if (response.ok) {
                const subject = await response.json()
                onSubjectAdded(subject)
                resetForm()
                onOpenChange(false)
            }
        } catch (error) {
            console.error('Error creating subject:', error)
        } finally {
            setLoading(false)
        }
    }

    const resetForm = () => {
        setName('')
        setEmoji('📚')
        setColor('#8b5cf6')
        setTargetHoursWeek(5)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Новый предмет</DialogTitle>
                    <DialogDescription>
                        Добавьте предмет для изучения
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="grid gap-2">
                        <Label htmlFor="name">Название</Label>
                        <Input
                            id="name"
                            placeholder="A Level Physics"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label>Эмодзи</Label>
                        <div className="flex flex-wrap gap-2">
                            {SUBJECT_EMOJIS.map((e) => (
                                <button
                                    key={e}
                                    className={cn(
                                        "w-10 h-10 rounded-lg border-2 text-xl flex items-center justify-center transition-all",
                                        emoji === e ? "border-primary bg-primary/10" : "border-transparent bg-muted hover:bg-muted/80"
                                    )}
                                    onClick={() => setEmoji(e)}
                                >
                                    {e}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <Label>Цвет</Label>
                        <div className="flex gap-2">
                            {SUBJECT_COLORS.map((c) => (
                                <button
                                    key={c}
                                    className={cn(
                                        "w-8 h-8 rounded-full border-2 transition-transform",
                                        color === c ? "border-foreground scale-110" : "border-transparent"
                                    )}
                                    style={{ backgroundColor: c }}
                                    onClick={() => setColor(c)}
                                />
                            ))}
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="hours">Целевые часы в неделю</Label>
                        <Input
                            id="hours"
                            type="number"
                            min={1}
                            max={40}
                            value={targetHoursWeek}
                            onChange={(e) => setTargetHoursWeek(parseInt(e.target.value) || 1)}
                        />
                    </div>
                </div>

                <DialogFooter className="mt-4">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Отмена
                    </Button>
                    <Button onClick={handleSubmit} disabled={!name.trim() || loading}>
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
