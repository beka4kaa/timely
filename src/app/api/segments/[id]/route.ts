import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    // Get segment from backend - segments are nested under blocks
    // We need to fetch the segment directly
    const response = await fetch(`${BACKEND_URL}/api/planner/blocks/`)
    const blocks = await response.json()
    
    // Find segment in blocks
    for (const block of blocks) {
      const segment = block.segments?.find((s: any) => s.id === id)
      if (segment) {
        return NextResponse.json(segment)
      }
    }
    
    return NextResponse.json({ error: 'Segment not found' }, { status: 404 })
  } catch (error) {
    console.error('Error fetching segment:', error)
    return NextResponse.json({ error: 'Failed to fetch segment' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const body = await request.json()
    // Note: Django REST Framework would need a separate Segment ViewSet endpoint
    // For now, we'll create a direct endpoint
    const response = await fetch(`${BACKEND_URL}/api/planner/segments/${id}/`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    
    if (!response.ok) {
      // Fallback: try PATCH on the segment via a custom action
      return NextResponse.json({ error: 'Segment update not available' }, { status: 501 })
    }
    
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Error updating segment:', error)
    return NextResponse.json({ error: 'Failed to update segment' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const body = await request.json()
    const response = await fetch(`${BACKEND_URL}/api/planner/segments/${id}/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    
    if (!response.ok) {
      return NextResponse.json({ error: 'Segment update not available' }, { status: 501 })
    }
    
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Error updating segment:', error)
    return NextResponse.json({ error: 'Failed to update segment' }, { status: 500 })
  }
}
