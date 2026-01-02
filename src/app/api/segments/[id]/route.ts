import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { z } from 'zod'

const updateSegmentSchema = z.object({
    title: z.string().min(1).optional(),
    durationMinutes: z.number().positive().optional(),
    status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'DONE']).optional(),
})

// PATCH /api/segments/[id] - Update segment
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const body = await request.json()
        const validation = updateSegmentSchema.safeParse(body)

        if (!validation.success) {
            return NextResponse.json(
                { error: 'Validation failed', details: validation.error.errors },
                { status: 400 }
            )
        }

        const segment = await prisma.segment.update({
            where: { id },
            data: validation.data,
        })

        return NextResponse.json(segment)
    } catch (error) {
        console.error('Error updating segment:', error)
        return NextResponse.json({ error: 'Failed to update segment' }, { status: 500 })
    }
}

// DELETE /api/segments/[id] - Delete segment
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params

        await prisma.segment.delete({
            where: { id },
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting segment:', error)
        return NextResponse.json({ error: 'Failed to delete segment' }, { status: 500 })
    }
}
