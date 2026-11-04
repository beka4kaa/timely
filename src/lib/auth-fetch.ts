// Authenticated API client for the browser.
//
// The Django backend lives on another origin, so the NextAuth cookie never
// reaches it. /api/auth/backend-token turns the session into a short-lived signed
// token, and every call carries it as a bearer token. The token stays in memory:
// never in localStorage, a cookie or a URL.

const TOKEN_ROUTE = '/api/auth/backend-token'

// Renew early, so that a token cannot expire on its way to the backend.
const RENEW_MARGIN_MS = 60_000
// How long to remember that the server has no token to give, so a deployment
// without the secret doesn't add a round trip to every call.
const NO_TOKEN_RETRY_MS = 30_000

type BackendIdentity = {
    token: string | null
    email: string | null
    validUntil: number
    signedOut?: boolean
}

let current: BackendIdentity | null = null
let inFlight: Promise<BackendIdentity> | null = null

async function requestIdentity(): Promise<BackendIdentity> {
    try {
        const response = await fetch(TOKEN_ROUTE, { cache: 'no-store' })
        if (response.status === 401) {
            return { token: null, email: null, validUntil: 0, signedOut: true }
        }
        if (response.ok) {
            const { token, email, expiresIn } = await response.json()
            // Counted from now, not from the token's own `exp`: a student's
            // clock can be wrong, and the backend only compares server clocks.
            const validUntil = token
                ? Date.now() + expiresIn * 1000 - RENEW_MARGIN_MS
                : Date.now() + NO_TOKEN_RETRY_MS
            return { token, email, validUntil }
        }
    } catch {
        // Offline or a failed deployment: try again on the next call.
    }
    return { token: null, email: null, validUntil: 0 }
}

function loadIdentity({ renew = false } = {}): Promise<BackendIdentity> {
    if (!renew && current && Date.now() < current.validUntil) {
        return Promise.resolve(current)
    }
    if (!inFlight) {
        const request: Promise<BackendIdentity> = requestIdentity().then((identity) => {
            // If another tab changed who this is meanwhile, this answer is stale.
            if (inFlight === request) {
                current = identity
                inFlight = null
            }
            return identity
        })
        inFlight = request
    }
    return inFlight
}

function identityHeaders(identity: BackendIdentity): Record<string, string> {
    return {
        ...(identity.token && { Authorization: `Bearer ${identity.token}` }),
        // Until the backend enforces tokens (API_AUTH_ENFORCE), so that this code
        // keeps working against a backend that has not deployed yet.
        ...(identity.email && { 'X-User-Email': identity.email }),
    }
}

function redirectToSignIn() {
    if (typeof window === 'undefined') return
    const { pathname, search } = window.location
    if (pathname.startsWith('/auth/')) return
    window.location.assign(`/auth/signin?callbackUrl=${encodeURIComponent(pathname + search)}`)
}

// Signing out or in from another tab changes who this tab is.
if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
        if (event.key === 'nextauth.message') {
            current = null
            inFlight = null
        }
    })
}

/** For requests that can't go through authFetch, such as an XHR with progress. */
export async function backendAuthHeaders(): Promise<Record<string, string>> {
    return identityHeaders(await loadIdentity())
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const send = (identity: BackendIdentity) =>
        fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...identityHeaders(identity),
                ...options.headers,
            },
        })

    const response = await send(await loadIdentity())
    if (response.status !== 401) return response

    // The token can run out on the way, so try once more with a fresh one.
    const renewed = await loadIdentity({ renew: true })
    if (renewed.signedOut) {
        redirectToSignIn()
        return response
    }
    // A 401 with a fresh token is a backend problem. It is returned rather than
    // sent to the sign-in page, because signing in again would not fix it and a
    // Google session would loop straight back here.
    return renewed.token ? send(renewed) : response
}

// Helper for GET requests
export async function authGet(url: string): Promise<Response> {
    return authFetch(url, { method: 'GET' })
}

// Helper for POST requests
export async function authPost(url: string, data?: unknown): Promise<Response> {
    return authFetch(url, {
        method: 'POST',
        body: data ? JSON.stringify(data) : undefined,
    })
}

// Helper for PUT requests
export async function authPut(url: string, data?: unknown): Promise<Response> {
    return authFetch(url, {
        method: 'PUT',
        body: data ? JSON.stringify(data) : undefined,
    })
}

// Helper for PATCH requests
export async function authPatch(url: string, data?: unknown): Promise<Response> {
    return authFetch(url, {
        method: 'PATCH',
        body: data ? JSON.stringify(data) : undefined,
    })
}

// Helper for DELETE requests
export async function authDelete(url: string): Promise<Response> {
    return authFetch(url, { method: 'DELETE' })
}
