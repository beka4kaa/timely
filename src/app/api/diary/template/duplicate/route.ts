/**
 * POST /api/diary/template/duplicate
 * Body: { templateId: string; name?: string }
 *
 * Duplicates an existing template via the Django backend action
 * POST /api/diary/templates/{id}/duplicate/
 *
 * Returns the newly created template object.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { duplicateTemplate } from '@/lib/diary-store'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { templateId, name } = body as { templateId?: string; name?: string }

  if (!templateId)
    return NextResponse.json({ error: 'templateId is required' }, { status: 400 })

  try {
    const copy = await duplicateTemplate(session.user.email, templateId, name)
    return NextResponse.json(copy, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Duplicate failed' }, { status: 500 })
  }
}
