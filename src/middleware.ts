import { withAuth } from "next-auth/middleware"
import { NextResponse } from "next/server"
import {
  DEFAULT_APP_HOSTNAME,
  DEFAULT_APP_ORIGIN,
  DEFAULT_MARKETING_HOSTNAME,
  getRequestHostname,
  isAppHostname,
  isMarketingHostname,
  resolveHostRouting,
  type HostRoutingConfig,
} from "@/lib/host-routing"
import { SESSION_COOKIE_NAME } from "@/lib/auth-cookies"

// ===== TEMPORARY DEV BYPASS — REMOVE BEFORE PRODUCTION =====
// Gated on NODE_ENV as well as the flag: NEXT_PUBLIC_ vars are inlined into
// the bundle at build time, so the flag alone must never be enough to switch
// authentication off in a production build.
const DEV_BYPASS_AUTH =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "true"
// ============================================================

const HOST_ROUTING_CONFIG: HostRoutingConfig = {
  marketingHostname:
    process.env.TIMELY_MARKETING_HOST ?? DEFAULT_MARKETING_HOSTNAME,
  appHostname: process.env.TIMELY_APP_HOST ?? DEFAULT_APP_HOSTNAME,
  appOrigin: process.env.TIMELY_APP_ORIGIN ?? DEFAULT_APP_ORIGIN,
}

export default withAuth(
  function middleware(req) {
    const { pathname, search } = req.nextUrl
    const token = req.nextauth.token
    const hostname = getRequestHostname(req.headers)
    const hostAction = resolveHostRouting(
      { hostname, pathname, search },
      HOST_ROUTING_CONFIG,
    )

    if (hostAction.type === "redirect") {
      return NextResponse.redirect(hostAction.destination, hostAction.status)
    }

    if (hostAction.type === "rewrite") {
      const destination = req.nextUrl.clone()
      destination.pathname = hostAction.pathname
      return NextResponse.rewrite(destination)
    }

    // ===== TEMPORARY: skip all auth redirects in dev mode =====
    if (DEV_BYPASS_AUTH) {
      return NextResponse.next()
    }
    // ===========================================================

    // Redirect authenticated users away from auth pages
    const publicPaths = ['/auth/signin', '/auth/register']
    const isPublicPath = publicPaths.some(path => pathname.startsWith(path))

    if (isPublicPath && token) {
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }

    return NextResponse.next()
  },
  {
    // Must match what authOptions writes, otherwise getToken guesses the name
    // from the Edge runtime's view of NEXTAUTH_URL/VERCEL and silently finds
    // no token — which is exactly what caused the sign-in redirect loop.
    cookies: {
      sessionToken: { name: SESSION_COOKIE_NAME },
    },
    // Without this, signInPage defaults to /api/auth/signin, adding a pointless
    // extra redirect hop before the real /auth/signin page.
    pages: {
      signIn: '/auth/signin',
    },
    callbacks: {
      authorized: ({ token, req }) => {
        // ===== TEMPORARY: allow all requests in dev mode =====
        if (DEV_BYPASS_AUTH) return true
        // =====================================================

        const { pathname } = req.nextUrl
        const hostname = getRequestHostname(req.headers)

        // The marketing /dashboard URL must reach the canonical redirect even
        // for signed-out visitors.
        if (
          isMarketingHostname(hostname, HOST_ROUTING_CONFIG) &&
          (pathname === "/dashboard" || pathname.startsWith("/dashboard/"))
        ) {
          return true
        }

        const publicPaths = [
          '/auth/signin',
          '/auth/register',
          '/auth/error',
          '/register',
        ]
        const isPublicPath = publicPaths.some(path => pathname.startsWith(path))

        if (isPublicPath) return true

        // Clean app-subdomain paths are dashboard routes after the internal
        // rewrite, so protect them before the rewrite occurs.
        if (isAppHostname(hostname, HOST_ROUTING_CONFIG)) {
          return !!token
        }

        const protectedPaths = ['/dashboard']
        const isProtectedPath = protectedPaths.some(path => pathname.startsWith(path))

        if (isProtectedPath) return !!token

        return true
      },
    },
  }
)

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)',
  ],
}
