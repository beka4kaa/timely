import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// GET /api/dayplans/[date] - Get specific day plan
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ date: string }> }
) {
    try {
        const { date } = await params

        let dayPlan = await prisma.dayPlan.findUnique({
            where: { date },
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

        // Create empty plan if doesn't exist
        if (!dayPlan) {
            dayPlan = await prisma.dayPlan.create({
                data: { date },
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
        }

        return NextResponse.json(dayPlan)
    } catch (error) {
        console.error('Error fetching day plan:', error)
        return NextResponse.json({ error: 'Failed to fetch day plan' }, { status: 500 })
    }
}

// DELETE /api/dayplans/[date] - Delete day plan
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ date: string }> }
) {
    try {
        const { date } = await params

        await prisma.dayPlan.delete({
            where: { date },
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting day plan:', error)
        return NextResponse.json({ error: 'Failed to delete day plan' }, { status: 500 })
    }
}
