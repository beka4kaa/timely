import { NextRequest, NextResponse } from 'next/server'
import { BACKEND_URL } from '@/lib/api-utils'
import { createBackendHeaders } from '@/lib/backend-helpers'

export async function POST(request: NextRequest) {
    try {
        const headers = await createBackendHeaders()
        const body = await request.json()
        
        const response = await fetch(`${BACKEND_URL}/api/subjects/reorder/`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        })

        if (!response.ok) {
            const error = await response.text()
            return NextResponse.json({ error }, { status: response.status })
        }

        const data = await response.json()
        return NextResponse.json(data)
    } catch (error) {
        console.error('Error reordering subjects:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
