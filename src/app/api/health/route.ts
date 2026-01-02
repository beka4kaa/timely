import { NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

export async function GET() {
  try {
    const response = await fetch(`${BACKEND_URL}/health/`)
    const data = await response.json()
    return NextResponse.json({
      frontend: 'healthy',
      backend: data.status || 'unknown',
    })
  } catch (error) {
    return NextResponse.json({
      frontend: 'healthy',
      backend: 'unreachable',
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
