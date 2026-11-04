import { NextRequest, NextResponse } from 'next/server'
import { BACKEND_URL } from '@/lib/api-utils'
import { createBackendHeaders, hasBackendIdentity } from '@/lib/backend-helpers'

async function readJson(response: Response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  try {
    const headers = await createBackendHeaders()
    if (!hasBackendIdentity(headers)) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const body = await request.json()
    const response = await fetch(`${BACKEND_URL}/api/goals/bulk_sync/`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      cache: 'no-store',
    })

    const data = await readJson(response)
    return NextResponse.json(data, { status: response.status })
  } catch (error) {
    console.error('Error syncing goals:', error)
    return NextResponse.json({ error: 'Failed to sync goals' }, { status: 500 })
  }
}
