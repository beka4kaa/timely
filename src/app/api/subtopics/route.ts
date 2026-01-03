import { NextRequest, NextResponse } from 'next/server'
import { BACKEND_URL, toCamelCase, toSnakeCase } from '@/lib/api-utils'
import { createBackendHeaders } from '@/lib/backend-helpers'

export async function GET(request: NextRequest) {
  try {
    const headers = await createBackendHeaders(request)
    const { searchParams } = new URL(request.url)
    const topicId = searchParams.get('topicId')
    
    let url = `${BACKEND_URL}/api/mind/subtopics/`
    if (topicId) {
      url += `?topic_id=${topicId}`
    }
    
    const response = await fetch(url, { headers })
    const data = await response.json()
    return NextResponse.json(toCamelCase(data))
  } catch (error) {
    console.error('Error fetching subtopics:', error)
    return NextResponse.json({ error: 'Failed to fetch subtopics' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const headers = await createBackendHeaders(request)
    const body = await request.json()
    const response = await fetch(`${BACKEND_URL}/api/mind/subtopics/`, {
      method: 'POST',
      headers,
      body: JSON.stringify(toSnakeCase(body)),
    })
    const data = await response.json()
    return NextResponse.json(toCamelCase(data), { status: response.status })
  } catch (error) {
    console.error('Error creating subtopic:', error)
    return NextResponse.json({ error: 'Failed to create subtopic' }, { status: 500 })
  }
}
