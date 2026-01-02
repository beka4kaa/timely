import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const body = await request.json()
    // Add review action to subtopics in Django backend or handle here
    const response = await fetch(`${BACKEND_URL}/api/mind/subtopics/${id}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...body,
        last_reviewed_at: new Date().toISOString(),
      }),
    })
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Error reviewing subtopic:', error)
    return NextResponse.json({ error: 'Failed to review subtopic' }, { status: 500 })
  }
}
