"use client"

import { useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Plus } from 'lucide-react'
import { toast } from "sonner"

interface AddSubtopicDialogProps {
    topicId: string
    topicName: string
    open: boolean
    onOpenChange: (open: boolean) => void
    onSubtopicAdded: () => void
}

export function AddSubtopicDialog({
    topicId,
    topicName,
    open,
    onOpenChange,
    onSubtopicAdded
}: AddSubtopicDialogProps) {
    const [title, setTitle] = useState('')
    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!title.trim()) return

        setLoading(true)
        try {
            const res = await fetch('/api/subtopics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ topicId, title: title.trim() })
            })

            if (res.ok) {
                toast.success('Subtopic added!')
                setTitle('')
                onOpenChange(false)
                onSubtopicAdded()
            } else {
                toast.error('Failed to add subtopic')
            }
        } catch (error) {
            console.error(error)
            toast.error('Error adding subtopic')
        } finally {
            setLoading(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[400px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Plus className="h-5 w-5" />
                        Add Subtopic
                    </DialogTitle>
                    <DialogDescription>
                        Add a new subtopic to &quot;{topicName}&quot;
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit}>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="title">Subtopic Title</Label>
                            <Input
                                id="title"
                                placeholder="e.g., Wave interference patterns"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                autoFocus
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button type="submit" disabled={!title.trim() || loading}>
                            {loading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <>
                                    <Plus className="h-4 w-4 mr-2" />
                                    Add
                                </>
                            )}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
