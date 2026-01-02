import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { z } from 'zod'

const timerSchema = z.object({
    segmentIndex: z.number().int().min(0).nullable().optional(),
    remainingSeconds: z.number().int().min(0).optional(),
    isRunning: z.boolean().optional(),
    startedAt: z.string().datetime().nullable().optional(),
})

// GET /api/blocks/[id]/timer - Get timer state
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: blockId } = await params

        const timerState = await prisma.timerState.findUnique({
            where: { blockId },
        })

        return NextResponse.json(timerState)
    } catch (error) {
        console.error('Error fetching timer state:', error)
        return NextResponse.json({ error: 'Failed to fetch timer state' }, { status: 500 })
    }
}

// PUT /api/blocks/[id]/timer - Create or update timer state
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: blockId } = await params
        const body = await request.json()
        const validation = timerSchema.safeParse(body)

        if (!validation.success) {
            return NextResponse.json(
                { error: 'Validation failed', details: validation.error.errors },
                { status: 400 }
            )
        }

        const { segmentIndex, remainingSeconds, isRunning, startedAt } = validation.data

        const timerState = await prisma.timerState.upsert({
            where: { blockId },
            update: {
                segmentIndex: segmentIndex ?? undefined,
                remainingSeconds: remainingSeconds ?? undefined,
                isRunning: isRunning ?? undefined,
                startedAt: startedAt ? new Date(startedAt) : (isRunning === false ? null : undefined),
            },
            create: {
                blockId,
                segmentIndex: segmentIndex ?? 0,
                remainingSeconds: remainingSeconds ?? 0,
                isRunning: isRunning ?? false,
                startedAt: startedAt ? new Date(startedAt) : null,
            },
        })

        return NextResponse.json(timerState)
    } catch (error) {
        console.error('Error updating timer state:', error)
        return NextResponse.json({ error: 'Failed to update timer state' }, { status: 500 })
    }
}

// DELETE /api/blocks/[id]/timer - Delete timer state
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: blockId } = await params

        await prisma.timerState.delete({
            where: { blockId },
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting timer state:', error)
        return NextResponse.json({ error: 'Failed to delete timer state' }, { status: 500 })
    }
}
