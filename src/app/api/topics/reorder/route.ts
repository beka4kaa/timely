import { NextRequest, NextResponse } from 'next/server';
import { BACKEND_URL, toCamelCase, toSnakeCase } from '@/lib/api-utils';
import { createBackendHeaders } from '@/lib/backend-helpers';

export async function POST(request: NextRequest) {
  try {
    const headers = await createBackendHeaders(request);
    const body = await request.json();
    
    const response = await fetch(`${BACKEND_URL}/api/mind/topics/reorder/`, {
      method: 'POST',
      headers,
      body: JSON.stringify(toSnakeCase(body)),
    });

    if (!response.ok) {
      // Try to parse error
      let error;
      try {
        error = await response.json();
      } catch {
        error = await response.text();
      }
      return NextResponse.json(
        { error: error || 'Failed to reorder topics' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(toCamelCase(data));
  } catch (error) {
    console.error('Error reordering topics:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
