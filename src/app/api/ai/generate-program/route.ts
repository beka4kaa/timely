import { NextRequest, NextResponse } from 'next/server'
import { BACKEND_URL } from '@/lib/api-utils'
import { createBackendHeaders } from '@/lib/backend-helpers'

export async function POST(request: NextRequest) {
    try {
        const headers = await createBackendHeaders(request)
        const body = await request.json()

        console.log('Calling backend:', `${BACKEND_URL}/api/ai/generate-program/`)
        
        const response = await fetch(`${BACKEND_URL}/api/ai/generate-program/`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        })

        // Get response as text first to handle HTML error pages
        const responseText = await response.text()
        
        // Try to parse as JSON
        let data
        try {
            data = JSON.parse(responseText)
        } catch {
            // Backend returned non-JSON (likely HTML error page)
            console.error('Backend returned non-JSON response:', {
                status: response.status,
                statusText: response.statusText,
                url: `${BACKEND_URL}/api/ai/generate-program/`,
                responsePreview: responseText.substring(0, 500)
            })
            return NextResponse.json({
                error: 'Backend service error',
                details: `Backend returned ${response.status} ${response.statusText}. The service may be down or restarting.`,
                backendUrl: BACKEND_URL
            }, { status: 502 })
        }

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
