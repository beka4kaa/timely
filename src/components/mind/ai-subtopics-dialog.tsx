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
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Loader2, Sparkles } from 'lucide-react'
import { toast } from "sonner"
import { DetailLevel, SUBTOPIC_LIMITS } from '@/lib/srs'

interface AISubtopicsDialogProps {
    topicId: string
    topicName: string
    open: boolean
    onOpenChange: (open: boolean) => void
    onSubtopicsAdded: () => void
}

export function AISubtopicsDialog({
    topicId,
    topicName,
    open,
    onOpenChange,
    onSubtopicsAdded
}: AISubtopicsDialogProps) {
    const [text, setText] = useState('')
    const [detailLevel, setDetailLevel] = useState<DetailLevel>('MED')
    const [loading, setLoading] = useState(false)

    const handleGenerate = async () => {
        setLoading(true)
        try {
            const res = await fetch('/api/ai/generate-subtopics', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    topicId,
                    text: text.trim() || undefined,
                    detailLevel
                })
            })

            if (res.ok) {
                const data = await res.json()
                toast.success(`Generated ${data.count} subtopics!`)
                setText('')
                onOpenChange(false)
                onSubtopicsAdded()
            } else {
                toast.error('Failed to generate subtopics')
            }
        } catch (error) {
            console.error(error)
            toast.error('Error generating subtopics')
        } finally {
            setLoading(false)
        }
    }

    const limits = SUBTOPIC_LIMITS[detailLevel]

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Sparkles className="h-5 w-5 text-purple-500" />
                        AI Generate Subtopics
                    </DialogTitle>
                    <DialogDescription>
                        Generate subtopics for &quot;{topicName}&quot; from text or automatically.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label>Detail Level</Label>
                        <Select value={detailLevel} onValueChange={(v) => setDetailLevel(v as DetailLevel)}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="LOW">Low ({SUBTOPIC_LIMITS.LOW.min}-{SUBTOPIC_LIMITS.LOW.max} subtopics)</SelectItem>
                                <SelectItem value="MED">Medium ({SUBTOPIC_LIMITS.MED.min}-{SUBTOPIC_LIMITS.MED.max} subtopics)</SelectItem>
                                <SelectItem value="HIGH">High ({SUBTOPIC_LIMITS.HIGH.min}-{SUBTOPIC_LIMITS.HIGH.max} subtopics)</SelectItem>
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            Will generate {limits.min}-{limits.max} subtopics
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="text">Source Text (Optional)</Label>
                        <Textarea
                            id="text"
                            placeholder="Paste outline, bullet points, or table of contents...&#10;Leave empty to auto-generate."
                            className="min-h-[120px]"
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                            Each line becomes a subtopic. List prefixes (-, •, 1.) are removed.
                        </p>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleGenerate}
                        disabled={loading}
                        className="bg-purple-600 hover:bg-purple-700"
                    >
                        {loading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                            <>
                                <Sparkles className="h-4 w-4 mr-2" />
                                Generate
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
