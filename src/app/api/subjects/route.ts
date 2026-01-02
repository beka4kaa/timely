import { NextRequest, NextResponse } from 'next/server'
import { BACKEND_URL, toCamelCase, toSnakeCase } from '@/lib/api-utils'

export async function GET() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/mind/subjects/`)
    const data = await response.json()
    return NextResponse.json(toCamelCase(data))
  } catch (error) {
    console.error('Error fetching subjects:', error)
    return NextResponse.json({ error: 'Failed to fetch subjects' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const response = await fetch(`${BACKEND_URL}/api/mind/subjects/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toSnakeCase(body)),
    })
    const data = await response.json()
    return NextResponse.json(toCamelCase(data), { status: response.status })
  } catch (error) {
    console.error('Error creating subject:', error)
    return NextResponse.json({ error: 'Failed to create subject' }, { status: 500 })
  }
}
