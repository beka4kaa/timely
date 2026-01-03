import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'https://timely-backend-production.up.railway.app'

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        
        const response = await fetch(`${BACKEND_URL}/api/subjects/reorder/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': request.headers.get('cookie') || '',
            },
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
