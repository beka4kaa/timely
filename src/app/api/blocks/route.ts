import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

// Transform camelCase to snake_case for backend
function toSnakeCase(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(toSnakeCase)
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj).reduce((acc, key) => {
      const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase()
      acc[snakeKey] = toSnakeCase(obj[key])
      return acc
    }, {} as any)
  }
  return obj
}

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

export async function GET() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/planner/blocks/`)
    const data = await response.json()
    return NextResponse.json(toCamelCase(data))
  } catch (error) {
    console.error('Error fetching blocks:', error)
    return NextResponse.json({ error: 'Failed to fetch blocks' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // Transform frontend data to backend format
    const backendData = toSnakeCase(body)
    
    // Create the block first
    const blockResponse = await fetch(`${BACKEND_URL}/api/planner/blocks/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(backendData),
    })
    
    if (!blockResponse.ok) {
      const error = await blockResponse.json()
      return NextResponse.json(error, { status: blockResponse.status })
    }
    
    const block = await blockResponse.json()
    
    // Create segments if provided
    if (body.segments && body.segments.length > 0) {
      for (let i = 0; i < body.segments.length; i++) {
        const segment = body.segments[i]
        if (segment.title?.trim()) {
          await fetch(`${BACKEND_URL}/api/planner/segments/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              block: block.id,
              title: segment.title,
              duration_minutes: segment.durationMinutes || segment.duration_minutes || 25,
              status: 'NOT_STARTED',
              order_index: i,
            }),
          })
        }
      }
    }
    
    // Create subtasks if provided
    if (body.subtasks && body.subtasks.length > 0) {
      for (let i = 0; i < body.subtasks.length; i++) {
        const subtask = body.subtasks[i]
        if (subtask.title?.trim()) {
          await fetch(`${BACKEND_URL}/api/planner/subtasks/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              block: block.id,
              title: subtask.title,
              is_done: false,
              order_index: i,
            }),
          })
        }
      }
    }
    
    // Fetch the complete block with segments and subtasks
    const completeBlockResponse = await fetch(`${BACKEND_URL}/api/planner/blocks/${block.id}/`)
    const completeBlock = await completeBlockResponse.json()
    
    return NextResponse.json(toCamelCase(completeBlock), { status: 201 })
  } catch (error) {
    console.error('Error creating block:', error)
    return NextResponse.json({ error: 'Failed to create block' }, { status: 500 })
  }
}
