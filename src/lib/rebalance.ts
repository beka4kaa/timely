/**
 * Rebalancing Algorithm for Learning Programs
 * 
 * This module handles automatic adjustment of topic schedules to meet deadlines.
 */

export interface TopicPlanData {
    id: string
    plannedWeek: number
    estimatedHours: number
    priority: number
    deadline: Date | null
    isFlexible: boolean
    manuallyMoved: boolean
    status: string
    topic: {
        id: string
        name: string
        subject: {
            id: string
            name: string
        }
    }
}

export interface RebalanceResult {
    success: boolean
    changes: Array<{
        topicPlanId: string
        topicName: string
        oldWeek: number
        newWeek: number
        reason: string
    }>
    conflicts: Array<{
        topicPlanId: string
        topicName: string
        deadline: Date
        latestPossibleWeek: number
        currentWeek: number
        message: string
    }>
    hoursPerWeek: Record<number, number> // week -> total hours
}

export interface RebalanceOptions {
    maxHoursPerWeek: number
    totalWeeks: number
    programStartDate: Date
}

/**
 * Calculate which week a date falls into
 */
function getWeekForDate(startDate: Date, targetDate: Date): number {
    const msPerWeek = 7 * 24 * 60 * 60 * 1000
    const diff = targetDate.getTime() - startDate.getTime()
    return Math.floor(diff / msPerWeek) + 1
}

/**
 * Calculate hours per week from topic plans
 */
function calculateHoursPerWeek(topicPlans: TopicPlanData[]): Record<number, number> {
    const hours: Record<number, number> = {}
    for (const plan of topicPlans) {
        if (plan.status === 'COMPLETED' || plan.status === 'SKIPPED') continue
        hours[plan.plannedWeek] = (hours[plan.plannedWeek] || 0) + plan.estimatedHours
    }
    return hours
}

/**
 * Rebalance topic plans to meet deadlines
 */
export function rebalanceProgram(
    topicPlans: TopicPlanData[],
    options: RebalanceOptions
): RebalanceResult {
    const result: RebalanceResult = {
        success: true,
        changes: [],
        conflicts: [],
        hoursPerWeek: {}
    }

    // Sort by: manually moved first (locked), then by deadline (earliest first), then by priority (high first)
    const sortedPlans = [...topicPlans].sort((a, b) => {
        // Manually moved topics come first (they're locked)
        if (a.manuallyMoved && !b.manuallyMoved) return -1
        if (!a.manuallyMoved && b.manuallyMoved) return 1

        // Then sort by deadline (earliest first)
        if (a.deadline && b.deadline) {
            return a.deadline.getTime() - b.deadline.getTime()
        }
        if (a.deadline && !b.deadline) return -1
        if (!a.deadline && b.deadline) return 1

        // Then by priority (higher first)
        return b.priority - a.priority
    })

    // Track hours per week
    const weekHours: Record<number, number> = {}

    // First pass: Lock manually moved topics
    const lockedTopics = sortedPlans.filter(p => p.manuallyMoved || !p.isFlexible)
    for (const plan of lockedTopics) {
        weekHours[plan.plannedWeek] = (weekHours[plan.plannedWeek] || 0) + plan.estimatedHours
    }

    // Second pass: Process flexible topics with deadlines
    const flexibleTopics = sortedPlans.filter(p => !p.manuallyMoved && p.isFlexible)

    for (const plan of flexibleTopics) {
        if (plan.status === 'COMPLETED' || plan.status === 'SKIPPED') continue

        let targetWeek = plan.plannedWeek

        // Check if there's a deadline
        if (plan.deadline) {
            const deadlineWeek = getWeekForDate(options.programStartDate, plan.deadline)

            // Topic must be completed by deadline week
            if (plan.plannedWeek > deadlineWeek) {
                // Need to move earlier
                targetWeek = deadlineWeek

                // Find earliest week with capacity
                for (let week = 1; week <= deadlineWeek; week++) {
                    const currentHours = weekHours[week] || 0
                    if (currentHours + plan.estimatedHours <= options.maxHoursPerWeek) {
                        targetWeek = week
                        break
                    }
                }

                // Check if we can fit it
                if (targetWeek > deadlineWeek) {
                    // Can't meet deadline - report conflict
                    result.conflicts.push({
                        topicPlanId: plan.id,
                        topicName: plan.topic.name,
                        deadline: plan.deadline,
                        latestPossibleWeek: deadlineWeek,
                        currentWeek: plan.plannedWeek,
                        message: `Cannot fit "${plan.topic.name}" before deadline. Consider extending hours or moving deadline.`
                    })
                    result.success = false
                }
            }
        } else {
            // No deadline - find best week with capacity
            let bestWeek = plan.plannedWeek
            const currentHours = weekHours[bestWeek] || 0

            if (currentHours + plan.estimatedHours > options.maxHoursPerWeek) {
                // Find alternative week
                for (let week = 1; week <= options.totalWeeks; week++) {
                    const hours = weekHours[week] || 0
                    if (hours + plan.estimatedHours <= options.maxHoursPerWeek) {
                        bestWeek = week
                        break
                    }
                }
            }

            targetWeek = bestWeek
        }

        // Record change if week changed
        if (targetWeek !== plan.plannedWeek) {
            result.changes.push({
                topicPlanId: plan.id,
                topicName: plan.topic.name,
                oldWeek: plan.plannedWeek,
                newWeek: targetWeek,
                reason: plan.deadline
                    ? `Moved to meet deadline (week ${getWeekForDate(options.programStartDate, plan.deadline)})`
                    : 'Rebalanced for capacity'
            })
        }

        // Update week hours
        weekHours[targetWeek] = (weekHours[targetWeek] || 0) + plan.estimatedHours
    }

    result.hoursPerWeek = weekHours

    return result
}

/**
 * Apply rebalance changes to database
 */
export async function applyRebalanceChanges(
    prisma: any,
    changes: RebalanceResult['changes']
): Promise<void> {
    for (const change of changes) {
        await prisma.topicPlan.update({
            where: { id: change.topicPlanId },
            data: { plannedWeek: change.newWeek }
        })
    }
}
