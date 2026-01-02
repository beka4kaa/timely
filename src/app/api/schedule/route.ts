import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// GET /api/schedule - Get all schedule blocks
export async function GET() {
    try {
        const blocks = await prisma.scheduleBlock.findMany({
            orderBy: [
                { dayOfWeek: 'asc' },
                { startTime: 'asc' }
            ]
        })
        return NextResponse.json(blocks)
    } catch (error) {
        console.error('Error fetching schedule:', error)
        return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
    }
}

// POST /api/schedule - Create a new block
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { dayOfWeek, startTime, endTime, task, color, status, subjectEmoji, subjectName } = body

        const block = await prisma.scheduleBlock.create({
            data: {
                dayOfWeek,
                startTime,
                endTime,
                task,
                color: color || '#3b82f6',
                status: status || 'PENDING',
                subjectEmoji,
                subjectName
            }
        })

        return NextResponse.json(block)
    } catch (error) {
        console.error('Error creating block:', error)
        return NextResponse.json({ error: 'Failed to create' }, { status: 500 })
    }
}

// DELETE /api/schedule - Delete all blocks (for reset)
export async function DELETE() {
    try {
        await prisma.scheduleBlock.deleteMany()
        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting blocks:', error)
        return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
    }
}
