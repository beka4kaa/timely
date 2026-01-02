/**
 * Spaced Repetition System (SRS) Utilities
 * 
 * Implements a simplified SM-2 algorithm for scheduling reviews.
 */

export type SrsRating = 'AGAIN' | 'HARD' | 'GOOD' | 'EASY'

export interface SrsResult {
    intervalDays: number
    mastery: number
    nextReviewAt: Date
    lastReviewedAt: Date
}

/**
 * Calculate new SRS state based on rating
 * 
 * @param rating - User's rating of recall quality
 * @param currentIntervalDays - Current interval (null for first review)
 * @param currentMastery - Current mastery level (0-100)
 * @returns New SRS state values
 */
export function applySrs(
    rating: SrsRating,
    currentIntervalDays?: number | null,
    currentMastery: number = 0
): SrsResult {
    let intervalDays: number
    let masteryDelta: number

    // Calculate new interval
    if (!currentIntervalDays) {
        // First review - use base intervals
        const baseIntervals: Record<SrsRating, number> = {
            AGAIN: 1,
            HARD: 2,
            GOOD: 4,
            EASY: 7,
        }
        intervalDays = baseIntervals[rating]
    } else {
        // Subsequent reviews - multiply by factors
        const intervalFactors: Record<SrsRating, number> = {
            AGAIN: 0,      // Reset to 1
            HARD: 0.6,
            GOOD: 1.7,
            EASY: 2.5,
        }

        const factor = intervalFactors[rating]

        if (rating === 'AGAIN') {
            intervalDays = 1
        } else {
            const minIntervals: Record<SrsRating, number> = {
                AGAIN: 1,
                HARD: 1,
                GOOD: 2,
                EASY: 7,
            }
            intervalDays = Math.max(
                minIntervals[rating],
                Math.floor(currentIntervalDays * factor)
            )
        }
    }

    // Calculate mastery adjustment
    const masteryDeltas: Record<SrsRating, number> = {
        AGAIN: -10,
        HARD: 0,
        GOOD: 5,
        EASY: 10,
    }
    masteryDelta = masteryDeltas[rating]
    const mastery = Math.max(0, Math.min(100, currentMastery + masteryDelta))

    // Calculate next review date
    const now = new Date()
    const nextReviewAt = new Date(now)
    nextReviewAt.setDate(nextReviewAt.getDate() + intervalDays)
    nextReviewAt.setHours(0, 0, 0, 0) // Start of day

    return {
        intervalDays,
        mastery,
        nextReviewAt,
        lastReviewedAt: now,
    }
}

/**
 * Format interval days as human-readable string
 */
export function formatInterval(days: number | null | undefined): string {
    if (!days) return '—'
    if (days === 1) return '1d'
    if (days < 7) return `${days}d`
    if (days < 30) return `${Math.floor(days / 7)}w`
    return `${Math.floor(days / 30)}m`
}

/**
 * Check if a date is due (today or earlier)
 */
export function isDue(date: Date | string | null | undefined): boolean {
    if (!date) return false
    const d = new Date(date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return d <= today
}

/**
 * Check if a date is overdue (before today)
 */
export function isOverdue(date: Date | string | null | undefined): boolean {
    if (!date) return false
    const d = new Date(date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    d.setHours(0, 0, 0, 0)
    return d < today
}

/**
 * Get mastery color class based on percentage
 */
export function getMasteryColor(mastery: number): string {
    if (mastery >= 80) return 'text-emerald-400'
    if (mastery >= 60) return 'text-blue-400'
    if (mastery >= 40) return 'text-amber-400'
    if (mastery >= 20) return 'text-orange-400'
    return 'text-red-400'
}

/**
 * Detail level for subtopic generation
 */
export type DetailLevel = 'LOW' | 'MED' | 'HIGH'

export const SUBTOPIC_LIMITS: Record<DetailLevel, { min: number; max: number }> = {
    LOW: { min: 4, max: 6 },
    MED: { min: 6, max: 8 },
    HIGH: { min: 8, max: 12 },
}

export const SUBTOPIC_HARD_CAP = 12
