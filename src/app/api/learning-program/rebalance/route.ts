import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { z } from 'zod'
import { rebalanceProgram, applyRebalanceChanges, TopicPlanData } from '@/lib/rebalance'

export const dynamic = 'force-dynamic'

const rebalanceSchema = z.object({
    programId: z.string(),
    maxHoursPerWeek: z.number().min(1).max(60).default(20),
    applyChanges: z.boolean().default(false), // If true, apply changes to DB
})

// POST /api/learning-program/rebalance
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { programId, maxHoursPerWeek, applyChanges } = rebalanceSchema.parse(body)

        // Get program with topic plans
        const program = await prisma.learningProgram.findUnique({
            where: { id: programId },
            include: {
                topicPlans: {
                    include: {
                        topic: {
                            include: {
                                subject: true
                            }
                        }
                    }
                }
            }
        })

        if (!program) {
            return NextResponse.json({ error: 'Program not found' }, { status: 404 })
        }

        // Convert to TopicPlanData format
        const topicPlansData: TopicPlanData[] = program.topicPlans.map(tp => ({
            id: tp.id,
            plannedWeek: tp.plannedWeek,
            estimatedHours: tp.estimatedHours,
            priority: tp.priority,
            deadline: tp.deadline,
            isFlexible: tp.isFlexible,
            manuallyMoved: tp.manuallyMoved,
            status: tp.status,
            topic: {
                id: tp.topic.id,
                name: tp.topic.name,
                subject: {
                    id: tp.topic.subject.id,
                    name: tp.topic.subject.name
                }
            }
        }))

        // Run rebalancing
        const result = rebalanceProgram(topicPlansData, {
            maxHoursPerWeek,
            totalWeeks: program.totalWeeks,
            programStartDate: new Date(program.startDate)
        })

        // Apply changes if requested
        if (applyChanges && result.changes.length > 0) {
            await applyRebalanceChanges(prisma, result.changes)
        }

        return NextResponse.json({
            success: result.success,
            changesCount: result.changes.length,
            conflictsCount: result.conflicts.length,
            changes: result.changes,
            conflicts: result.conflicts,
            hoursPerWeek: result.hoursPerWeek,
            applied: applyChanges
        })

    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 400 })
        }
        console.error('Error rebalancing program:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
