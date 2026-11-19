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
import { t } from '@/lib/i18n'

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
            
            // Count total subtopics
            const totalSubtopics = data.topics.reduce((sum: number, topic: any) => 
                sum + (topic.subtopics?.length || 0), 0)

            toast.success(t("✨ Темы добавлены!"), {
                description: totalSubtopics > 0 
                    ? t('Добавлено {topics} тем и {subtopics} подтем', { topics: data.topics.length, subtopics: totalSubtopics })
                    : t('Добавлено {topics} новых тем', { topics: data.topics.length }),
            })

            setText('')
            setOpen(false)
            onTopicsAdded()

        } catch (error) {
            console.error(error)
            toast.error(t("Ошибка"), {
                description: t("Не удалось сгенерировать темы. Попробуйте еще раз."),
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
                        {t('Быстрое добавление тем')}
                    </DialogTitle>
                    <DialogDescription>
                        {t('Вставьте список тем, план урока или описание задач. AI сам создаст структурированные темы для {subjectName}.', { subjectName })}
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4 py-4">
                    <Textarea
                        placeholder={t("Пример: \n- Основы кинематики\n- Законы Ньютона\n- Работа и энергия\nИли просто описание того что нужно изучить...")}
                        className="min-h-[150px]"
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                    />
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>{t('Отмена')}</Button>
                    <Button
                        onClick={handleGenerate}
                        disabled={!text.trim() || loading}
                        className="bg-purple-600 hover:bg-purple-700 text-white"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                {t('Генерация...')}
                            </>
                        ) : (
                            <>
                                <Wand2 className="mr-2 h-4 w-4" />
                                {t('Сгенерировать')}
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
