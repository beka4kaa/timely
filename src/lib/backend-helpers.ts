import { getServerSession } from '@/lib/auth-session'
import { authOptions } from '@/lib/auth'
import { BACKEND_URL } from '@/lib/api-utils'
import { backendIdentityHeaders } from '@/lib/backend-token'

/**
 * Creates headers for backend API requests from the caller's session.
 *
 * Identity comes from the session and nothing else. An x-user-email header on
 * the incoming request is something any caller can type.
 */
export async function createBackendHeaders(): Promise<Record<string, string>> {
    const session = await getServerSession(authOptions)
    const email = session?.user?.email
    return {
        'Content-Type': 'application/json',
        ...(email && (await backendIdentityHeaders(email))),
    }
}

/** Whether createBackendHeaders found a signed-in session. */
export function hasBackendIdentity(headers: Record<string, string>): boolean {
    return Boolean(headers['Authorization'])
}

/**
 * Makes a GET request to the backend with user auth headers
 */
export async function backendGet(endpoint: string) {
    const headers = await createBackendHeaders()
    return fetch(`${BACKEND_URL}${endpoint}`, { headers })
}

/**
 * Makes a POST request to the backend with user auth headers
 */
export async function backendPost(endpoint: string, body: unknown) {
    const headers = await createBackendHeaders()
    return fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    })
}

/**
 * Makes a PUT request to the backend with user auth headers
 */
export async function backendPut(endpoint: string, body: unknown) {
    const headers = await createBackendHeaders()
    return fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
    })
}

/**
 * Makes a PATCH request to the backend with user auth headers
 */
export async function backendPatch(endpoint: string, body: unknown) {
    const headers = await createBackendHeaders()
    return fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
    })
}

/**
 * Makes a DELETE request to the backend with user auth headers
 */
export async function backendDelete(endpoint: string) {
    const headers = await createBackendHeaders()
    return fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'DELETE',
        headers,
    })
}

export { BACKEND_URL }
