import { withAuth } from "next-auth/middleware"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

// ===== TEMPORARY DEV BYPASS — REMOVE BEFORE PRODUCTION =====
// Only active in local dev. NEXT_PUBLIC_ vars can leak into a prod build,
// so this is gated on NODE_ENV too — a stray env var alone can't disable
// auth in production anymore.
const DEV_BYPASS_AUTH = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "true"
// ============================================================

const APP_HOST = 'app.timelyplan.me'
const APEX_HOSTS = new Set(['timelyplan.me', 'www.timelyplan.me'])

// Paths that only make sense on the app subdomain — the apex domain is the
// marketing/landing site and should redirect these straight to app.*.
const APP_ONLY_PATHS = ['/dashboard', '/auth', '/register']

// Single source of truth for the auth pages — previously the redirect
// logic and the `authorized` callback kept separate, drifted copies of
// this list (one said '/auth/signin', the other said '/login').
const AUTH_PATHS = ['/auth/signin', '/auth/register']
const PROTECTED_PATHS = ['/dashboard']

function isApexHost(host: string) {
  return APEX_HOSTS.has(host)
}

const authMiddleware = withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl
    const token = req.nextauth.token

    // ===== TEMPORARY: skip all auth redirects in dev mode =====
    if (DEV_BYPASS_AUTH) {
      // Still redirect root to dashboard for convenience
      if (pathname === '/') {
        return NextResponse.redirect(new URL('/dashboard', req.url))
      }
      return NextResponse.next()
    }
    // ===========================================================

    // Redirect authenticated users away from auth pages
    const isAuthPath = AUTH_PATHS.some(path => pathname.startsWith(path))

    if (isAuthPath && token) {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }

    // Redirect root to appropriate page
    if (pathname === '/') {
      if (token) {
        return NextResponse.redirect(new URL('/dashboard', req.url))
      } else {
        return NextResponse.redirect(new URL('/auth/signin', req.url))
      }
    }

    return NextResponse.next()
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        // ===== TEMPORARY: allow all requests in dev mode =====
        if (DEV_BYPASS_AUTH) return true
        // =====================================================

        const { pathname } = req.nextUrl

        const isProtectedPath = PROTECTED_PATHS.some(path => pathname.startsWith(path))
        const isPublicPath = AUTH_PATHS.some(path => pathname.startsWith(path))

        if (isPublicPath) return true
        if (isProtectedPath) return !!token

        return true
      },
    },
  }
)

export default function middleware(req: NextRequest, event: any) {
  const host = req.headers.get('host') ?? ''

  // The apex domain (timelyplan.me) is the marketing site. It never runs
  // the auth check — that's exactly what was producing a redirect loop
  // (apex requiring a token it can no longer see, bouncing to signin,
  // signin redirecting back to a dashboard URL on the wrong host).
  // Instead, send app-only paths straight to app.timelyplan.me and let
  // everything else (the future landing page, static assets) pass through.
  if (isApexHost(host)) {
    const { pathname } = req.nextUrl
    const isAppOnlyPath = pathname === '/' || APP_ONLY_PATHS.some(path => pathname.startsWith(path))

    if (isAppOnlyPath) {
      const target = new URL(req.nextUrl.pathname + req.nextUrl.search, `https://${APP_HOST}`)
      return NextResponse.redirect(target, 308)
    }

    return NextResponse.next()
  }

  // app.timelyplan.me (and localhost in dev) — normal auth-aware routing.
  return (authMiddleware as any)(req, event)
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|public).*)',
  ],
}