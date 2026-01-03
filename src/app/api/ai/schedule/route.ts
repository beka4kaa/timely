import { NextRequest, NextResponse } from 'next/server'
import { BACKEND_URL } from '@/lib/api-utils'

// AI Schedule endpoint - creates a smart daily schedule
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // This endpoint will use AI to generate a daily schedule
    // For now, we'll create blocks based on topics to study
    const { topics, date, hoursAvailable = 4 } = body
    
    // Try to call a dedicated AI schedule endpoint if it exists
    // Otherwise, generate schedule based on topics
    try {
      const response = await fetch(`${BACKEND_URL}/api/ai/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      
      if (response.ok) {
        const data = await response.json()
        return NextResponse.json(data)
      }
    } catch {
      // Fall through to local generation
    }
    
    // Generate schedule locally if backend endpoint doesn't exist
    const schedule = {
      date,
      blocks: topics?.slice(0, Math.floor(hoursAvailable)).map((topic: any, index: number) => ({
        id: `generated-${Date.now()}-${index}`,
        type: 'LESSON',
        title: topic.name || topic.title || `Study Session ${index + 1}`,
        duration_minutes: 60,
        start_time: `${9 + index}:00`,
        status: 'NOT_STARTED',
        order_index: index,
        color: topic.color || '#3b82f6',
      })) || [],
      recommendations: [
        'Start with the most challenging topics in the morning',
        'Take 10-15 minute breaks between study blocks',
        'Review yesterday\'s topics briefly before starting new ones',
      ],
    }
    
    return NextResponse.json(schedule)
  } catch (error) {
    console.error('Error generating schedule:', error)
    return NextResponse.json({ error: 'Failed to generate schedule' }, { status: 500 })
  }
}
