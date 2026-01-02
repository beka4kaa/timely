import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    
    let url = `${BACKEND_URL}/api/planner/dayplans/`
    const queryParams = new URLSearchParams()
    if (from) queryParams.append('from', from)
    if (to) queryParams.append('to', to)
    if (queryParams.toString()) {
      url += `?${queryParams.toString()}`
    }
    
    const response = await fetch(url)
    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching dayplans:', error)
    return NextResponse.json({ error: 'Failed to fetch dayplans' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const response = await fetch(`${BACKEND_URL}/api/planner/dayplans/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Error creating dayplan:', error)
    return NextResponse.json({ error: 'Failed to create dayplan' }, { status: 500 })
  }
}
