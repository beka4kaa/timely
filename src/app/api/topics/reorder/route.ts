import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const reorderSchema = z.object({
    subjectId: z.string(),
    topicIds: z.array(z.string()), // Array of topic IDs in new order
})

// POST /api/topics/reorder - Reorder topics within a subject
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { subjectId, topicIds } = reorderSchema.parse(body)

        // Verify subject exists
        const subject = await prisma.subject.findUnique({
            where: { id: subjectId },
            include: { topics: { select: { id: true } } }
        })

        if (!subject) {
            return NextResponse.json({ error: 'Subject not found' }, { status: 404 })
        }

        // Verify all topic IDs belong to this subject
        const subjectTopicIds = new Set(subject.topics.map(t => t.id))
        const invalidIds = topicIds.filter(id => !subjectTopicIds.has(id))
        if (invalidIds.length > 0) {
            return NextResponse.json({
                error: 'Some topic IDs do not belong to this subject',
                invalidIds
            }, { status: 400 })
        }

        // Update orderIndex for each topic
        const updates = topicIds.map((id, index) =>
            prisma.topic.update({
                where: { id },
                data: { orderIndex: index }
            })
        )

        await prisma.$transaction(updates)

        return NextResponse.json({
            success: true,
            message: `Reordered ${topicIds.length} topics`
        })

    } catch (error) {
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 400 })
        }
        console.error('Error reordering topics:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
