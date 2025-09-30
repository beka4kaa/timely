import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const achievementSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  type: z.enum(['milestone', 'streak', 'completion']).default('milestone'),
  points: z.number().default(0),
  badge: z.string().optional(),
})

// GET - получить все достижения пользователя
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('🏆 Fetching achievements for user:', session.user.id)

    const achievements = await prisma.achievement.findMany({
      where: {
        userId: session.user.id
      },
      orderBy: {
        earnedAt: 'desc'
      }
    })

    console.log('✅ Found achievements:', achievements.length)
    return NextResponse.json(achievements)
  } catch (error) {
    console.error('❌ Error fetching achievements:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST - создать новое достижение
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = achievementSchema.parse(body)

    console.log('🏆 Creating achievement for user:', session.user.id, validatedData)

    const achievement = await prisma.achievement.create({
      data: {
        ...validatedData,
        userId: session.user.id
      }
    })

    console.log('✅ Achievement created:', achievement.id)
    return NextResponse.json(achievement, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 400 })
    }
    console.error('❌ Error creating achievement:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}