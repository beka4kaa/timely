import { NextRequest, NextResponse } from 'next/server'
import { BACKEND_URL } from '@/lib/api-utils'

export async function GET() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/mind/subtopics/`)
    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching subtopics:', error)
    return NextResponse.json({ error: 'Failed to fetch subtopics' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const response = await fetch(`${BACKEND_URL}/api/mind/subtopics/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Error creating subtopic:', error)
    return NextResponse.json({ error: 'Failed to create subtopic' }, { status: 500 })
  }
}
