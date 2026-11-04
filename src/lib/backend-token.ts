// Server-side only: signs the token that tells the Django backend who is calling.
//
// The backend lives on another origin, so the NextAuth cookie never reaches it.
// A token is signed here from a session the caller has already proved, and
// backend/config/middleware.py verifies it with the same secret. That secret is
// deliberately not NEXTAUTH_SECRET, so the backend cannot forge sessions.

import { SignJWT } from 'jose'

export const BACKEND_TOKEN_TTL_SECONDS = 600

// Must match TOKEN_ISSUER and TOKEN_AUDIENCE in backend/config/middleware.py.
const TOKEN_ISSUER = 'timely-web'
const TOKEN_AUDIENCE = 'timely-api'

/** Null when the secret is not configured; the backend then answers 401. */
export async function mintBackendToken(email: string): Promise<string | null> {
  const secret = process.env.TIMELY_API_JWT_SECRET
  if (!secret) return null

  const now = Math.floor(Date.now() / 1000)
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setSubject(email)
    .setIssuedAt(now)
    .setExpirationTime(now + BACKEND_TOKEN_TTL_SECONDS)
    .sign(new TextEncoder().encode(secret))
}

/**
 * Headers that identify `email` to the backend. Pass only an address read from
 * the session, never one taken from the incoming request.
 */
export async function backendIdentityHeaders(email: string): Promise<Record<string, string>> {
  const token = await mintBackendToken(email)
  return token ? { Authorization: `Bearer ${token}` } : {}
}
