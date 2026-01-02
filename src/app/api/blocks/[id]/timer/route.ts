import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

// Timer state management for blocks
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const response = await fetch(`${BACKEND_URL}/api/planner/blocks/${id}/`)
    const data = await response.json()
    return NextResponse.json(data.timer_state || null)
  } catch (error) {
    console.error('Error fetching block timer:', error)
    return NextResponse.json({ error: 'Failed to fetch block timer' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const body = await request.json()
    // Update block with timer state - this will need a custom endpoint in Django
    // For now, we'll update the block status based on timer action
    const action = body.action // 'start', 'pause', 'stop', 'reset'
    
    let status = 'NOT_STARTED'
    if (action === 'start') status = 'IN_PROGRESS'
    else if (action === 'stop') status = 'DONE'
    else if (action === 'pause') status = 'IN_PROGRESS'
    
    const response = await fetch(`${BACKEND_URL}/api/planner/blocks/${id}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, ...body }),
    })
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Error updating block timer:', error)
    return NextResponse.json({ error: 'Failed to update block timer' }, { status: 500 })
  }
}
