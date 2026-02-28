import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  getTemplatesForUser,
  getActiveTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from '@/lib/diary-store'
import type { CustomBlockPreset } from '@/types/diary'

/** GET /api/diary/template — list user's templates */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [templates, active] = await Promise.all([
    getTemplatesForUser(session.user.email),
    getActiveTemplate(session.user.email),
  ])
  return NextResponse.json({ templates, active })
}

/** POST /api/diary/template — create a new template (becomes active) */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { name, slots, customPresets } = body as { name: string; slots: any[]; customPresets?: string[] }
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const template = await createTemplate(session.user.email, name, slots ?? [], customPresets ?? [])
  return NextResponse.json(template, { status: 201 })
}

/** PUT /api/diary/template/:id — update an existing template's slots/name */
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { id, name, slots, isActive, customPresets } = body as { id: string; name?: string; slots?: any[]; isActive?: boolean; customPresets?: CustomBlockPreset[] }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const updated = await updateTemplate(id, session.user.email, {
    ...(name !== undefined ? { name } : {}),
    ...(slots !== undefined ? { slots } : {}),
    ...(isActive !== undefined ? { isActive } : {}),
    ...(customPresets !== undefined ? { customPresets } : {}),
  })
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(updated)
}

/** DELETE /api/diary/template?id=xxx */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const ok = await deleteTemplate(id, session.user.email)
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
