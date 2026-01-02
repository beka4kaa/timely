import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { z } from 'zod'

const reorderSchema = z.object({
    blockIds: z.array(z.string()),
})

// PUT /api/blocks/reorder - Reorder blocks
export async function PUT(request: NextRequest) {
    try {
        const body = await request.json()
        const validation = reorderSchema.safeParse(body)

        if (!validation.success) {
            return NextResponse.json(
                { error: 'Validation failed', details: validation.error.errors },
                { status: 400 }
            )
        }

        const { blockIds } = validation.data

        // Update each block's orderIndex
        await prisma.$transaction(
            blockIds.map((id, index) =>
                prisma.block.update({
                    where: { id },
                    data: { orderIndex: index },
                })
            )
        )

        return NextResponse.json({ success: true })
    } catch (error) {
        console.error('Error reordering blocks:', error)
        return NextResponse.json({ error: 'Failed to reorder blocks' }, { status: 500 })
    }
}
