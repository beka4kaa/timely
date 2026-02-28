import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getOrCreateWeek, forceRecreateWeek, getMondayOf } from '@/lib/diary-store'
import { BACKEND_URL } from '@/lib/api-utils'

/** GET /api/diary/week?weekStart=2026-02-23 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.email

  const { searchParams } = new URL(req.url)
  const weekStartParam = searchParams.get('weekStart')
  const weekStart = weekStartParam || getMondayOf(new Date())

  // Try to fetch subjects from backend to denormalize names/colors
  let subjectsMap: Record<string, { name: string; emoji: string; color: string }> = {}
  try {
    const token = (session as any).accessToken
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${BACKEND_URL}/api/mind/subjects/`, { headers, cache: 'no-store' })
    if (res.ok) {
      const data = await res.json()
      const list = Array.isArray(data) ? data : (data.results ?? [])
      for (const s of list) {
        subjectsMap[s.id] = { name: s.name, emoji: s.emoji || '📚', color: s.color || '#6366f1' }
      }
    }
  } catch {
    // Backend unavailable — subjects will show as "Предмет"
  }

  function resolveSubject(id: string) {
    return subjectsMap[id] ?? { name: 'Предмет', emoji: '📚', color: '#6366f1' }
  }

  const week = await getOrCreateWeek(userId, weekStart, resolveSubject)
  return NextResponse.json(week)
}

/** POST /api/diary/week — force-apply active template to a week (resets grades/notes) */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.email
  const body = await req.json()
  const weekStart: string = body.weekStart || getMondayOf(new Date())

  let subjectsMap: Record<string, { name: string; emoji: string; color: string }> = {}
  try {
    const token = (session as any).accessToken
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`${BACKEND_URL}/api/mind/subjects/`, { headers, cache: 'no-store' })
    if (res.ok) {
      const data = await res.json()
      const list = Array.isArray(data) ? data : (data.results ?? [])
      for (const s of list) {
        subjectsMap[s.id] = { name: s.name, emoji: s.emoji || '📚', color: s.color || '#6366f1' }
      }
    }
  } catch { /* ignore */ }

  function resolveSubject(id: string) {
    return subjectsMap[id] ?? { name: 'Предмет', emoji: '📚', color: '#6366f1' }
  }

  const week = await forceRecreateWeek(userId, weekStart, resolveSubject)
  return NextResponse.json(week)
}
