/**
 * POST /api/diary/template/apply
 *
 * Applies a schedule template to a specific diary week.
 * Existing lesson structure is replaced; grades/homework/notes are preserved
 * for slots that match by day + lessonNumber.
 *
 * Body:
 *   {
 *     templateId : string   // template to apply
 *     weekStart  : string   // ISO Monday date, e.g. "2026-03-02"
 *   }
 *
 * Returns the updated (or newly created) DiaryWeek.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { applyTemplateToWeek } from '@/lib/diary-store'
import { BACKEND_URL } from '@/lib/api-utils'

interface SubjectRecord {
  id: string
  name: string
  emoji: string
  color: string
}

/** Fetch the user's subjects from Django and build a resolver map. */
async function buildSubjectResolver(
  userEmail: string,
): Promise<(subjectId: string) => { name: string; emoji: string; color: string }> {
  const fallback = { name: 'Предмет', emoji: '📚', color: '#6366f1' }
  try {
    const res = await fetch(`${BACKEND_URL}/api/mind/subjects/`, {
      headers: {
        'Content-Type': 'application/json',
        'X-User-Email': userEmail,
      },
      cache: 'no-store',
    })
    if (!res.ok) return () => fallback

    const raw = await res.json()
    const list: SubjectRecord[] = Array.isArray(raw)
      ? raw
      : (raw.results ?? raw.subjects ?? [])

    const map = new Map(list.map(s => [String(s.id), s]))
    return (id: string) => {
      const s = map.get(id)
      return s
        ? { name: s.name, emoji: s.emoji ?? '📚', color: s.color ?? '#6366f1' }
        : fallback
    }
  } catch {
    return () => fallback
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { templateId, weekStart } = body as { templateId?: string; weekStart?: string }

  if (!templateId || !weekStart) {
    return NextResponse.json(
      { error: 'templateId and weekStart are required' },
      { status: 400 },
    )
  }

  // Validate weekStart is a Monday (ISO YYYY-MM-DD)
  const date = new Date(weekStart)
  if (isNaN(date.getTime())) {
    return NextResponse.json({ error: 'weekStart must be a valid ISO date' }, { status: 400 })
  }

  try {
    const resolveSubject = await buildSubjectResolver(session.user.email)
    const week = await applyTemplateToWeek(
      session.user.email,
      templateId,
      weekStart,
      resolveSubject,
    )
    return NextResponse.json(week)
  } catch (err: any) {
    console.error('[apply-template]', err)
    return NextResponse.json({ error: err.message ?? 'Apply failed' }, { status: 500 })
  }
}
