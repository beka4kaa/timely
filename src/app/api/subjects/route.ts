import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { z } from 'zod'

const createSubjectSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    emoji: z.string().optional().default('📚'),
    color: z.string().optional().default('#8b5cf6'),
    targetHoursWeek: z.number().positive().optional().default(5),
})

// GET /api/subjects - List all subjects with topics
export async function GET() {
    try {
        const subjects = await prisma.subject.findMany({
            include: {
                topics: {
                    orderBy: { createdAt: 'asc' },
                },
            },
            orderBy: { createdAt: 'asc' },
        })

        return NextResponse.json(subjects)
    } catch (error) {
        console.error('Error fetching subjects:', error)
        return NextResponse.json({ error: 'Failed to fetch subjects' }, { status: 500 })
    }
}

// POST /api/subjects - Create a new subject
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const validation = createSubjectSchema.safeParse(body)

        if (!validation.success) {
            return NextResponse.json(
                { error: 'Validation failed', details: validation.error.errors },
                { status: 400 }
            )
        }

        const { name, emoji, color, targetHoursWeek } = validation.data

        const subject = await prisma.subject.create({
            data: {
                name,
                emoji,
                color,
                targetHoursWeek,
            },
            include: {
                topics: true,
            },
        })

        return NextResponse.json(subject, { status: 201 })
    } catch (error) {
        console.error('Error creating subject:', error)
        return NextResponse.json({ error: 'Failed to create subject' }, { status: 500 })
    }
}
