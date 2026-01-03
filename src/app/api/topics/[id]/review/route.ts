import { NextRequest, NextResponse } from 'next/server'
import { BACKEND_URL, toCamelCase, toSnakeCase } from '@/lib/api-utils'
import { createBackendHeaders } from '@/lib/backend-helpers'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const headers = await createBackendHeaders(request)
    const body = await request.json()
    const response = await fetch(`${BACKEND_URL}/api/mind/topics/${id}/review/`, {
      method: 'POST',
      headers,
      body: JSON.stringify(toSnakeCase(body)),
    })
    const data = await response.json()
    return NextResponse.json(toCamelCase(data), { status: response.status })
  } catch (error) {
    console.error('Error reviewing topic:', error)
    return NextResponse.json({ error: 'Failed to review topic' }, { status: 500 })
  }
}
