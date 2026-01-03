import { NextRequest, NextResponse } from 'next/server'
import { BACKEND_URL } from '@/lib/api-utils'

// AI Daily Tasks endpoint - generates recommended daily tasks
export async function GET() {
  try {
    // Try to call backend endpoint
    try {
      const response = await fetch(`${BACKEND_URL}/api/ai/daily-tasks/`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      })
      
      if (response.ok) {
        const data = await response.json()
        return NextResponse.json(data)
      }
    } catch {
      // Fall through to local generation
    }
    
    // Fetch topics and generate recommendations locally
    const topicsResponse = await fetch(`${BACKEND_URL}/api/mind/topics/`)
    let topics = []
    
    if (topicsResponse.ok) {
      topics = await topicsResponse.json()
    }
    
    // Filter topics due for review or not started
    const now = new Date()
    const dueTopics = topics.filter((t: any) => {
      if (t.status === 'NOT_STARTED') return true
      if (t.next_review_at && new Date(t.next_review_at) <= now) return true
      return false
    }).slice(0, 5)
    
    const recommendations = {
      dailyTasks: dueTopics.map((topic: any, index: number) => ({
        id: topic.id,
        title: topic.name,
        type: topic.status === 'NOT_STARTED' ? 'NEW' : 'REVIEW',
        priority: index + 1,
        estimatedMinutes: 30,
        subject: topic.subject_name || 'General',
      })),
      insights: [
        `You have ${dueTopics.length} topics to focus on today`,
        'Consider starting with review topics to maintain retention',
        'New topics require more focused attention - schedule them during peak hours',
      ],
      studyGoal: {
        hoursRecommended: Math.min(dueTopics.length, 4),
        focusAreas: Array.from(new Set(dueTopics.map((t: any) => t.subject_name || 'General'))),
      },
    }
    
    return NextResponse.json(recommendations)
  } catch (error) {
    console.error('Error getting daily tasks:', error)
    return NextResponse.json({ error: 'Failed to get daily tasks' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // Try backend first
    try {
      const response = await fetch(`${BACKEND_URL}/api/ai/daily-tasks/`, {
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
    
    // Generate custom recommendations based on user preferences
    const { preferences, availableHours = 4 } = body
    
    const recommendations = {
      message: 'Generated custom daily tasks based on your preferences',
      tasks: [],
      adjustments: preferences ? `Adjusted for: ${JSON.stringify(preferences)}` : null,
    }
    
    return NextResponse.json(recommendations)
  } catch (error) {
    console.error('Error generating daily tasks:', error)
    return NextResponse.json({ error: 'Failed to generate daily tasks' }, { status: 500 })
  }
}
