import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const updateSubtopicSchema = z.object({
    title: z.string().min(1).max(200).optional(),
    orderIndex: z.number().int().min(0).optional(),
})

// GET /api/subtopics/[id] - Get single subtopic
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params

        const subtopic = await prisma.subtopic.findUnique({
            where: { id },
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
            }
        })

        if (!subtopic) {
            return NextResponse.json({ error: 'Subtopic not found' }, { status: 404 })
        }

        return NextResponse.json(subtopic)
    } catch (error) {
        console.error('GET /api/subtopics/[id] error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

// PATCH /api/subtopics/[id] - Update subtopic
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const body = await request.json()
        const parsed = updateSubtopicSchema.safeParse(body)

        if (!parsed.success) {
            return NextResponse.json({ error: parsed.error.errors }, { status: 400 })
        }

        const subtopic = await prisma.subtopic.update({
            where: { id },
            data: parsed.data,
            include: { srsState: true }
        })

        return NextResponse.json(subtopic)
    } catch (error) {
        console.error('PATCH /api/subtopics/[id] error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

// DELETE /api/subtopics/[id] - Delete subtopic
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params

        await prisma.subtopic.delete({ where: { id } })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('DELETE /api/subtopics/[id] error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
