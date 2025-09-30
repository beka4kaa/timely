import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'

const settingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'system']).default('light'),
  notifications: z.boolean().default(true),
  weekStart: z.enum(['monday', 'sunday']).default('monday'),
  timeFormat: z.enum(['12h', '24h']).default('24h'),
  timezone: z.string().default('UTC'),
  language: z.string().default('en'),
  dailyGoalReminder: z.boolean().default(true),
})

// GET - получить настройки пользователя
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('⚙️ Fetching settings for user:', session.user.id)

    let settings = await prisma.userSettings.findUnique({
      where: {
        userId: session.user.id
      }
    })

    // Если настроек нет, создаем дефолтные
    if (!settings) {
      settings = await prisma.userSettings.create({
        data: {
          userId: session.user.id
        }
      })
      console.log('✅ Created default settings for user')
    }

    return NextResponse.json(settings)
  } catch (error) {
    console.error('❌ Error fetching settings:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT - обновить настройки пользователя
export async function PUT(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const validatedData = settingsSchema.partial().parse(body)

    console.log('⚙️ Updating settings for user:', session.user.id, validatedData)

    const settings = await prisma.userSettings.upsert({
      where: {
        userId: session.user.id
      },
      update: validatedData,
      create: {
        ...validatedData,
        userId: session.user.id
      }
    })

    console.log('✅ Settings updated')
    return NextResponse.json(settings)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: error.errors }, { status: 400 })
    }
    console.error('❌ Error updating settings:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}