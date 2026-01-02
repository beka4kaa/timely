import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

// Validation schema
const createSubtopicSchema = z.object({
    topicId: z.string().min(1),
    title: z.string().min(1).max(200),
    orderIndex: z.number().int().min(0).optional(),
})

// GET /api/subtopics - List all subtopics (with optional topicId filter)
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url)
        const topicId = searchParams.get('topicId')

        const where = topicId ? { topicId } : {}

        const subtopics = await prisma.subtopic.findMany({
            where,
            include: {
                srsState: true,
                topic: {
                    select: {
                        id: true,
                        name: true,
                        subject: {
                            select: { id: true, name: true, emoji: true }
                        }
                    }
                }
            },
            orderBy: { orderIndex: 'asc' }
        })

        return NextResponse.json(subtopics)
    } catch (error) {
        console.error('GET /api/subtopics error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

// POST /api/subtopics - Create a new subtopic
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const parsed = createSubtopicSchema.safeParse(body)

        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.errors }, { status: 400 })
        }

        const { topicId, title, orderIndex } = parsed.data

        // Verify topic exists
        const topic = await prisma.topic.findUnique({ where: { id: topicId } })
        if (!topic) {
            return NextResponse.json({ error: 'Topic not found' }, { status: 404 })
        }

        // Get max orderIndex if not provided
        let finalOrderIndex = orderIndex
        if (finalOrderIndex === undefined) {
            const maxOrder = await prisma.subtopic.findFirst({
                where: { topicId },
                orderBy: { orderIndex: 'desc' },
                select: { orderIndex: true }
            })
            finalOrderIndex = (maxOrder?.orderIndex ?? -1) + 1
        }

        // Create subtopic with SrsState
        const subtopic = await prisma.subtopic.create({
            data: {
                topicId,
                title,
                orderIndex: finalOrderIndex,
                srsState: {
                    create: {
                        entityType: 'SUBTOPIC',
                        mastery: 0
                    }
                }
            },
            include: {
                srsState: true
            }
        })

        return NextResponse.json(subtopic, { status: 201 })
    } catch (error) {
        console.error('POST /api/subtopics error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
