"use client"

import { useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Wand2, Loader2, Sparkles } from 'lucide-react'
import { toast } from "sonner"
import { cn } from '@/lib/utils'

interface FastTopicAddProps {
    subjectId: string
    subjectName: string
    onTopicsAdded: () => void
    trigger?: React.ReactNode
}

export function FastTopicAddDialog({ subjectId, subjectName, onTopicsAdded, trigger }: FastTopicAddProps) {
    const [open, setOpen] = useState(false)
    const [text, setText] = useState('')
    const [loading, setLoading] = useState(false)

    const handleGenerate = async () => {
        if (!text.trim()) return

        setLoading(true)
        try {
            const res = await fetch('/api/ai/fast-topics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subjectId, text })
            })

            if (!res.ok) throw new Error('Failed to generate topics')

            const data = await res.json()

            toast.success("✨ Темы добавлены!", {
                description: `Добавлено ${data.topics.length} новых тем`,
            })

            setText('')
            setOpen(false)
            onTopicsAdded()

        } catch (error) {
            console.error(error)
            toast.error("Ошибка", {
                description: "Не удалось сгенерировать темы. Попробуйте еще раз.",
            })
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {trigger || (
                    <Button variant="outline" size="sm" className="gap-2">
                        <Wand2 className="h-4 w-4 text-purple-500" />
                        AI Add
                    </Button>
                )}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-purple-500" />
                        Быстрое добавление тем
                    </DialogTitle>
                    <DialogDescription>
                        Вставьте список тем, план урока или описание задач. AI сам создаст структурированные темы для {subjectName}.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <Textarea
                        placeholder="Пример: 
- Основы кинематики
- Законы Ньютона
- Работа и энергия
Или просто описание того что нужно изучить..."
                        className="min-h-[150px]"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                    />
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button>
                    <Button
                        onClick={handleGenerate}
                        disabled={!text.trim() || loading}
                        className="bg-purple-600 hover:bg-purple-700 text-white"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Генерация...
                            </>
                        ) : (
                            <>
                                <Wand2 className="mr-2 h-4 w-4" />
                                Сгенерировать
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
