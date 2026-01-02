import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// GET /api/schedule/[id] - Get single block
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const block = await prisma.scheduleBlock.findUnique({
            where: { id }
        })

        if (!block) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 })
        }

        return NextResponse.json(block)
    } catch (error) {
        console.error('Error fetching block:', error)
        return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
    }
}

// PATCH /api/schedule/[id] - Update a block
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        const body = await request.json()

        const block = await prisma.scheduleBlock.update({
            where: { id },
            data: body
        })

        return NextResponse.json(block)
    } catch (error) {
        console.error('Error updating block:', error)
        return NextResponse.json({ error: 'Failed to update' }, { status: 500 })
    }
}

// DELETE /api/schedule/[id] - Delete a block
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params
        await prisma.scheduleBlock.delete({
            where: { id }
        })

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error deleting block:', error)
        return NextResponse.json({ error: 'Failed to delete' }, { status: 500 })
    }
}
