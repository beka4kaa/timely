import { NextRequest, NextResponse } from 'next/server'
import { BACKEND_URL } from '@/lib/api-utils'
import { createBackendHeaders } from '@/lib/backend-helpers'

function getUserEmail(headers: HeadersInit): string | null {
  return (headers as Record<string, string>)['X-User-Email'] ?? null
}

async function requireBackendHeaders(request: NextRequest): Promise<{ headers: HeadersInit } | { response: NextResponse }> {
  const headers = await createBackendHeaders(request)
  if (!getUserEmail(headers)) {
    return { response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) }
  }
  return { headers }
}

async function readJson(response: Response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireBackendHeaders(request)
    if ('response' in auth) return auth.response
    const { headers } = auth

    const [goalsResponse, linksResponse] = await Promise.all([
      fetch(`${BACKEND_URL}/api/goals/`, { headers, cache: 'no-store' }),
      fetch(`${BACKEND_URL}/api/goals/links/`, { headers, cache: 'no-store' }),
    ])

    if (!goalsResponse.ok) {
      return NextResponse.json(await readJson(goalsResponse), { status: goalsResponse.status })
    }
    if (!linksResponse.ok) {
      return NextResponse.json(await readJson(linksResponse), { status: linksResponse.status })
    }

    return NextResponse.json({
      goals: await goalsResponse.json(),
      links: await linksResponse.json(),
    })
  } catch (error) {
    console.error('Error fetching goals:', error)
    return NextResponse.json({ error: 'Failed to fetch goals' }, { status: 500 })
  }
}
