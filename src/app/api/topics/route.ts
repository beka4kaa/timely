import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { z } from 'zod'

const createTopicSchema = z.object({
    subjectId: z.string().min(1, 'Subject is required'),
    name: z.string().min(1, 'Name is required'),
    status: z.enum(['NOT_STARTED', 'MEDIUM', 'SUCCESS', 'MASTERED']).optional().default('NOT_STARTED'),
    picked: z.boolean().optional().default(false),
})

// GET /api/topics - List all topics with filters
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url)
        const subjectId = searchParams.get('subjectId')
        const filter = searchParams.get('filter') // picked, urgent, archived, overall

        const where: any = {}

        if (subjectId) {
            where.subjectId = subjectId
        }

        switch (filter) {
            case 'picked':
                where.picked = true
                where.archived = false
                break
            case 'urgent':
                where.archived = false
                where.nextReviewAt = {
                    lte: new Date(),
                }
                break
            case 'archived':
                where.archived = true
                break
            case 'overall':
            default:
                where.archived = false
                break
        }

        const topics = await prisma.topic.findMany({
            where,
            include: {
                subject: true,
            },
            orderBy: [
                { subject: { name: 'asc' } },
                { createdAt: 'asc' },
            ],
        })

        return NextResponse.json(topics)
    } catch (error) {
        console.error('Error fetching topics:', error)
        return NextResponse.json({ error: 'Failed to fetch topics' }, { status: 500 })
    }
}

// POST /api/topics - Create a new topic
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const validation = createTopicSchema.safeParse(body)

        if (!validation.success) {
            return NextResponse.json(
                { error: 'Validation failed', details: validation.error.errors },
                { status: 400 }
            )
        }

        const { subjectId, name, status, picked } = validation.data

        const topic = await prisma.topic.create({
            data: {
                subjectId,
                name,
                status,
                picked,
            },
            include: {
                subject: true,
            },
        })

        return NextResponse.json(topic, { status: 201 })
    } catch (error) {
        console.error('Error creating topic:', error)
        return NextResponse.json({ error: 'Failed to create topic' }, { status: 500 })
    }
}
