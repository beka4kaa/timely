import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { GoogleGenerativeAI } from '@google/generative-ai'

export const dynamic = 'force-dynamic'

const CACHE_KEY = 'analysis'
const CACHE_HOURS = 12 // Cache for 12 hours

// Define types for the data
interface TopicWithLogs {
    id: string
    name: string
    status: string
    nextReviewAt: Date | null
    reviewLogs: { rating: string }[]
}

interface SubjectWithTopics {
    id: string
    name: string
    emoji: string
    targetHoursWeek: number
    topics: TopicWithLogs[]
}

interface SessionWithTopic {
    totalMinutes: number | null
    topic: { name: string } | null
}

// GET /api/ai/analyze - Get cached analysis
export async function GET() {
    try {
        const cached = await prisma.aICache.findUnique({
            where: { key: CACHE_KEY }
        })

        if (cached && new Date(cached.expiresAt) > new Date()) {
            return NextResponse.json({
                ...JSON.parse(cached.response),
                fromCache: true,
                cachedAt: cached.updatedAt,
            })
        }

        return NextResponse.json({
            stats: null,
            analysis: null,
            fromCache: false,
            message: 'Нажмите "Сгенерировать" для анализа',
        })
    } catch (error) {
        console.error('Error fetching cached analysis:', error)
        return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
    }
}

// POST /api/ai/analyze - Generate new analysis (uses API quota)
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

        // Get all data
        const subjects = await prisma.subject.findMany({
            include: {
                topics: {
                    where: { archived: false },
                    include: {
                        reviewLogs: {
                            orderBy: { reviewedAt: 'desc' },
                            take: 5,
                        },
                    },
                },
            },
        })

        const sessions = await prisma.mindSession.findMany({
            where: {
                startedAt: {
                    gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                },
            },
            include: {
                topic: true,
            },
        })

        // Calculate stats
        const stats = {
            totalTopics: (subjects as SubjectWithTopics[]).reduce((acc: number, s: SubjectWithTopics) => acc + s.topics.length, 0),
            masteredTopics: (subjects as SubjectWithTopics[]).reduce((acc: number, s: SubjectWithTopics) =>
                acc + s.topics.filter((t: TopicWithLogs) => t.status === 'MASTERED').length, 0),
            overdueTopics: (subjects as SubjectWithTopics[]).reduce((acc: number, s: SubjectWithTopics) =>
                acc + s.topics.filter((t: TopicWithLogs) =>
                    t.nextReviewAt && new Date(t.nextReviewAt) < new Date()
                ).length, 0),
            totalStudyMinutes: (sessions as SessionWithTopic[]).reduce((acc: number, s: SessionWithTopic) => acc + (s.totalMinutes || 0), 0),
            avgSessionMinutes: sessions.length > 0
                ? Math.round((sessions as SessionWithTopic[]).reduce((acc: number, s: SessionWithTopic) => acc + (s.totalMinutes || 0), 0) / sessions.length)
                : 0,
        }

        // Find weak topics
        const weakTopics = (subjects as SubjectWithTopics[]).flatMap((s: SubjectWithTopics) =>
            s.topics.filter((t: TopicWithLogs) => {
                const againCount = t.reviewLogs.filter((r: { rating: string }) => r.rating === 'AGAIN').length
                const hardCount = t.reviewLogs.filter((r: { rating: string }) => r.rating === 'HARD').length
                return againCount + hardCount >= 2
            }).map((t: TopicWithLogs) => ({
                name: t.name,
                subject: s.name,
                status: t.status,
            }))
        )

        // Call Gemini for analysis
        const genAI = new GoogleGenerativeAI(apiKey)
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

        const prompt = `Ты - AI ассистент для анализа прогресса обучения. Проанализируй данные и дай рекомендации.

СТАТИСТИКА:
- Всего тем: ${stats.totalTopics}
- Освоено (MASTERED): ${stats.masteredTopics}
- Просрочено для повторения: ${stats.overdueTopics}
- Время учёбы за неделю: ${stats.totalStudyMinutes} минут
- Средняя сессия: ${stats.avgSessionMinutes} минут

ПРЕДМЕТЫ:
${(subjects as SubjectWithTopics[]).map((s: SubjectWithTopics) => `- ${s.emoji} ${s.name}: ${s.topics.length} тем, цель ${s.targetHoursWeek} ч/нед`).join('\n')}

СЛАБЫЕ ТЕМЫ (часто забываются):
${weakTopics.map((t: { name: string; subject: string }) => `- ${t.name} (${t.subject})`).join('\n') || 'Нет данных'}

Верни JSON:
{
  "summary": "Краткий анализ прогресса (2-3 предложения)",
  "recommendations": [
    {"priority": "high" | "medium" | "low", "text": "Рекомендация"}
  ],
  "focusAreas": ["Области для фокуса"],
  "encouragement": "Мотивирующее сообщение"
}

ВАЖНО: Верни ТОЛЬКО JSON.`

        const result = await model.generateContent(prompt)
        const responseText = result.response.text()

        let analysis
        try {
            let cleanedResponse = responseText
                .replace(/```json\n?/g, '')
                .replace(/```\n?/g, '')
                .trim()
            analysis = JSON.parse(cleanedResponse)
        } catch {
            analysis = {
                summary: 'Не удалось проанализировать данные',
                recommendations: [],
                focusAreas: [],
                encouragement: 'Продолжай учиться!',
            }
        }

        const responseData = {
            stats,
            weakTopics,
            analysis,
        }

        // Save to cache
        const expiresAt = new Date(Date.now() + CACHE_HOURS * 60 * 60 * 1000)
        await prisma.aICache.upsert({
            where: { key: CACHE_KEY },
            create: {
                key: CACHE_KEY,
                response: JSON.stringify(responseData),
                expiresAt,
            },
            update: {
                response: JSON.stringify(responseData),
                expiresAt,
            },
        })

        return NextResponse.json({
            ...responseData,
            fromCache: false,
            generatedAt: new Date(),
        })

    } catch (error) {
        console.error('Error analyzing progress:', error)
        return NextResponse.json({
            error: 'Failed to analyze progress'
        }, { status: 500 })
    }
}
