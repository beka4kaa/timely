import { NextRequest, NextResponse } from 'next/server'
import { BACKEND_URL } from '@/lib/api-utils'
import { createBackendHeaders } from '@/lib/backend-helpers'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const headers = await createBackendHeaders(request)
    const response = await fetch(`${BACKEND_URL}/api/mind/topics/${id}/`, { headers })
    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching topic:', error)
    return NextResponse.json({ error: 'Failed to fetch topic' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const headers = await createBackendHeaders(request)
    const body = await request.json()
    const response = await fetch(`${BACKEND_URL}/api/mind/topics/${id}/`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    })
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Error updating topic:', error)
    return NextResponse.json({ error: 'Failed to update topic' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const headers = await createBackendHeaders(request)
    const body = await request.json()
    const response = await fetch(`${BACKEND_URL}/api/mind/topics/${id}/`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    })
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Error updating topic:', error)
    return NextResponse.json({ error: 'Failed to update topic' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const headers = await createBackendHeaders(request)
    const response = await fetch(`${BACKEND_URL}/api/mind/topics/${id}/`, {
      method: 'DELETE',
      headers,
    })
    if (response.status === 204) {
      return new NextResponse(null, { status: 204 })
    }
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Error deleting topic:', error)
    return NextResponse.json({ error: 'Failed to delete topic' }, { status: 500 })
  }
}
