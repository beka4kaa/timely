import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { updateGrade, updateLessonField } from '@/lib/diary-store'
import type { Grade } from '@/types/diary'

/**
 * PATCH /api/diary/grade
 * Body: { weekId, dayId, lessonId, type: 'retelling'|'exercises'|'test', value: 1-5|null }
 *    OR { weekId, dayId, lessonId, field: 'homework'|'notes', value: string }
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.email
  const body = await req.json()
  const { weekId, dayId, lessonId } = body

  if (!weekId || !dayId || !lessonId) {
    return NextResponse.json({ error: 'weekId, dayId, lessonId are required' }, { status: 400 })
  }

  // Grade update
  if ('type' in body) {
    const { type, value } = body
    if (!['retelling', 'exercises', 'test'].includes(type)) {
      return NextResponse.json({ error: 'Invalid grade type' }, { status: 400 })
    }
    const grade: Grade = value === null ? null : (Number(value) as Grade)
    const updated = updateGrade(userId, weekId, dayId, { lessonId, type, value: grade })
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(updated)
  }

  // Text field update (homework / notes)
  if ('field' in body) {
    const { field, value } = body
    if (!['homework', 'notes'].includes(field)) {
      return NextResponse.json({ error: 'Invalid field' }, { status: 400 })
    }
    const updated = updateLessonField(userId, weekId, dayId, { lessonId, field, value })
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(updated)
  }

  return NextResponse.json({ error: 'Provide type or field' }, { status: 400 })
}
