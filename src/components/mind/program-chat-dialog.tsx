"use client"

import { useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { MessageSquare, Wand2, Loader2, Send } from 'lucide-react'
import { toast } from "sonner"

interface ProgramChatDialogProps {
    programId: string
    onProgramUpdated: () => void
}

export function ProgramChatDialog({ programId, onProgramUpdated }: ProgramChatDialogProps) {
    const [open, setOpen] = useState(false)
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [lastResponse, setLastResponse] = useState<string | null>(null)

    const handleSend = async () => {
        if (!input.trim()) return

        setLoading(true)
        try {
            const res = await fetch('/api/ai/modify-program', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ programId, instruction: input })
            })

            if (!res.ok) throw new Error('Failed to modify program')

            const data = await res.json()

            setLastResponse(data.message)
            toast.success("Программа обновлена!")

            setInput('')
            onProgramUpdated()

        } catch (error) {
            console.error(error)
            toast.error("Ошибка обновления")
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="gap-2">
                    <MessageSquare className="h-4 w-4 text-purple-500" />
                    Изменить программу
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Wand2 className="h-5 w-5 text-purple-500" />
                        AI Редактор Программы
                    </DialogTitle>
                    <DialogDescription>
                        Напишите, что нужно изменить. Например: &quot;Перенеси физику на начало недели&quot; или &quot;Сделай упор на математику&quot;.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    {lastResponse && (
                        <div className="bg-muted/50 p-3 rounded-lg text-sm italic">
                            AI: &quot;{lastResponse}&quot;
                        </div>
                    )}

                    <Textarea
                        placeholder="Ваш запрос..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        className="min-h-[100px]"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                handleSend()
                            }
                        }}
                    />
                </div>

                <DialogFooter>
                    <Button
                        onClick={handleSend}
                        disabled={!input.trim() || loading}
                        className="w-full bg-gradient-to-r from-purple-600 to-blue-600"
                    >
                        {loading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <>
                                <Send className="h-4 w-4 mr-2" />
                                Отправить
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
