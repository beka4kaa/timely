import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// POST /api/dayplans/[date]/copy - Copy blocks from another date
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ date: string }> }
) {
    try {
        const { date: targetDate } = await params
        const body = await request.json()
        const { sourceDate } = body

        if (!sourceDate) {
            return NextResponse.json({ error: 'sourceDate is required' }, { status: 400 })
        }

        // Get source day plan with all blocks
        const sourcePlan = await prisma.dayPlan.findUnique({
            where: { date: sourceDate },
            include: {
                blocks: {
                    orderBy: { orderIndex: 'asc' },
                    include: {
                        segments: { orderBy: { orderIndex: 'asc' } },
                        subtasks: { orderBy: { orderIndex: 'asc' } },
                    },
                },
            },
        })

        if (!sourcePlan) {
            return NextResponse.json({ error: 'Source day plan not found' }, { status: 404 })
        }

        // Get or create target day plan
        let targetPlan = await prisma.dayPlan.findUnique({
            where: { date: targetDate },
        })

        if (!targetPlan) {
            targetPlan = await prisma.dayPlan.create({
                data: { date: targetDate },
            })
        }

        // Copy each block with segments and subtasks
        for (const block of sourcePlan.blocks) {
            await prisma.block.create({
                data: {
                    dayPlanId: targetPlan.id,
                    type: block.type,
                    title: block.title,
                    durationMinutes: block.durationMinutes,
                    startTime: block.startTime,
                    status: 'NOT_STARTED', // Reset status
                    orderIndex: block.orderIndex,
                    notes: block.notes,
                    color: block.color,
                    segments: {
                        create: block.segments.map((seg) => ({
                            title: seg.title,
                            durationMinutes: seg.durationMinutes,
                            status: 'NOT_STARTED',
                            orderIndex: seg.orderIndex,
                        })),
                    },
                    subtasks: {
                        create: block.subtasks.map((sub) => ({
                            title: sub.title,
                            isDone: false,
                            orderIndex: sub.orderIndex,
                        })),
                    },
                },
            })
        }

        // Fetch and return the updated target plan
        const updatedPlan = await prisma.dayPlan.findUnique({
            where: { date: targetDate },
            include: {
                blocks: {
                    orderBy: { orderIndex: 'asc' },
                    include: {
                        segments: { orderBy: { orderIndex: 'asc' } },
                        subtasks: { orderBy: { orderIndex: 'asc' } },
                        timerState: true,
                    },
                },
            },
        })

        return NextResponse.json(updatedPlan)
    } catch (error) {
        console.error('Error copying day plan:', error)
        return NextResponse.json({ error: 'Failed to copy day plan' }, { status: 500 })
    }
}
