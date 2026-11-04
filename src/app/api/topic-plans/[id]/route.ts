import { NextRequest, NextResponse } from 'next/server';
import { BACKEND_URL, toCamelCase, toSnakeCase } from '@/lib/api-utils';
import { createBackendHeaders } from '@/lib/backend-helpers';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  try {
  
    const headers = await createBackendHeaders();
    const response = await fetch(`${BACKEND_URL}/api/ai_engine/topic-plans/${id}/`, {
      headers,
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch topic plan' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(toCamelCase(data));
  } catch (error) {
    console.error('Error fetching topic plan:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  try {
  
    const headers = await createBackendHeaders();
    const body = await request.json();
    
    const response = await fetch(`${BACKEND_URL}/api/ai_engine/topic-plans/${id}/`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(toSnakeCase(body)),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: error || 'Failed to update topic plan' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(toCamelCase(data));
  } catch (error) {
    console.error('Error updating topic plan:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  
  try {
  
    const headers = await createBackendHeaders();
    const response = await fetch(`${BACKEND_URL}/api/ai_engine/topic-plans/${id}/`, {
      method: 'DELETE',
      headers,
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to delete topic plan' },
        { status: response.status }
      );
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Error deleting topic plan:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
