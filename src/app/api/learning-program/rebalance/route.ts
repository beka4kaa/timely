import { NextRequest, NextResponse } from 'next/server';
import { BACKEND_URL, toCamelCase, toSnakeCase } from '@/lib/api-utils';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const response = await fetch(`${BACKEND_URL}/api/ai_engine/learning-program/rebalance/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(toSnakeCase(body)),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: error || 'Failed to rebalance program' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(toCamelCase(data));
  } catch (error) {
    console.error('Error rebalancing program:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
