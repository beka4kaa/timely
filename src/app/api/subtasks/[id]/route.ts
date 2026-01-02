import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { z } from 'zod'

const updateSubtaskSchema = z.object({
    title: z.string().min(1).optional(),
    isDone: z.boolean().optional(),
})

// PATCH /api/subtasks/[id] - Update subtask (toggle done or rename)
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const body = await request.json()
        const validation = updateSubtaskSchema.safeParse(body)

        if (!validation.success) {
            return NextResponse.json(
                { error: 'Validation failed', details: validation.error.errors },
                { status: 400 }
            )
        }

        const subtask = await prisma.subtask.update({
            where: { id },
            data: validation.data,
        })

        return NextResponse.json(subtask)
    } catch (error) {
        console.error('Error updating subtask:', error)
        return NextResponse.json({ error: 'Failed to update subtask' }, { status: 500 })
    }
}

// DELETE /api/subtasks/[id] - Delete subtask
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params

        await prisma.subtask.delete({
            where: { id },
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting subtask:', error)
        return NextResponse.json({ error: 'Failed to delete subtask' }, { status: 500 })
    }
}
