import { NextRequest, NextResponse } from 'next/server'
import { BACKEND_URL, toCamelCase, toSnakeCase } from '@/lib/api-utils'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

async function getHeaders(request?: NextRequest) {
  // Try to get user email from incoming request header first
  let userEmail = request?.headers.get('x-user-email')

  // If not in header, get from session
  if (!userEmail) {
    const session = await getServerSession(authOptions)
    userEmail = session?.user?.email || null
  }

  const headers: HeadersInit = { 'Content-Type': 'application/json' }
  if (userEmail) {
    headers['X-User-Email'] = userEmail
  }
  return headers
}

export async function GET(request: NextRequest) {
  try {
    const headers = await getHeaders(request)
    const response = await fetch(`${BACKEND_URL}/api/mind/subjects`, { headers })
    const data = await response.json()
    return NextResponse.json(toCamelCase(data))
  } catch (error) {
    console.error('Error fetching subjects:', error)
    return NextResponse.json({ error: 'Failed to fetch subjects' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const headers = await getHeaders(request)
    const body = await request.json()
    const response = await fetch(`${BACKEND_URL}/api/mind/subjects`, {
      method: 'POST',
      headers,
      body: JSON.stringify(toSnakeCase(body)),
    })
    const data = await response.json()
    return NextResponse.json(toCamelCase(data), { status: response.status })
  } catch (error) {
    console.error('Error creating subject:', error)
    return NextResponse.json({ error: 'Failed to create subject' }, { status: 500 })
  }
}
