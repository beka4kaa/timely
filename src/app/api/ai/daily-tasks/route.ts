import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { GoogleGenerativeAI } from '@google/generative-ai'

export const dynamic = 'force-dynamic'

const CACHE_KEY = 'daily_tasks'
const CACHE_HOURS = 6 // Cache for 6 hours

// GET /api/ai/daily-tasks - Get cached AI recommendations
export async function GET() {
    try {
        // Check cache first
        const cached = await prisma.aICache.findUnique({
            where: { key: CACHE_KEY }
        })

        if (cached && new Date(cached.expiresAt) > new Date()) {
            // Return cached response
            return NextResponse.json({
                ...JSON.parse(cached.response),
                fromCache: true,
                cachedAt: cached.updatedAt,
            })
        }

        // No valid cache - return empty tasks
        return NextResponse.json({
            tasks: [],
            summary: 'Нажмите "Обновить" для генерации рекомендаций',
            fromCache: false,
        })
    } catch (error) {
        console.error('Error fetching cached tasks:', error)
        return NextResponse.json({ tasks: [], error: 'Failed to fetch' }, { status: 500 })
    }
}

// POST /api/ai/daily-tasks - Generate NEW AI recommendations (uses API)
export async function POST(request: NextRequest) {
    try {
        const apiKey = process.env.GEMINI_API_KEY
        if (!apiKey) {
            return NextResponse.json({ error: 'Gemini API not configured' }, { status: 500 })
        }

        // Check if forced refresh
        const body = await request.json().catch(() => ({}))
        const forceRefresh = body.forceRefresh === true

        // Check cache if not forcing refresh
        if (!forceRefresh) {
            const cached = await prisma.aICache.findUnique({
                where: { key: CACHE_KEY }
            })

            if (cached && new Date(cached.expiresAt) > new Date()) {
                return NextResponse.json({
                    ...JSON.parse(cached.response),
                    fromCache: true,
                })
            }
        }

        // Get all context
        const subjects = await prisma.subject.findMany({
            include: {
                topics: {
                    where: { archived: false },
                },
            },
        })

        const today = new Date()
        today.setHours(0, 0, 0, 0)

        // Get topics for review
        const topicsForReview = subjects.flatMap((s: { id: string; name: string; emoji: string; topics: { id: string; name: string; status: string; picked: boolean; nextReviewAt: Date | null; lastRevisedAt: Date | null }[] }) =>
            s.topics.filter((t: { nextReviewAt: Date | null }) =>
                t.nextReviewAt && new Date(t.nextReviewAt) <= today
            ).map((t: { id: string; name: string; status: string; picked: boolean; lastRevisedAt: Date | null }) => ({
                id: t.id,
                name: t.name,
                subjectId: s.id,
                subjectName: s.name,
                subjectEmoji: s.emoji,
                status: t.status,
                picked: t.picked,
                daysSinceLast: t.lastRevisedAt
                    ? Math.floor((today.getTime() - new Date(t.lastRevisedAt).getTime()) / (1000 * 60 * 60 * 24))
                    : null,
            }))
        )

        // Get user profile
        const userProfile = await prisma.userContext.findUnique({ where: { key: 'profile' } })
        const profile = userProfile ? JSON.parse(userProfile.value) : null

        // Build context
        const context = {
            subjects: subjects.map((s: { name: string; emoji: string; targetHoursWeek: number; topics: unknown[] }) => ({
                name: s.name,
                emoji: s.emoji,
                targetHoursWeek: s.targetHoursWeek,
                topicsCount: s.topics.length,
            })),
            topicsForReview,
            profile,
            dayOfWeek: today.toLocaleDateString('ru-RU', { weekday: 'long' }),
        }

        // Call Gemini
        const genAI = new GoogleGenerativeAI(apiKey)
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

        const prompt = `Ты - AI ассистент для планирования учёбы. Составь список задач на сегодня.

КОНТЕКСТ:
- День недели: ${context.dayOfWeek}
- Предметы: ${JSON.stringify(context.subjects)}
- Темы для повторения (приоритет!): ${JSON.stringify(context.topicsForReview)}
- Профиль: ${JSON.stringify(context.profile)}

ПРАВИЛА:
1. Максимум 3-4 задачи на день
2. Приоритет темам для повторения (overdue)
3. Учитывай баланс предметов
4. Общее время 3-5 часов

Верни ТОЛЬКО JSON:
{
  "tasks": [
    {
      "subjectEmoji": "📐",
      "subjectName": "A Level Further Math",
      "topicName": "Connected particles",
      "hours": 1.5,
      "priority": "high" | "medium" | "low",
      "reason": "Давно не повторяли"
    }
  ],
  "summary": "Краткое объяснение плана на день"
}`

        const result = await model.generateContent(prompt)
        const responseText = result.response.text()

        let data
        try {
            const cleaned = responseText
                .replace(/```json\n?/g, '')
                .replace(/```\n?/g, '')
                .trim()
            data = JSON.parse(cleaned)
        } catch {
            data = { tasks: [], summary: 'Не удалось сгенерировать' }
        }

        // Save to cache
        const expiresAt = new Date(Date.now() + CACHE_HOURS * 60 * 60 * 1000)
        await prisma.aICache.upsert({
            where: { key: CACHE_KEY },
            create: {
                key: CACHE_KEY,
                response: JSON.stringify(data),
                expiresAt,
            },
            update: {
                response: JSON.stringify(data),
                expiresAt,
            },
        })

        return NextResponse.json({
            ...data,
            fromCache: false,
            generatedAt: new Date(),
        })

    } catch (error) {
        console.error('Error generating daily tasks:', error)
        return NextResponse.json({
            tasks: [],
            error: 'Failed to generate'
        }, { status: 500 })
    }
}
