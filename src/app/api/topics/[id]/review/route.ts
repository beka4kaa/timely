import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { z } from 'zod'

const reviewSchema = z.object({
    rating: z.enum(['AGAIN', 'HARD', 'GOOD', 'EASY']),
})

// POST /api/topics/[id]/review - Record a review and update spaced repetition
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const body = await request.json()
        const validation = reviewSchema.safeParse(body)

        if (!validation.success) {
            return NextResponse.json(
                { error: 'Validation failed', details: validation.error.errors },
                { status: 400 }
            )
        }

        const { rating } = validation.data

        // Get current topic
        const topic = await prisma.topic.findUnique({
            where: { id },
        })

        if (!topic) {
            return NextResponse.json({ error: 'Topic not found' }, { status: 404 })
        }

        // Calculate new interval using spaced repetition
        const currentInterval = topic.intervalDays
        let newInterval: number

        switch (rating) {
            case 'AGAIN':
                newInterval = 1
                break
            case 'HARD':
                newInterval = Math.max(1, Math.floor((currentInterval || 2) * 0.6))
                break
            case 'GOOD':
                newInterval = Math.max(2, Math.floor((currentInterval || 2) * 1.7))
                break
            case 'EASY':
                newInterval = Math.max(7, Math.floor((currentInterval || 4) * 2.5))
                break
        }

        // Calculate next review date
        const nextReviewAt = new Date()
        nextReviewAt.setDate(nextReviewAt.getDate() + newInterval)

        // Update status based on rating
        let newStatus = topic.status
        if (rating === 'EASY' && topic.status !== 'MASTERED') {
            newStatus = 'MASTERED'
        } else if (rating === 'GOOD' && topic.status === 'NOT_STARTED') {
            newStatus = 'SUCCESS'
        } else if (rating === 'GOOD' && topic.status === 'MEDIUM') {
            newStatus = 'SUCCESS'
        } else if ((rating === 'HARD' || rating === 'AGAIN') && topic.status !== 'NOT_STARTED') {
            newStatus = 'MEDIUM'
        }

        // Update topic and create review log in a transaction
        const [updatedTopic] = await prisma.$transaction([
            prisma.topic.update({
                where: { id },
                data: {
                    intervalDays: newInterval,
                    nextReviewAt,
                    lastRevisedAt: new Date(),
                    studyState: 'STUDIED',
                    status: newStatus,
                },
                include: {
                    subject: true,
                },
            }),
            prisma.reviewLog.create({
                data: {
                    topicId: id,
                    rating,
                    intervalDaysAfter: newInterval,
                },
            }),
        ])

        return NextResponse.json(updatedTopic)
    } catch (error) {
        console.error('Error recording review:', error)
        return NextResponse.json({ error: 'Failed to record review' }, { status: 500 })
    }
}
