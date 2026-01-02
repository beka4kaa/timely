import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { z } from 'zod'

const updateTopicSchema = z.object({
    name: z.string().min(1).optional(),
    status: z.enum(['NOT_STARTED', 'MEDIUM', 'SUCCESS', 'MASTERED']).optional(),
    studyState: z.enum(['STUDIED', 'NOT_STUDIED']).optional(),
    picked: z.boolean().optional(),
    archived: z.boolean().optional(),
})

// GET /api/topics/[id] - Get topic details
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params

        const topic = await prisma.topic.findUnique({
            where: { id },
            include: {
                subject: true,
                reviewLogs: {
                    orderBy: { reviewedAt: 'desc' },
                    take: 10,
                },
            },
        })

        if (!topic) {
            return NextResponse.json({ error: 'Topic not found' }, { status: 404 })
        }

        return NextResponse.json(topic)
    } catch (error) {
        console.error('Error fetching topic:', error)
        return NextResponse.json({ error: 'Failed to fetch topic' }, { status: 500 })
    }
}

// PATCH /api/topics/[id] - Update topic
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const body = await request.json()
        const validation = updateTopicSchema.safeParse(body)

        if (!validation.success) {
            return NextResponse.json(
                { error: 'Validation failed', details: validation.error.errors },
                { status: 400 }
            )
        }

        const topic = await prisma.topic.update({
            where: { id },
            data: validation.data,
            include: {
                subject: true,
            },
        })

        return NextResponse.json(topic)
    } catch (error) {
        console.error('Error updating topic:', error)
        return NextResponse.json({ error: 'Failed to update topic' }, { status: 500 })
    }
}

// DELETE /api/topics/[id] - Delete topic
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params

        await prisma.topic.delete({
            where: { id },
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting topic:', error)
        return NextResponse.json({ error: 'Failed to delete topic' }, { status: 500 })
    }
}
