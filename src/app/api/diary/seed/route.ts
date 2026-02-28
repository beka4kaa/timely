import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createTemplate, getActiveTemplate, getOrCreateWeek, getMondayOf } from '@/lib/diary-store'

const DEMO_SUBJECTS = [
  { id: 'demo-math',    name: 'Математика', emoji: '📐', color: '#6366f1' },
  { id: 'demo-russian', name: 'Русский язык', emoji: '📝', color: '#ec4899' },
  { id: 'demo-english', name: 'Английский', emoji: '🇬🇧', color: '#3b82f6' },
  { id: 'demo-history', name: 'История', emoji: '📜', color: '#f59e0b' },
  { id: 'demo-physics', name: 'Физика', emoji: '⚡', color: '#10b981' },
  { id: 'demo-lit',     name: 'Литература', emoji: '📖', color: '#8b5cf6' },
]

const DEMO_SCHEDULE: Record<string, Array<{ lessonNumber: number; startTime: string; endTime: string; subjectId: string }>> = {
  monday:    [
    { lessonNumber: 1, startTime: '08:00', endTime: '08:45', subjectId: 'demo-math' },
    { lessonNumber: 2, startTime: '09:00', endTime: '09:45', subjectId: 'demo-russian' },
    { lessonNumber: 3, startTime: '10:00', endTime: '10:45', subjectId: 'demo-english' },
    { lessonNumber: 4, startTime: '11:00', endTime: '11:45', subjectId: 'demo-history' },
  ],
  tuesday:   [
    { lessonNumber: 1, startTime: '08:00', endTime: '08:45', subjectId: 'demo-physics' },
    { lessonNumber: 2, startTime: '09:00', endTime: '09:45', subjectId: 'demo-math' },
    { lessonNumber: 3, startTime: '10:00', endTime: '10:45', subjectId: 'demo-lit' },
  ],
  wednesday: [
    { lessonNumber: 1, startTime: '08:00', endTime: '08:45', subjectId: 'demo-russian' },
    { lessonNumber: 2, startTime: '09:00', endTime: '09:45', subjectId: 'demo-english' },
    { lessonNumber: 3, startTime: '10:00', endTime: '10:45', subjectId: 'demo-math' },
    { lessonNumber: 4, startTime: '11:00', endTime: '11:45', subjectId: 'demo-physics' },
    { lessonNumber: 5, startTime: '12:00', endTime: '12:45', subjectId: 'demo-history' },
  ],
  thursday:  [
    { lessonNumber: 1, startTime: '08:00', endTime: '08:45', subjectId: 'demo-math' },
    { lessonNumber: 2, startTime: '09:00', endTime: '09:45', subjectId: 'demo-lit' },
    { lessonNumber: 3, startTime: '10:00', endTime: '10:45', subjectId: 'demo-russian' },
  ],
  friday:    [
    { lessonNumber: 1, startTime: '08:00', endTime: '08:45', subjectId: 'demo-english' },
    { lessonNumber: 2, startTime: '09:00', endTime: '09:45', subjectId: 'demo-physics' },
    { lessonNumber: 3, startTime: '10:00', endTime: '10:45', subjectId: 'demo-math' },
    { lessonNumber: 4, startTime: '11:00', endTime: '11:45', subjectId: 'demo-history' },
  ],
}

/** POST /api/diary/seed — creates a demo template + current week snapshot */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.email

  // Only seed if no active template
  const existing = await getActiveTemplate(userId)
  if (existing) {
    return NextResponse.json({ message: 'Template already exists', templateId: existing.id })
  }

  const slots = Object.entries(DEMO_SCHEDULE).flatMap(([day, lessons]) =>
    lessons.map(l => ({ dayOfWeek: day as any, ...l }))
  )

  const template = await createTemplate(userId, 'Демо-расписание', slots)

  const subjectMap = Object.fromEntries(DEMO_SUBJECTS.map(s => [s.id, s]))
  const weekStart = getMondayOf(new Date())
  const week = await getOrCreateWeek(userId, weekStart, id => subjectMap[id] ?? { name: 'Предмет', emoji: '📚', color: '#6366f1' })

  return NextResponse.json({ template, week })
}
