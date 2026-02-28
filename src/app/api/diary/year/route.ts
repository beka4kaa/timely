import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getWeeksForUser } from '@/lib/diary-store'

/**
 * GET /api/diary/year?year=2026
 *
 * Returns all DiaryWeek records for the user that overlap the given calendar year.
 * Does NOT create new weeks — only reads existing data.
 * Used by the grades/stats page to avoid 52 individual requests.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const year = parseInt(searchParams.get('year') ?? String(new Date().getFullYear()), 10)

  const allWeeks = await getWeeksForUser(session.user.email)

  // Keep weeks that overlap the requested year
  const weeks = allWeeks.filter(w => {
    const startYear = new Date(w.weekStart).getFullYear()
    const endYear = new Date(w.weekEnd).getFullYear()
    return startYear === year || endYear === year
  })

  return NextResponse.json(weeks)
}
