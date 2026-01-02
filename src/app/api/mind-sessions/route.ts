import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { z } from 'zod'

const createSessionSchema = z.object({
    taskName: z.string().min(1, 'Task name is required'),
    topicId: z.string().optional().nullable(),
})

const updateSessionSchema = z.object({
    endedAt: z.string().datetime().optional(),
    breaksMinutes: z.number().min(0).optional(),
})

// GET /api/mind-sessions - List study sessions
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url)
        const daysBack = parseInt(searchParams.get('days') || '7')

        const fromDate = new Date()
        fromDate.setDate(fromDate.getDate() - daysBack)

        const sessions = await prisma.mindSession.findMany({
            where: {
                startedAt: {
                    gte: fromDate,
                },
            },
            include: {
                topic: {
                    include: {
                        subject: true,
                    },
                },
            },
            orderBy: { startedAt: 'desc' },
        })

        return NextResponse.json(sessions)
    } catch (error) {
        console.error('Error fetching sessions:', error)
        return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 })
    }
}

// POST /api/mind-sessions - Start a new study session
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const validation = createSessionSchema.safeParse(body)

        if (!validation.success) {
            return NextResponse.json(
                { error: 'Validation failed', details: validation.error.errors },
                { status: 400 }
            )
        }

        const { taskName, topicId } = validation.data

        const session = await prisma.mindSession.create({
            data: {
                taskName,
                topicId: topicId || null,
                startedAt: new Date(),
            },
            include: {
                topic: {
                    include: {
                        subject: true,
                    },
                },
            },
        })

        return NextResponse.json(session, { status: 201 })
    } catch (error) {
        console.error('Error creating session:', error)
        return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
    }
}
