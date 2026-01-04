import { NextRequest, NextResponse } from 'next/server'
import { BACKEND_URL } from '@/lib/api-utils'
import { createBackendHeaders } from '@/lib/backend-helpers'

export async function POST(request: NextRequest) {
    try {
        const headers = await createBackendHeaders(request)
        const body = await request.json()

        const response = await fetch(`${BACKEND_URL}/api/ai/generate-program/`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        })

        const data = await response.json()

        // If backend returned an error, log it for debugging
        if (!response.ok) {
            console.error('Backend error:', {
                status: response.status,
                data,
                body
            })
        }

        return NextResponse.json(data, { status: response.status })
    } catch (error) {
        console.error('Error generating program:', error)
        return NextResponse.json({
            error: 'Failed to generate program',
            details: error instanceof Error ? error.message : String(error)
        }, { status: 500 })
    }
}
