import { NextRequest, NextResponse } from 'next/server'
import { BACKEND_URL } from '@/lib/api-utils'
import { createBackendHeaders } from '@/lib/backend-helpers'

// Transform snake_case to camelCase for frontend
function toCamelCase(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(toCamelCase)
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj).reduce((acc, key) => {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
      acc[camelKey] = toCamelCase(obj[key])
      return acc
    }, {} as any)
  }
  return obj
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  const { date } = await params
  try {
    const headers = await createBackendHeaders()
    const response = await fetch(`${BACKEND_URL}/api/planner/dayplans/${date}/`, { headers })
    
    if (response.status === 404) {
      // Create a new dayplan if it doesn't exist
      const createResponse = await fetch(`${BACKEND_URL}/api/planner/dayplans/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ date }),
      })
      const newData = await createResponse.json()
      return NextResponse.json(toCamelCase(newData), { status: createResponse.status })
    }
    
    const data = await response.json()
    return NextResponse.json(toCamelCase(data))
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
    const headers = await createBackendHeaders()
    const body = await request.json()
    const response = await fetch(`${BACKEND_URL}/api/planner/dayplans/${date}/`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    })
    const data = await response.json()
    return NextResponse.json(toCamelCase(data), { status: response.status })
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
    const headers = await createBackendHeaders()
    const response = await fetch(`${BACKEND_URL}/api/planner/dayplans/${date}/`, {
      method: 'DELETE',
      headers,
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
