import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { z } from 'zod'

// Validation schema for creating a block
const createBlockSchema = z.object({
    dayPlanId: z.string(),
    type: z.enum(['LESSON', 'EVENT', 'BREAK']),
    title: z.string().min(1, 'Title is required'),
    durationMinutes: z.number().positive('Duration must be positive'),
    startTime: z.string().optional().nullable(),
    notes: z.string().optional().nullable(),
    color: z.string().optional(),
    segments: z.array(z.object({
        title: z.string(),
        durationMinutes: z.number().positive(),
    })).optional(),
    subtasks: z.array(z.object({
        title: z.string(),
    })).optional(),
})

// GET /api/blocks - Get blocks for a day plan
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url)
        const dayPlanId = searchParams.get('dayPlanId')

        if (!dayPlanId) {
            return NextResponse.json({ error: 'dayPlanId is required' }, { status: 400 })
        }

        const blocks = await prisma.block.findMany({
            where: { dayPlanId },
            orderBy: { orderIndex: 'asc' },
            include: {
                segments: { orderBy: { orderIndex: 'asc' } },
                subtasks: { orderBy: { orderIndex: 'asc' } },
                timerState: true,
            },
        })

        return NextResponse.json(blocks)
    } catch (error) {
        console.error('Error fetching blocks:', error)
        return NextResponse.json({ error: 'Failed to fetch blocks' }, { status: 500 })
    }
}

// POST /api/blocks - Create a new block
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const validation = createBlockSchema.safeParse(body)

        if (!validation.success) {
            return NextResponse.json(
                { error: 'Validation failed', details: validation.error.errors },
                { status: 400 }
            )
        }

        const { dayPlanId, type, title, durationMinutes, startTime, notes, color, segments, subtasks } = validation.data

        // Get the highest orderIndex for this day plan
        const lastBlock = await prisma.block.findFirst({
            where: { dayPlanId },
            orderBy: { orderIndex: 'desc' },
        })
        const orderIndex = (lastBlock?.orderIndex ?? -1) + 1

        const block = await prisma.block.create({
            data: {
                dayPlanId,
                type,
                title,
                durationMinutes,
                startTime,
                notes,
                color: color || '#3b82f6',
                orderIndex,
                segments: segments ? {
                    create: segments.map((seg, idx) => ({
                        title: seg.title,
                        durationMinutes: seg.durationMinutes,
                        orderIndex: idx,
                    })),
                } : undefined,
                subtasks: subtasks ? {
                    create: subtasks.map((sub, idx) => ({
                        title: sub.title,
                        orderIndex: idx,
                    })),
                } : undefined,
            },
            include: {
                segments: { orderBy: { orderIndex: 'asc' } },
                subtasks: { orderBy: { orderIndex: 'asc' } },
                timerState: true,
            },
        })

        return NextResponse.json(block, { status: 201 })
    } catch (error) {
        console.error('Error creating block:', error)
        return NextResponse.json({ error: 'Failed to create block' }, { status: 500 })
    }
}
