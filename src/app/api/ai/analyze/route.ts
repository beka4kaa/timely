import { NextRequest, NextResponse } from 'next/server'
import { BACKEND_URL } from '@/lib/api-utils'
import { createBackendHeaders } from '@/lib/backend-helpers'

export async function GET(request: NextRequest) {
  try {
    const headers = await createBackendHeaders(request)
    const response = await fetch(`${BACKEND_URL}/api/ai/analyze/`, {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    })
    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error analyzing:', error)
    return NextResponse.json({ error: 'Failed to analyze' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const headers = await createBackendHeaders(request)
    const body = await request.json()
    const response = await fetch(`${BACKEND_URL}/api/ai/analyze/`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Error analyzing:', error)
    return NextResponse.json({ error: 'Failed to analyze' }, { status: 500 })
  }
}
