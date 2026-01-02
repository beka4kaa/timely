import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { z } from 'zod'

const updateSubjectSchema = z.object({
    name: z.string().min(1).optional(),
    emoji: z.string().optional(),
    color: z.string().optional(),
    targetHoursWeek: z.number().positive().optional(),
})

// GET /api/subjects/[id] - Get subject with topics
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params

        const subject = await prisma.subject.findUnique({
            where: { id },
            include: {
                topics: {
                    orderBy: { createdAt: 'asc' },
                },
            },
        })

        if (!subject) {
            return NextResponse.json({ error: 'Subject not found' }, { status: 404 })
        }

        return NextResponse.json(subject)
    } catch (error) {
        console.error('Error fetching subject:', error)
        return NextResponse.json({ error: 'Failed to fetch subject' }, { status: 500 })
    }
}

// PATCH /api/subjects/[id] - Update subject
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const body = await request.json()
        const validation = updateSubjectSchema.safeParse(body)

        if (!validation.success) {
            return NextResponse.json(
                { error: 'Validation failed', details: validation.error.errors },
                { status: 400 }
            )
        }

        const subject = await prisma.subject.update({
            where: { id },
            data: validation.data,
            include: {
                topics: true,
            },
        })

        return NextResponse.json(subject)
    } catch (error) {
        console.error('Error updating subject:', error)
        return NextResponse.json({ error: 'Failed to update subject' }, { status: 500 })
    }
}

// DELETE /api/subjects/[id] - Delete subject
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params

        await prisma.subject.delete({
            where: { id },
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting subject:', error)
        return NextResponse.json({ error: 'Failed to delete subject' }, { status: 500 })
    }
}
