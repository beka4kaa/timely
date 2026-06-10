import { withAuth } from "next-auth/middleware"
import { NextResponse } from "next/server"

// ===== TEMPORARY DEV BYPASS — REMOVE BEFORE PRODUCTION =====
const DEV_BYPASS_AUTH = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "true" || process.env.NODE_ENV === "development"
// ============================================================

export default withAuth(
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
    const publicPaths = ['/auth/signin', '/auth/register']
    const isPublicPath = publicPaths.some(path => pathname.startsWith(path))

    if (isPublicPath && token) {
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
        
        const protectedPaths = ['/dashboard']
        const isProtectedPath = protectedPaths.some(path => pathname.startsWith(path))
        
        const publicPaths = ['/login', '/register']
        const isPublicPath = publicPaths.some(path => pathname.startsWith(path))
        
        if (isPublicPath) return true
        if (isProtectedPath) return !!token
        
        return true
      },
    },
  }
)

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|public).*)',
  ],
}