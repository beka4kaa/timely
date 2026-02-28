import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { updateDayYoutubeLinks } from '@/lib/diary-store'
import type { YoutubeLink } from '@/types/diary'

/**
 * PATCH /api/diary/day-links
 * Body: { weekId, dayId, links: YoutubeLink[] }
 *
 * Replaces the entire youtubeLinks array for that day.
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { weekId, dayId, links } = body as {
    weekId: string
    dayId: string
    links: Omit<YoutubeLink, 'id' | 'createdAt'>[]
  }

  if (!weekId || !dayId || !Array.isArray(links)) {
    return NextResponse.json({ error: 'weekId, dayId and links[] required' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const fullLinks: YoutubeLink[] = links.map(l => ({
    id: (l as any).id || crypto.randomUUID(),
    url: l.url,
    label: l.label,
    durationMin: l.durationMin,
    createdAt: (l as any).createdAt || now,
  }))

  const updated = updateDayYoutubeLinks(session.user.email, weekId, dayId, fullLinks)
  if (!updated) return NextResponse.json({ error: 'Week or day not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
