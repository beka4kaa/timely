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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Loader2, Plus } from 'lucide-react'
import { Subject, Topic } from '@/types/mind'

interface AddTopicDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    subjects: { id: string; name: string; emoji: string }[]
    defaultSubjectId?: string
    onTopicAdded: (topic: Topic) => void
}

export function AddTopicDialog({
    open,
    onOpenChange,
    subjects,
    defaultSubjectId,
    onTopicAdded
}: AddTopicDialogProps) {
    const [loading, setLoading] = useState(false)
    const [name, setName] = useState('')
    const [subjectId, setSubjectId] = useState(defaultSubjectId || '')
    const [picked, setPicked] = useState(false)

    React.useEffect(() => {
        if (open && defaultSubjectId) {
            setSubjectId(defaultSubjectId)
        }
    }, [open, defaultSubjectId])

    const handleSubmit = async () => {
        if (!name.trim() || !subjectId) return

        setLoading(true)
        try {
            const response = await fetch('/api/topics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name.trim(),
                    subjectId,
                    picked,
                }),
            })

            if (response.ok) {
                const topic = await response.json()
                onTopicAdded(topic)
                resetForm()
                onOpenChange(false)
            }
        } catch (error) {
            console.error('Error creating topic:', error)
        } finally {
            setLoading(false)
        }
    }

    const resetForm = () => {
        setName('')
        setPicked(false)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Новая тема</DialogTitle>
                    <DialogDescription>
                        Добавьте тему для изучения
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="grid gap-2">
                        <Label htmlFor="subject">Предмет</Label>
                        <Select value={subjectId} onValueChange={setSubjectId}>
                            <SelectTrigger>
                                <SelectValue placeholder="Выберите предмет" />
                            </SelectTrigger>
                            <SelectContent>
                                {subjects.map((subject) => (
                                    <SelectItem key={subject.id} value={subject.id}>
                                        <span className="flex items-center gap-2">
                                            <span>{subject.emoji}</span>
                                            <span>{subject.name}</span>
                                        </span>
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="name">Название темы</Label>
                        <Input
                            id="name"
                            placeholder="Waves, Differentiation..."
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <Checkbox
                            id="picked"
                            checked={picked}
                            onCheckedChange={(checked) => setPicked(checked === true)}
                        />
                        <Label htmlFor="picked" className="cursor-pointer">
                            Добавить в избранное
                        </Label>
                    </div>
                </div>

                <DialogFooter className="mt-4">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Отмена
                    </Button>
                    <Button onClick={handleSubmit} disabled={!name.trim() || !subjectId || loading}>
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
