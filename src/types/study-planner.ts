// Study Planner Types

export type BlockType = 'LESSON' | 'EVENT' | 'BREAK'
export type BlockStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE' | 'SKIPPED'
export type SegmentStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'DONE'

export interface Segment {
    id: string
    blockId: string
    title: string
    durationMinutes: number
    status: SegmentStatus
    orderIndex: number
}

export interface Subtask {
    id: string
    blockId: string
    title: string
    isDone: boolean
    orderIndex: number
}

export interface TimerState {
    id: string
    blockId: string
    segmentIndex: number | null
    startedAt: string | null
    remainingSeconds: number
    isRunning: boolean
}

export interface Block {
    id: string
    dayPlanId: string
    type: BlockType
    title: string
    durationMinutes: number
    startTime: string | null
    status: BlockStatus
    orderIndex: number
    notes: string | null
    color: string
    segments: Segment[]
    subtasks: Subtask[]
    timerState: TimerState | null
    createdAt: string
    updatedAt: string
}

export interface DayPlan {
    id: string
    date: string
    blocks: Block[]
    createdAt: string
    updatedAt: string
}

// Form types for creating blocks
export interface CreateBlockForm {
    type: BlockType
    title: string
    durationMinutes: number
    startTime?: string
    notes?: string
    color: string
    segments: { title: string; durationMinutes: number }[]
    subtasks: { title: string }[]
}

// Helper to get status color
export function getStatusColor(status: BlockStatus | SegmentStatus): string {
    switch (status) {
        case 'NOT_STARTED':
            return 'text-muted-foreground'
        case 'IN_PROGRESS':
            return 'text-amber-500'
        case 'DONE':
            return 'text-emerald-500'
        case 'SKIPPED':
            return 'text-gray-400'
        default:
            return 'text-muted-foreground'
    }
}

// Helper to get status label
export function getStatusLabel(status: BlockStatus | SegmentStatus): string {
    switch (status) {
        case 'NOT_STARTED':
            return 'Не начат'
        case 'IN_PROGRESS':
            return 'В процессе'
        case 'DONE':
            return 'Завершён'
        case 'SKIPPED':
            return 'Пропущен'
        default:
            return status
    }
}

// Helper to format time
export function formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes} мин`
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    if (mins === 0) return `${hours} ч`
    return `${hours} ч ${mins} мин`
}

// Helper to format timer
export function formatTimer(seconds: number): string {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    if (h > 0) {
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
    }
    return `${m}:${s.toString().padStart(2, '0')}`
}

// Calculate block progress
export function calculateBlockProgress(block: Block): number {
    if (block.status === 'DONE') return 100
    if (block.status === 'SKIPPED') return 0

    if (block.segments.length > 0) {
        const doneSegments = block.segments.filter(s => s.status === 'DONE').length
        return Math.round((doneSegments / block.segments.length) * 100)
    }

    if (block.subtasks.length > 0) {
        const doneSubtasks = block.subtasks.filter(s => s.isDone).length
        return Math.round((doneSubtasks / block.subtasks.length) * 100)
    }

    return block.status === 'IN_PROGRESS' ? 50 : 0
}

// Block type colors and icons
export const BLOCK_TYPE_CONFIG = {
    LESSON: { label: 'Урок', emoji: '📚', defaultColor: '#8b5cf6' },
    EVENT: { label: 'Событие', emoji: '📅', defaultColor: '#3b82f6' },
    BREAK: { label: 'Перерыв', emoji: '☕', defaultColor: '#10b981' },
} as const

// Default segments for lessons
export const DEFAULT_LESSON_SEGMENTS = [
    { title: 'Теория', durationMinutes: 45 },
    { title: 'Практика', durationMinutes: 45 },
]

// Default subtasks for lessons
export const DEFAULT_LESSON_SUBTASKS = [
    { title: 'Прочитать материал' },
    { title: 'Сделать упражнения' },
    { title: 'Повторить ключевые моменты' },
]
