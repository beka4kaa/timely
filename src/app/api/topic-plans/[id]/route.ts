import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const updateSchema = z.object({
    plannedWeek: z.number().min(1).optional(),
    deadline: z.string().datetime().optional().nullable(),
    priority: z.number().min(1).max(5).optional(),
    isFlexible: z.boolean().optional(),
    manuallyMoved: z.boolean().optional(),
    status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED']).optional(),
})

// GET /api/topic-plans/[id] - Get single topic plan
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params

        const topicPlan = await prisma.topicPlan.findUnique({
            where: { id },
            include: {
                topic: {
                    include: {
                        subject: true
                    }
                }
            }
        })

        if (!topicPlan) {
            return NextResponse.json({ error: 'Topic plan not found' }, { status: 404 })
        }

        return NextResponse.json(topicPlan)
    } catch (error) {
        console.error('Error fetching topic plan:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

// PATCH /api/topic-plans/[id] - Update topic plan (deadline, week, priority)
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const body = await request.json()

        const validated = updateSchema.parse(body)

        // Build update data
        const updateData: Record<string, unknown> = {}

        if (validated.plannedWeek !== undefined) {
            updateData.plannedWeek = validated.plannedWeek
            updateData.manuallyMoved = true // Auto-set when week is changed
        }

        if (validated.deadline !== undefined) {
            updateData.deadline = validated.deadline ? new Date(validated.deadline) : null
        }

        if (validated.priority !== undefined) {
            updateData.priority = validated.priority
        }

        if (validated.isFlexible !== undefined) {
            updateData.isFlexible = validated.isFlexible
        }

        if (validated.manuallyMoved !== undefined) {
            updateData.manuallyMoved = validated.manuallyMoved
        }

        if (validated.status !== undefined) {
            updateData.status = validated.status
            if (validated.status === 'COMPLETED') {
                updateData.completedAt = new Date()
            }
        }

        const topicPlan = await prisma.topicPlan.update({
            where: { id },
            data: updateData,
            include: {
                topic: {
                    include: {
                        subject: true
                    }
                }
            }
        })

        return NextResponse.json(topicPlan)
    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 400 })
        }
        console.error('Error updating topic plan:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
