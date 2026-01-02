import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// GET /api/dayplans - Get all day plans or filter by date range
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url)
        const date = searchParams.get('date')
        const from = searchParams.get('from')
        const to = searchParams.get('to')

        let dayPlans

        if (date) {
            // Get specific day
            dayPlans = await prisma.dayPlan.findFirst({
                where: { date },
                include: {
                    blocks: {
                        orderBy: { orderIndex: 'asc' },
                        include: {
                            segments: { orderBy: { orderIndex: 'asc' } },
                            subtasks: { orderBy: { orderIndex: 'asc' } },
                            timerState: true,
                        },
                    },
                },
            })
        } else if (from && to) {
            // Get date range
            dayPlans = await prisma.dayPlan.findMany({
                where: {
                    date: { gte: from, lte: to },
                },
                include: {
                    blocks: {
                        orderBy: { orderIndex: 'asc' },
                        include: {
                            segments: { orderBy: { orderIndex: 'asc' } },
                            subtasks: { orderBy: { orderIndex: 'asc' } },
                        },
                    },
                },
                orderBy: { date: 'desc' },
            })
        } else {
            // Get last 14 days
            const fourteenDaysAgo = new Date()
            fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)
            const fromDate = fourteenDaysAgo.toISOString().split('T')[0]

            dayPlans = await prisma.dayPlan.findMany({
                where: { date: { gte: fromDate } },
                include: {
                    blocks: {
                        orderBy: { orderIndex: 'asc' },
                    },
                },
                orderBy: { date: 'desc' },
            })
        }

        return NextResponse.json(dayPlans)
    } catch (error) {
        console.error('Error fetching day plans:', error)
        return NextResponse.json({ error: 'Failed to fetch day plans' }, { status: 500 })
    }
}

// POST /api/dayplans - Create a new day plan
export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { date } = body

        if (!date) {
            return NextResponse.json({ error: 'Date is required' }, { status: 400 })
        }

        // Check if plan already exists
        const existing = await prisma.dayPlan.findUnique({
            where: { date },
            include: { blocks: true },
        })

        if (existing) {
            return NextResponse.json(existing)
        }

        // Create new empty plan
        const dayPlan = await prisma.dayPlan.create({
            data: { date },
            include: { blocks: true },
        })

        return NextResponse.json(dayPlan, { status: 201 })
    } catch (error) {
        console.error('Error creating day plan:', error)
        return NextResponse.json({ error: 'Failed to create day plan' }, { status: 500 })
    }
}
