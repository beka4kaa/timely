// Authenticated API client that sends user email header
// This wraps all API calls to include the X-User-Email header from the session

import { getSession } from "next-auth/react"

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const session = await getSession()
    const userEmail = session?.user?.email

    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(userEmail && { 'X-User-Email': userEmail }),
        ...options.headers,
    }

    return fetch(url, {
        ...options,
        headers,
    })
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
