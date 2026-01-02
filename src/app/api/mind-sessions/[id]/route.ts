import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { z } from 'zod'

const updateSessionSchema = z.object({
    endedAt: z.string().optional(),
    breaksMinutes: z.number().min(0).optional(),
})

// PATCH /api/mind-sessions/[id] - End or update a session
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const body = await request.json()
        const validation = updateSessionSchema.safeParse(body)

        if (!validation.success) {
            return NextResponse.json(
                { error: 'Validation failed', details: validation.error.errors },
                { status: 400 }
            )
        }

        const session = await prisma.mindSession.findUnique({
            where: { id },
        })

        if (!session) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 })
        }

        const updateData: any = {}

        if (validation.data.endedAt) {
            updateData.endedAt = new Date(validation.data.endedAt)
            // Calculate total minutes
            const startedAt = new Date(session.startedAt)
            const endedAt = updateData.endedAt
            const diffMs = endedAt.getTime() - startedAt.getTime()
            const breaksMinutes = validation.data.breaksMinutes || session.breaksMinutes || 0
            updateData.totalMinutes = Math.max(0, Math.floor(diffMs / 60000) - breaksMinutes)
        }

        if (validation.data.breaksMinutes !== undefined) {
            updateData.breaksMinutes = validation.data.breaksMinutes
        }

        const updatedSession = await prisma.mindSession.update({
            where: { id },
            data: updateData,
            include: {
                topic: {
                    include: {
                        subject: true,
                    },
                },
            },
        })

        return NextResponse.json(updatedSession)
    } catch (error) {
        console.error('Error updating session:', error)
        return NextResponse.json({ error: 'Failed to update session' }, { status: 500 })
    }
}

// DELETE /api/mind-sessions/[id] - Delete a session
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params

        await prisma.mindSession.delete({
            where: { id },
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting session:', error)
        return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 })
    }
}
