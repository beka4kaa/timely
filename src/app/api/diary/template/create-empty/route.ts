/**
 * POST /api/diary/template/create-empty
 * Body: { name?: string }
 *
 * Creates a brand-new empty template (no lesson slots) via the backend action
 * POST /api/diary/templates/create_empty/
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { createEmptyTemplate } from '@/lib/diary-store'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const name = (body as any).name ?? 'Новый шаблон'

  try {
    const template = await createEmptyTemplate(session.user.email, name)
    return NextResponse.json(template, { status: 201 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? 'Create failed' }, { status: 500 })
  }
}
