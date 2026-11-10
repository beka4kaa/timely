import { withAuth } from "next-auth/middleware"
import { NextResponse } from "next/server"
import {
  DEFAULT_APP_HOSTNAME,
  DEFAULT_APP_ORIGIN,
  DEFAULT_MARKETING_HOSTNAME,
  getRequestHostname,
  isAppHostname,
  isMarketingHostname,
  isMarketingOnlyPath,
  resolveHostRouting,
  type HostRoutingConfig,
} from "@/lib/host-routing"
import {
  LANDING_LOCALE_COOKIE,
  LANDING_LOCALE_MAX_AGE,
  explicitLandingLocale,
  resolveLandingLocale,
} from "@/lib/landing-locale"
import { SESSION_COOKIE_NAME } from "@/lib/auth-cookies"
import { IS_DEMO, SIGN_IN_PATH } from "@/lib/demo-mode"
import { DEMO_HOST, isDemoHost } from "@/lib/demo-mock/host"

// В демо открыта только страница заведения гостя: вход, регистрация и прочее ведут
// туда же, через обычный редирект на `pages.signIn`.
const DEMO_PUBLIC_PATHS = ['/auth/demo', '/auth/error']

// ===== TEMPORARY DEV BYPASS — REMOVE BEFORE PRODUCTION =====
// Gated on NODE_ENV as well as the flag: NEXT_PUBLIC_ vars are inlined into
// the bundle at build time, so the flag alone must never be enough to switch
// authentication off in a production build.
const DEV_BYPASS_AUTH =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "true"
// ============================================================

const HOST_ROUTING_CONFIG: HostRoutingConfig = {
  demoHostname: DEMO_HOST,
  marketingHostname:
    process.env.TIMELY_MARKETING_HOST ?? DEFAULT_MARKETING_HOSTNAME,
  appHostname: process.env.TIMELY_APP_HOST ?? DEFAULT_APP_HOSTNAME,
  appOrigin: process.env.TIMELY_APP_ORIGIN ?? DEFAULT_APP_ORIGIN,
  marketingOrigin: process.env.TIMELY_MARKETING_ORIGIN,
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
      // У демо адреса относительные: достраиваем от самого запроса.
      return NextResponse.redirect(new URL(hostAction.destination, req.url), hostAction.status)
    }

    if (hostAction.type === "rewrite") {
      const destination = req.nextUrl.clone()
      destination.pathname = hostAction.pathname
      return NextResponse.rewrite(destination)
    }

    // Первый заход на русскую главную без выбранного языка: тех, кто не читает
    // по-русски, ведём на английскую версию. См. src/lib/landing-locale.ts.
    if (isMarketingHostname(hostname, HOST_ROUTING_CONFIG)) {
      const localeAction = resolveLandingLocale({
        pathname,
        search,
        cookie: req.cookies.get(LANDING_LOCALE_COOKIE)?.value,
        acceptLanguage: req.headers.get("accept-language"),
        userAgent: req.headers.get("user-agent"),
      })
      if (localeAction) {
        const response = NextResponse.redirect(
          new URL(localeAction.destination, req.url),
          localeAction.status,
        )
        // Ответ зависит от языка браузера и куки: общий кэш не должен отдать его другим.
        response.headers.set("Vary", "Accept-Language, Cookie")
        response.headers.set("Cache-Control", "private, no-store")
        return response
      }
      // Русская ссылка переключателя: запоминаем выбор, даже если его кука не записалась.
      if (pathname === "/" && explicitLandingLocale(search) === "ru") {
        const response = NextResponse.next()
        response.cookies.set(LANDING_LOCALE_COOKIE, "ru", {
          path: "/",
          maxAge: LANDING_LOCALE_MAX_AGE,
          sameSite: "lax",
        })
        return response
      }
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
      signIn: SIGN_IN_PATH,
    },
    callbacks: {
      authorized: ({ token, req }) => {
        // ===== TEMPORARY: allow all requests in dev mode =====
        if (DEV_BYPASS_AUTH) return true
        // =====================================================

        const { pathname } = req.nextUrl
        const hostname = getRequestHostname(req.headers)

        // Публичное демо: входа нет, сессию и данные подставляет браузер.
        if (isDemoHost(hostname)) return true

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
        const isPublicPath = (IS_DEMO ? DEMO_PUBLIC_PATHS : publicPaths)
          .some(path => pathname.startsWith(path))

        if (isPublicPath) return true

        // The English landing lives on the marketing host only: on the app
        // host its address must reach the redirect there, not the sign-in page.
        if (isAppHostname(hostname, HOST_ROUTING_CONFIG) && isMarketingOnlyPath(pathname)) {
          return true
        }

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
