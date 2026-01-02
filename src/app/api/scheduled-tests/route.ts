import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// GET /api/scheduled-tests - Get upcoming tests
export async function GET() {
    try {
        const tests = await prisma.scheduledTest.findMany({
            where: {
                scheduledDate: { gte: new Date() },
                status: 'SCHEDULED',
            },
            include: {
                subject: true,
            },
            orderBy: { scheduledDate: 'asc' },
            take: 20,
        })

        return NextResponse.json(tests)
    } catch (error) {
        console.error('Error fetching tests:', error)
        return NextResponse.json({ error: 'Failed to fetch tests' }, { status: 500 })
    }
}
