import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const { date } = await params
  try {
    const response = await fetch(`${BACKEND_URL}/api/planner/dayplans/${date}/`)
    
    if (response.status === 404) {
      // Create a new dayplan if it doesn't exist
      const createResponse = await fetch(`${BACKEND_URL}/api/planner/dayplans/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      })
      const newData = await createResponse.json()
      return NextResponse.json(newData, { status: createResponse.status })
    }
    
    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching dayplan:', error)
    return NextResponse.json({ error: 'Failed to fetch dayplan' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const { date } = await params
  try {
    const body = await request.json()
    const response = await fetch(`${BACKEND_URL}/api/planner/dayplans/${date}/`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Error updating dayplan:', error)
    return NextResponse.json({ error: 'Failed to update dayplan' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const { date } = await params
  try {
    const response = await fetch(`${BACKEND_URL}/api/planner/dayplans/${date}/`, {
      method: 'DELETE',
    })
    if (response.status === 204) {
      return new NextResponse(null, { status: 204 })
    }
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Error deleting dayplan:', error)
    return NextResponse.json({ error: 'Failed to delete dayplan' }, { status: 500 })
  }
}
