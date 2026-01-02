import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

// Validation schemas
const subtopicSchema = z.object({
    title: z.string().min(1),
    initialMastery: z.number().min(0).max(100).optional(),
})

const reviewSetSchema = z.object({
    title: z.string().min(1),
    type: z.enum(['END_OF_CHAPTER', 'CROSS_TOPIC']),
    srs: z.object({
        intervalDays: z.number().optional(),
    }).optional(),
})

const topicSchema = z.object({
    title: z.string().min(1),
    status: z.enum(['NOT_STARTED', 'MEDIUM', 'SUCCESS', 'MASTERED']).optional(),
    subtopics: z.array(subtopicSchema).optional(),
    reviewSets: z.array(reviewSetSchema).optional(),
})

const crossTopicReviewSetSchema = z.object({
    title: z.string().min(1),
    type: z.literal('CROSS_TOPIC'),
    topicTitles: z.array(z.string().min(1)),
    srs: z.object({
        intervalDays: z.number().optional(),
    }).optional(),
})

const programImportSchema = z.object({
    subject: z.object({
        title: z.string().min(1),
        emoji: z.string().optional(),
        color: z.string().optional(),
        hoursPerWeek: z.number().optional(),
    }),
    topics: z.array(topicSchema),
    crossTopicReviewSets: z.array(crossTopicReviewSetSchema).optional(),
})

// POST /api/import/program - Import full program structure
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const parsed = programImportSchema.safeParse(body)

        if (!parsed.success) {
            return NextResponse.json({
                error: 'Validation failed',
                details: parsed.error.errors
            }, { status: 400 })
        }

        const { subject: subjectData, topics: topicsData, crossTopicReviewSets } = parsed.data

        // Create Subject
        const subject = await prisma.subject.create({
            data: {
                name: subjectData.title,
                emoji: subjectData.emoji || '📚',
                color: subjectData.color || '#8b5cf6',
                targetHoursWeek: subjectData.hoursPerWeek || 5,
            }
        })

        const createdTopicIds: Record<string, string> = {} // title -> id mapping
        let subtopicsCount = 0
        let reviewSetsCount = 0

        // Create Topics with Subtopics and ReviewSets
        for (const topicData of topicsData) {
            const topic = await prisma.topic.create({
                data: {
                    subjectId: subject.id,
                    name: topicData.title,
                    status: topicData.status || 'NOT_STARTED',
                }
            })

            createdTopicIds[topicData.title] = topic.id

            // Create Subtopics with SrsState
            if (topicData.subtopics) {
                for (let i = 0; i < topicData.subtopics.length; i++) {
                    const st = topicData.subtopics[i]
                    await prisma.subtopic.create({
                        data: {
                            topicId: topic.id,
                            title: st.title,
                            orderIndex: i,
                            srsState: {
                                create: {
                                    entityType: 'SUBTOPIC',
                                    mastery: st.initialMastery || 0,
                                }
                            }
                        }
                    })
                    subtopicsCount++
                }
            }

            // Create end-of-chapter ReviewSets
            if (topicData.reviewSets) {
                for (let i = 0; i < topicData.reviewSets.length; i++) {
                    const rs = topicData.reviewSets[i]
                    await prisma.reviewSet.create({
                        data: {
                            subjectId: subject.id,
                            topicId: topic.id,
                            title: rs.title,
                            type: rs.type,
                            orderIndex: i,
                            srsState: {
                                create: {
                                    entityType: 'REVIEW_SET',
                                    intervalDays: rs.srs?.intervalDays,
                                    mastery: 0,
                                }
                            }
                        }
                    })
                    reviewSetsCount++
                }
            }
        }

        // Create cross-topic ReviewSets
        if (crossTopicReviewSets) {
            for (const rs of crossTopicReviewSets) {
                // Create the review set
                const reviewSet = await prisma.reviewSet.create({
                    data: {
                        subjectId: subject.id,
                        title: rs.title,
                        type: rs.type,
                        srsState: {
                            create: {
                                entityType: 'REVIEW_SET',
                                intervalDays: rs.srs?.intervalDays,
                                mastery: 0,
                            }
                        }
                    }
                })

                // Link to topics
                for (const topicTitle of rs.topicTitles) {
                    const topicId = createdTopicIds[topicTitle]
                    if (topicId) {
                        await prisma.reviewSetLink.create({
                            data: {
                                reviewSetId: reviewSet.id,
                                topicId,
                            }
                        })
                    }
                }
                reviewSetsCount++
            }
        }

        return NextResponse.json({
            success: true,
            created: {
                subjectId: subject.id,
                subjectName: subject.name,
                topicsCount: Object.keys(createdTopicIds).length,
                subtopicsCount,
                reviewSetsCount,
            }
        }, { status: 201 })

    } catch (error) {
        console.error('POST /api/import/program error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
