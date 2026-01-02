import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// GET /api/learning-program - Get active learning program
export async function GET() {
    try {
        const program = await prisma.learningProgram.findFirst({
            where: { isActive: true },
            include: {
                weekPlans: { orderBy: { weekNumber: 'asc' } },
                topicPlans: {
                    include: {
                        topic: { include: { subject: true } }
                    },
                    orderBy: { plannedWeek: 'asc' },
                },
                scheduledTests: {
                    include: { subject: true },
                    orderBy: { scheduledDate: 'asc' }
                },
            },
        })

        if (!program) {
            return NextResponse.json({ message: 'No active program found' }, { status: 404 })
        }

        return NextResponse.json(program)
    } catch (error) {
        console.error('Error fetching program:', error)
        return NextResponse.json({ error: 'Failed to fetch program' }, { status: 500 })
    }
}

// PATCH /api/learning-program - Update program settings
export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json()
        const { programId, hoursPerWeek, name, isActive } = body

        const program = await prisma.learningProgram.update({
            where: { id: programId },
            data: {
                ...(hoursPerWeek !== undefined && { hoursPerWeek }),
                ...(name !== undefined && { name }),
                ...(isActive !== undefined && { isActive }),
            },
        })

        return NextResponse.json(program)
    } catch (error) {
        console.error('Error updating program:', error)
        return NextResponse.json({ error: 'Failed to update program' }, { status: 500 })
    }
}

// DELETE /api/learning-program - Delete program
export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url)
        const programId = searchParams.get('id')

        if (!programId) {
            return NextResponse.json({ error: 'Program ID required' }, { status: 400 })
        }

        await prisma.learningProgram.delete({
            where: { id: programId },
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting program:', error)
        return NextResponse.json({ error: 'Failed to delete program' }, { status: 500 })
    }
}
