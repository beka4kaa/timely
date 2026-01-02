import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { z } from 'zod'
import { SUBTOPIC_LIMITS, SUBTOPIC_HARD_CAP, DetailLevel } from '@/lib/srs'

export const dynamic = 'force-dynamic'

const generateSchema = z.object({
    topicId: z.string().min(1),
    text: z.string().min(1).optional(),
    detailLevel: z.enum(['LOW', 'MED', 'HIGH']).optional(),
})

// POST /api/ai/generate-subtopics - Generate subtopics for a topic
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const parsed = generateSchema.safeParse(body)

        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.errors }, { status: 400 })
        }

        const { topicId, text, detailLevel = 'MED' } = parsed.data

        // Verify topic exists
        const topic = await prisma.topic.findUnique({
            where: { id: topicId },
            include: { subject: true }
        })

        if (!topic) {
            return NextResponse.json({ error: 'Topic not found' }, { status: 404 })
        }

        const limits = SUBTOPIC_LIMITS[detailLevel as DetailLevel]

        // Parse text into subtopics (simple line-based for now)
        let subtopicTitles: string[] = []

        if (text) {
            // Parse bullet points or numbered lists
            const lines = text.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .map(line => {
                    // Remove common list prefixes
                    return line
                        .replace(/^[-•*]\s*/, '')
                        .replace(/^\d+[.)]\s*/, '')
                        .trim()
                })
                .filter(line => line.length > 0 && line.length <= 200)

            subtopicTitles = lines
        } else {
            // Generate stub subtopics based on topic name
            const baseCount = Math.floor((limits.min + limits.max) / 2)
            for (let i = 1; i <= baseCount; i++) {
                subtopicTitles.push(`${topic.name} - Part ${i}`)
            }
        }

        // Apply limits
        if (subtopicTitles.length > SUBTOPIC_HARD_CAP) {
            // Merge excess into grouped subtopics
            const merged: string[] = []
            const groupSize = Math.ceil(subtopicTitles.length / SUBTOPIC_HARD_CAP)

            for (let i = 0; i < subtopicTitles.length; i += groupSize) {
                const group = subtopicTitles.slice(i, i + groupSize)
                if (group.length === 1) {
                    merged.push(group[0])
                } else {
                    merged.push(`${group[0]} + ${group.length - 1} more`)
                }
            }
            subtopicTitles = merged.slice(0, SUBTOPIC_HARD_CAP)
        }

        // Clamp to limits
        if (subtopicTitles.length < limits.min) {
            // Pad with generic subtopics
            for (let i = subtopicTitles.length + 1; i <= limits.min; i++) {
                subtopicTitles.push(`${topic.name} - Section ${i}`)
            }
        } else if (subtopicTitles.length > limits.max) {
            subtopicTitles = subtopicTitles.slice(0, limits.max)
        }

        // Get current max order index
        const maxOrder = await prisma.subtopic.findFirst({
            where: { topicId },
            orderBy: { orderIndex: 'desc' },
            select: { orderIndex: true }
        })
        let orderOffset = (maxOrder?.orderIndex ?? -1) + 1

        // Create subtopics
        const created = []
        for (const title of subtopicTitles) {
            const subtopic = await prisma.subtopic.create({
                data: {
                    topicId,
                    title,
                    orderIndex: orderOffset++,
                    srsState: {
                        create: {
                            entityType: 'SUBTOPIC',
                            mastery: 0,
                        }
                    }
                },
                include: { srsState: true }
            })
            created.push(subtopic)
        }

        return NextResponse.json({
            success: true,
            topicId,
            topicName: topic.name,
            detailLevel,
            subtopics: created,
            count: created.length,
        })

    } catch (error) {
        console.error('POST /api/ai/generate-subtopics error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
