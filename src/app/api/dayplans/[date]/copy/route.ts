import { NextRequest, NextResponse } from 'next/server'
import { BACKEND_URL } from '@/lib/api-utils'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const { date } = await params
  try {
    const body = await request.json()
    const response = await fetch(`${BACKEND_URL}/api/planner/dayplans/${date}/copy/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Error copying dayplan:', error)
    return NextResponse.json({ error: 'Failed to copy dayplan' }, { status: 500 })
  }
}
