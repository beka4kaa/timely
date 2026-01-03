// Mind Learning System Types

export type TopicStatus = 'NOT_STARTED' | 'MEDIUM' | 'SUCCESS' | 'MASTERED'
export type StudyState = 'STUDIED' | 'NOT_STUDIED'
export type ReviewRating = 'AGAIN' | 'HARD' | 'GOOD' | 'EASY'

export interface Subject {
    id: string
    name: string
    emoji: string
    color: string
    targetHoursWeek: number
    textbookUrl: string | null
    topics: Topic[]
    createdAt: string
    updatedAt: string
}

export interface Topic {
    id: string
    subjectId: string
    subject?: Subject | string  // Can be Subject object or just ID string
    subjectName?: string        // Subject name from API
    subjectEmoji?: string       // Subject emoji from API
    subjectColor?: string       // Subject color from API
    name: string
    status: TopicStatus
    studyState: StudyState
    picked: boolean
    archived: boolean
    lastRevisedAt: string | null
    nextReviewAt: string | null
    intervalDays: number | null
    easeFactor: number
    reviewLogs?: ReviewLog[]
    createdAt: string
    updatedAt: string
}

export interface ReviewLog {
    id: string
    topicId: string
    topic?: Topic
    rating: ReviewRating
    reviewedAt: string
    intervalDaysAfter: number
}

export interface MindSession {
    id: string
    taskName: string
    topicId: string | null
    topic?: Topic | null
    startedAt: string
    endedAt: string | null
    breaksMinutes: number
    totalMinutes: number | null
}

// Form types
export interface CreateSubjectForm {
    name: string
    emoji: string
    color: string
    targetHoursWeek: number
}

export interface CreateTopicForm {
    subjectId: string
    name: string
    status?: TopicStatus
    picked?: boolean
}

// Spaced repetition helpers
export function calculateNextReview(
    rating: ReviewRating,
    currentInterval: number | null
): { intervalDays: number; nextReviewAt: Date } {
    let newInterval: number

    switch (rating) {
        case 'AGAIN':
            newInterval = 1
            break
        case 'HARD':
            newInterval = Math.max(1, Math.floor((currentInterval || 2) * 0.6))
            break
        case 'GOOD':
            newInterval = Math.max(2, Math.floor((currentInterval || 2) * 1.7))
            break
        case 'EASY':
            newInterval = Math.max(7, Math.floor((currentInterval || 4) * 2.5))
            break
    }

    const nextReviewAt = new Date()
    nextReviewAt.setDate(nextReviewAt.getDate() + newInterval)

    return { intervalDays: newInterval, nextReviewAt }
}

// Status helpers
export function getTopicStatusColor(status: TopicStatus): string {
    switch (status) {
        case 'NOT_STARTED':
            return 'bg-gray-500/20 text-gray-400'
        case 'MEDIUM':
            return 'bg-amber-500/20 text-amber-400'
        case 'SUCCESS':
            return 'bg-emerald-500/20 text-emerald-400'
        case 'MASTERED':
            return 'bg-purple-500/20 text-purple-400'
    }
}

export function getTopicStatusLabel(status: TopicStatus): string {
    switch (status) {
        case 'NOT_STARTED':
            return 'Не начато'
        case 'MEDIUM':
            return 'Знаю немного'
        case 'SUCCESS':
            return 'Знаю хорошо'
        case 'MASTERED':
            return 'Мастерство'
    }
}

// Time helpers
export function formatInterval(days: number | null): string {
    if (days === null) return '—'
    if (days === 1) return '1 день'
    if (days < 7) return `${days} дней`
    if (days < 30) {
        const weeks = Math.floor(days / 7)
        return weeks === 1 ? '1 неделя' : `${weeks} недель`
    }
    const months = Math.floor(days / 30)
    return months === 1 ? '1 месяц' : `${months} месяцев`
}

export function formatDaysPast(lastRevisedAt: string | null): string {
    if (!lastRevisedAt) return '—'
    const last = new Date(lastRevisedAt)
    const now = new Date()
    const diffMs = now.getTime() - last.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return 'сегодня'
    if (diffDays === 1) return 'вчера'
    return `${diffDays} дн. назад`
}

export function isDueToday(nextReviewAt: string | null): boolean {
    if (!nextReviewAt) return false
    const next = new Date(nextReviewAt)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    next.setHours(0, 0, 0, 0)
    return next <= today
}

export function isOverdue(nextReviewAt: string | null): boolean {
    if (!nextReviewAt) return false
    const next = new Date(nextReviewAt)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    next.setHours(0, 0, 0, 0)
    return next < today
}

// Default colors for subjects
export const SUBJECT_COLORS = [
    '#8b5cf6', // purple
    '#3b82f6', // blue
    '#10b981', // green
    '#f59e0b', // amber
    '#ef4444', // red
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#6366f1', // indigo
]

export const SUBJECT_EMOJIS = [
    '📚', '⚛️', '📐', '🔢', '🧪', '🌍', '📖', '💻', '🎨', '🎵', '🏃', '🧠'
]
