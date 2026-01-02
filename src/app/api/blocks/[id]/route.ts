import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { z } from 'zod'

const updateBlockSchema = z.object({
    title: z.string().min(1).optional(),
    durationMinutes: z.number().positive().optional(),
    startTime: z.string().nullable().optional(),
    status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'DONE', 'SKIPPED']).optional(),
    orderIndex: z.number().int().min(0).optional(),
    notes: z.string().nullable().optional(),
    color: z.string().optional(),
})

// GET /api/blocks/[id] - Get specific block
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params

        const block = await prisma.block.findUnique({
            where: { id },
            include: {
                segments: { orderBy: { orderIndex: 'asc' } },
                subtasks: { orderBy: { orderIndex: 'asc' } },
                timerState: true,
            },
        })

        if (!block) {
            return NextResponse.json({ error: 'Block not found' }, { status: 404 })
        }

        return NextResponse.json(block)
    } catch (error) {
        console.error('Error fetching block:', error)
        return NextResponse.json({ error: 'Failed to fetch block' }, { status: 500 })
    }
}

// PATCH /api/blocks/[id] - Update block
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const body = await request.json()
        const validation = updateBlockSchema.safeParse(body)

        if (!validation.success) {
            return NextResponse.json(
                { error: 'Validation failed', details: validation.error.errors },
                { status: 400 }
            )
        }

        const block = await prisma.block.update({
            where: { id },
            data: validation.data,
            include: {
                segments: { orderBy: { orderIndex: 'asc' } },
                subtasks: { orderBy: { orderIndex: 'asc' } },
                timerState: true,
            },
        })

        return NextResponse.json(block)
    } catch (error) {
        console.error('Error updating block:', error)
        return NextResponse.json({ error: 'Failed to update block' }, { status: 500 })
    }
}

// DELETE /api/blocks/[id] - Delete block
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params

        await prisma.block.delete({
            where: { id },
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting block:', error)
        return NextResponse.json({ error: 'Failed to delete block' }, { status: 500 })
    }
}
