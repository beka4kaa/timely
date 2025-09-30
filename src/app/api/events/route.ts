import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Event, FormattedEvent } from '@/types/event'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')
    const type = searchParams.get('type')
    const priority = searchParams.get('priority')

    let events = await prisma.event.findMany({
      where: {
        userId: user.id,
        ...(search && {
          OR: [
            { title: { contains: search } },
            { description: { contains: search } }
          ]
        }),
        ...(type && { category: type }),
        ...(priority && { priority })
      },
      orderBy: {
        start: 'asc'
      }
    })

    // Преобразуем данные для совместимости с фронтендом
    const formattedEvents: FormattedEvent[] = events.map((event: any) => ({
      id: event.id,
      title: event.title,
      description: event.description,
      date: event.start.toISOString().split('T')[0],
      startTime: event.start.toTimeString().slice(0, 5),
      endTime: event.end.toTimeString().slice(0, 5),
      type: event.category,
      priority: event.priority,
      color: event.color,
      recurring: event.recurring || 'none',
      userId: event.userId
    }))

    return NextResponse.json(formattedEvents)
  } catch (error) {
    console.error('Error fetching events:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const body = await request.json()
    const { title, description, date, startTime, endTime, type, priority, color, recurring } = body

    if (!title || !date || !startTime || !endTime) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Создаем объекты Date для start и end
    const startDateTime = new Date(`${date}T${startTime}:00`)
    const endDateTime = new Date(`${date}T${endTime}:00`)

    const newEvent = await prisma.event.create({
      data: {
        title,
        description: description || '',
        start: startDateTime,
        end: endDateTime,
        category: type || 'personal',
        priority: priority || 'medium',
        color: color || '#3b82f6',
        recurring: recurring || null,
        userId: user.id
      }
    })

    // Преобразуем для фронтенда
    const formattedEvent = {
      id: newEvent.id,
      title: newEvent.title,
      description: newEvent.description,
      date: newEvent.start.toISOString().split('T')[0],
      startTime: newEvent.start.toTimeString().slice(0, 5),
      endTime: newEvent.end.toTimeString().slice(0, 5),
      type: newEvent.category,
      priority: newEvent.priority,
      color: newEvent.color,
      recurring: newEvent.recurring || 'none',
      userId: newEvent.userId
    }

    return NextResponse.json(formattedEvent, { status: 201 })
  } catch (error) {
    console.error('Error creating event:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const body = await request.json()
    const { id, title, description, date, startTime, endTime, type, priority, color, recurring } = body

    if (!id || !title || !date || !startTime || !endTime) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Проверяем, что событие принадлежит пользователю
    const existingEvent = await prisma.event.findFirst({
      where: {
        id,
        userId: user.id
      }
    })

    if (!existingEvent) {
      return NextResponse.json({ error: 'Event not found or unauthorized' }, { status: 404 })
    }

    const startDateTime = new Date(`${date}T${startTime}:00`)
    const endDateTime = new Date(`${date}T${endTime}:00`)

    const updatedEvent = await prisma.event.update({
      where: { id },
      data: {
        title,
        description: description || '',
        start: startDateTime,
        end: endDateTime,
        category: type || 'personal',
        priority: priority || 'medium',
        color: color || '#3b82f6',
        recurring: recurring || null
      }
    })

    const formattedEvent = {
      id: updatedEvent.id,
      title: updatedEvent.title,
      description: updatedEvent.description,
      date: updatedEvent.start.toISOString().split('T')[0],
      startTime: updatedEvent.start.toTimeString().slice(0, 5),
      endTime: updatedEvent.end.toTimeString().slice(0, 5),
      type: updatedEvent.category,
      priority: updatedEvent.priority,
      color: updatedEvent.color,
      recurring: updatedEvent.recurring || 'none',
      userId: updatedEvent.userId
    }

    return NextResponse.json(formattedEvent)
  } catch (error) {
    console.error('Error updating event:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Event ID is required' }, { status: 400 })
    }

    // Проверяем, что событие принадлежит пользователю
    const existingEvent = await prisma.event.findFirst({
      where: {
        id,
        userId: user.id
      }
    })

    if (!existingEvent) {
      return NextResponse.json({ error: 'Event not found or unauthorized' }, { status: 404 })
    }

    await prisma.event.delete({
      where: { id }
    })

    return NextResponse.json({ message: 'Event deleted successfully' })
  } catch (error) {
    console.error('Error deleting event:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}