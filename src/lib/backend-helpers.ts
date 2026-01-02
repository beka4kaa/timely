import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'https://timely-production-4f5a.up.railway.app'

/**
 * Creates headers for backend API requests with user email from session
 */
export async function createBackendHeaders(request?: NextRequest): Promise<HeadersInit> {
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

/**
 * Makes a GET request to the backend with user auth headers
 */
export async function backendGet(endpoint: string, request?: NextRequest) {
    const headers = await createBackendHeaders(request)
    return fetch(`${BACKEND_URL}${endpoint}`, { headers })
}

/**
 * Makes a POST request to the backend with user auth headers
 */
export async function backendPost(endpoint: string, body: unknown, request?: NextRequest) {
    const headers = await createBackendHeaders(request)
    return fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
    })
}

/**
 * Makes a PUT request to the backend with user auth headers
 */
export async function backendPut(endpoint: string, body: unknown, request?: NextRequest) {
    const headers = await createBackendHeaders(request)
    return fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
    })
}

/**
 * Makes a PATCH request to the backend with user auth headers
 */
export async function backendPatch(endpoint: string, body: unknown, request?: NextRequest) {
    const headers = await createBackendHeaders(request)
    return fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(body),
    })
}

/**
 * Makes a DELETE request to the backend with user auth headers
 */
export async function backendDelete(endpoint: string, request?: NextRequest) {
    const headers = await createBackendHeaders(request)
    return fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'DELETE',
        headers,
    })
}

export { BACKEND_URL }
