import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// GET /api/ai/memory - Get all AI memories about user
export async function GET() {
    try {
        const memories = await prisma.aIMemory.findMany({
            orderBy: [
                { importance: 'desc' },
                { createdAt: 'desc' },
            ],
            take: 50,
        })

        const context = await prisma.userContext.findMany()

        return NextResponse.json({ memories, context })
    } catch (error) {
        console.error('Error fetching memories:', error)
        return NextResponse.json({ error: 'Failed to fetch memories' }, { status: 500 })
    }
}

// POST /api/ai/memory - Add new memory
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { type, content, importance = 1 } = body

        const memory = await prisma.aIMemory.create({
            data: {
                type,
                content,
                importance,
            },
        })

        return NextResponse.json(memory, { status: 201 })
    } catch (error) {
        console.error('Error creating memory:', error)
        return NextResponse.json({ error: 'Failed to create memory' }, { status: 500 })
    }
}

// DELETE /api/ai/memory - Clear all memories
export async function DELETE() {
    try {
        await prisma.aIMemory.deleteMany()
        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error clearing memories:', error)
        return NextResponse.json({ error: 'Failed to clear memories' }, { status: 500 })
    }
}
