import { NextRequest, NextResponse } from 'next/server';
import { BACKEND_URL, toCamelCase, toSnakeCase } from '@/lib/api-utils';

export async function GET() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/ai_engine/learning-program/`, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch learning program' },
        { status: response.status }
      );
    }

    const data = await response.json();
    // Return the latest program
    const programs = Array.isArray(data) ? data : data.results || [];
    const latestProgram = programs.length > 0 ? toCamelCase(programs[0]) : null;
    
    if (!latestProgram) {
      // Return 200 with null instead of 404 to indicate no program exists yet
      return NextResponse.json(null, { status: 200 });
    }
    
    return NextResponse.json(latestProgram);
  } catch (error) {
    console.error('Error fetching learning program:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const response = await fetch(`${BACKEND_URL}/api/ai_engine/learning-program/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(toSnakeCase(body)),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json(
        { error: error || 'Failed to create learning program' },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(toCamelCase(data), { status: 201 });
  } catch (error) {
    console.error('Error creating learning program:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
