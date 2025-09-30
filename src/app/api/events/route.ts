import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const eventSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100, 'Title must be less than 100 characters'),
  description: z.string().optional(),
  start: z.string().datetime('Invalid start time'),
  end: z.string().datetime('Invalid end time'),
  category: z.string().optional().default('personal'),
  priority: z.string().optional().default('medium'),
  color: z.string().optional().default('#3b82f6'),
  recurring: z.string().optional(),
})

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(req.url)
    const start = searchParams.get('start')
    const end = searchParams.get('end')

    let whereClause: any = {
      userId: session.user.id
    }

    // Filter by date range if provided
    if (start && end) {
      whereClause.start = {
        gte: new Date(start),
        lte: new Date(end)
      }
    }

    const events = await prisma.event.findMany({
      where: whereClause,
      orderBy: {
        start: 'asc'
      }
    })

    return NextResponse.json({ events })
    
  } catch (error) {
    console.error('Events fetch error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await req.json()
    const validatedData = eventSchema.parse(body)

    // Validate dates
    const startTime = new Date(validatedData.start)
    const endTime = new Date(validatedData.end)

    if (endTime <= startTime) {
      return NextResponse.json(
        { error: 'End time must be after start time' },
        { status: 400 }
      )
    }

    const event = await prisma.event.create({
      data: {
        ...validatedData,
        start: startTime,
        end: endTime,
        userId: session.user.id,
      }
    })

    return NextResponse.json({ event }, { status: 201 })
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    console.error('Event creation error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}