import { NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth-session'
import { authOptions } from '@/lib/auth'
import { BACKEND_TOKEN_TTL_SECONDS, mintBackendToken } from '@/lib/backend-token'

const NO_STORE = { 'Cache-Control': 'no-store, private' }

// The browser's way to reach the Django backend: see src/lib/auth-fetch.ts.
export async function GET() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  }

  const token = await mintBackendToken(email)
  if (!token) {
    return NextResponse.json({ error: 'Not configured' }, { status: 503, headers: NO_STORE })
  }
  return NextResponse.json({ token, expiresIn: BACKEND_TOKEN_TTL_SECONDS }, { headers: NO_STORE })
}
