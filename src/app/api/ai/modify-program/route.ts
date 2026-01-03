import { NextRequest, NextResponse } from 'next/server'
import { BACKEND_URL } from '@/lib/api-utils'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const response = await fetch(`${BACKEND_URL}/api/ai/modify-program/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Error modifying program:', error)
    return NextResponse.json({ error: 'Failed to modify program' }, { status: 500 })
  }
}
