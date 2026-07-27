/**
 * Single source of truth for the NextAuth session cookie name.
 *
 * This module is imported by BOTH runtimes:
 *   - Node.js  — `authOptions` in `src/lib/auth.ts` (writes the cookie)
 *   - Edge     — `withAuth` in `src/middleware.ts` (reads the cookie)
 *
 * Keeping it here is the whole point. If the name is only set on the write
 * side, next-auth's `getToken` falls back to guessing it from NEXTAUTH_URL /
 * VERCEL *as seen by the Edge bundle* (node_modules/next-auth/jwt/index.js),
 * so the two runtimes derive the same name from different signals and agree
 * only by luck. When they disagree, middleware never finds a token and every
 * login bounces back to the sign-in page.
 *
 * `NODE_ENV` is the one signal Next.js inlines as a literal into both the
 * Node and the Edge bundle at build time, so it is safe to branch on here.
 *
 * The name deliberately does NOT start with `next-auth.` — a fresh name also
 * sidesteps any legacy `__Secure-next-auth.session-token` cookies (host-only
 * and `Domain=.timelyplan.me` variants) left over from earlier attempts, which
 * would otherwise shadow each other since only the first match is read.
 *
 * Note: the `__Secure-` prefix requires the `Secure` attribute over HTTPS,
 * which is why it is only used in production. Do not switch to `__Host-`:
 * that prefix forbids a `Domain` attribute and imposes `Path=/`.
 */
export const USE_SECURE_COOKIES = process.env.NODE_ENV === 'production'

export const SESSION_COOKIE_NAME = USE_SECURE_COOKIES
  ? '__Secure-timely.session-token'
  : 'timely.session-token'
