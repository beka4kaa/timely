import { NextRequest, NextResponse } from 'next/server'

// Временное хранилище событий (будет заменено на базу данных)
let events: any[] = []

// GET - получить конкретное событие
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const event = events.find(e => e.id === params.id)
    
    if (!event) {
      return NextResponse.json(
        { error: 'Событие не найдено' },
        { status: 404 }
      )
    }

    return NextResponse.json({ event })
  } catch (error) {
    return NextResponse.json(
      { error: 'Ошибка при получении события' },
      { status: 500 }
    )
  }
}

// PUT - обновить событие
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    const eventIndex = events.findIndex(e => e.id === params.id)
    
    if (eventIndex === -1) {
      return NextResponse.json(
        { error: 'Событие не найдено' },
        { status: 404 }
      )
    }

    const updatedEvent = {
      ...events[eventIndex],
      ...body,
      updatedAt: new Date().toISOString()
    }

    events[eventIndex] = updatedEvent

    return NextResponse.json({ event: updatedEvent })
  } catch (error) {
    return NextResponse.json(
      { error: 'Ошибка при обновлении события' },
      { status: 500 }
    )
  }
}

// DELETE - удалить событие
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const eventIndex = events.findIndex(e => e.id === params.id)
    
    if (eventIndex === -1) {
      return NextResponse.json(
        { error: 'Событие не найдено' },
        { status: 404 }
      )
    }

    events.splice(eventIndex, 1)

    return NextResponse.json({ message: 'Событие удалено' })
  } catch (error) {
    return NextResponse.json(
      { error: 'Ошибка при удалении события' },
      { status: 500 }
    )
  }
}