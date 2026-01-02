import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { z } from 'zod'
import { applySrs, SrsRating } from '@/lib/srs'

export const dynamic = 'force-dynamic'

const reviewSchema = z.object({
    rating: z.enum(['AGAIN', 'HARD', 'GOOD', 'EASY']),
})

// POST /api/subtopics/[id]/review - Apply SRS rating
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const body = await request.json()
        const parsed = reviewSchema.safeParse(body)

        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.errors }, { status: 400 })
        }

        const { rating } = parsed.data

        // Get subtopic with SRS state
        const subtopic = await prisma.subtopic.findUnique({
            where: { id },
            include: { srsState: true }
        })

        if (!subtopic) {
            return NextResponse.json({ error: 'Subtopic not found' }, { status: 404 })
        }

        // Calculate new SRS values
        const srsResult = applySrs(
            rating as SrsRating,
            subtopic.srsState?.intervalDays,
            subtopic.srsState?.mastery ?? 0
        )

        // Update or create SRS state
        const updatedSrsState = await prisma.srsState.upsert({
            where: { subtopicId: id },
            update: {
                lastReviewedAt: srsResult.lastReviewedAt,
                nextReviewAt: srsResult.nextReviewAt,
                intervalDays: srsResult.intervalDays,
                mastery: srsResult.mastery,
            },
            create: {
                entityType: 'SUBTOPIC',
                subtopicId: id,
                lastReviewedAt: srsResult.lastReviewedAt,
                nextReviewAt: srsResult.nextReviewAt,
                intervalDays: srsResult.intervalDays,
                mastery: srsResult.mastery,
            }
        })

        // Log the review
        await prisma.srsReviewLog.create({
            data: {
                entityType: 'SUBTOPIC',
                entityId: id,
                rating,
                intervalDaysAfter: srsResult.intervalDays,
            }
        })

        return NextResponse.json({
            subtopicId: id,
            srsState: updatedSrsState,
            message: `Reviewed as ${rating}. Next review in ${srsResult.intervalDays} days.`
        })
    } catch (error) {
        console.error('POST /api/subtopics/[id]/review error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
