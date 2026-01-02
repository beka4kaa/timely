import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// GET /api/ai/context - Get user context
export async function GET() {
    try {
        const contextItems = await prisma.userContext.findMany()

        const context: Record<string, unknown> = {}
        for (const item of contextItems) {
            try {
                context[item.key] = JSON.parse(item.value)
            } catch {
                context[item.key] = item.value
            }
        }

        return NextResponse.json(context)
    } catch (error) {
        console.error('Error fetching context:', error)
        return NextResponse.json({ error: 'Failed to fetch context' }, { status: 500 })
    }
}

// PUT /api/ai/context - Update user context
export async function PUT(request: NextRequest) {
    try {
        const body = await request.json()
        const { key, value } = body

        const valueStr = typeof value === 'string' ? value : JSON.stringify(value)

        const context = await prisma.userContext.upsert({
            where: { key },
            update: { value: valueStr },
            create: { key, value: valueStr },
        })

        return NextResponse.json(context)
    } catch (error) {
        console.error('Error updating context:', error)
        return NextResponse.json({ error: 'Failed to update context' }, { status: 500 })
    }
}
