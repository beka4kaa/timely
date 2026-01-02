import { NextRequest, NextResponse } from 'next/server'
import { BACKEND_URL } from '@/lib/api-utils'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const days = searchParams.get('days') || '14'
    
    const response = await fetch(`${BACKEND_URL}/api/mind/sessions/`)
    const data = await response.json()
    
    // Filter by date range if days parameter is provided
    if (days) {
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - parseInt(days))
      
      const filteredData = data.filter((session: any) => {
        const sessionDate = new Date(session.started_at)
        return sessionDate >= cutoffDate
      })
      
      return NextResponse.json(filteredData)
    }
    
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching mind sessions:', error)
    return NextResponse.json({ error: 'Failed to fetch mind sessions' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const response = await fetch(`${BACKEND_URL}/api/mind/sessions/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Error creating mind session:', error)
    return NextResponse.json({ error: 'Failed to create mind session' }, { status: 500 })
  }
}
