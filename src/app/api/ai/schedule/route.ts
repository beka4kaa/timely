import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { GoogleGenerativeAI } from '@google/generative-ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// POST /api/ai/schedule - Generate optimal schedule using AI
export async function POST(request: NextRequest) {
    try {
        const apiKey = process.env.GEMINI_API_KEY
        if (!apiKey) {
            return NextResponse.json({ error: 'Gemini API not configured' }, { status: 500 })
        }

        const body = await request.json()
        const { date, totalHours = 4, userMessage } = body

        // Load user context and memories
        const contextItems = await prisma.userContext.findMany()
        const userContext: Record<string, string> = {}
        for (const item of contextItems) {
            userContext[item.key] = item.value
        }

        const memories = await prisma.aIMemory.findMany({
            orderBy: { importance: 'desc' },
            take: 10,
        })

        // Get all subjects with topics
        const subjects = await prisma.subject.findMany({
            include: {
                topics: {
                    where: { archived: false },
                    orderBy: { nextReviewAt: 'asc' },
                },
            },
        })

        // Get topics that need review (due or overdue)
        const today = new Date()
        today.setHours(0, 0, 0, 0)

        type TopicWithSubject = typeof subjects[0]['topics'][0] & {
            subjectName: string
            subjectEmoji: string
            subjectColor: string
        }

        const topicsForReview: TopicWithSubject[] = subjects.flatMap(s =>
            s.topics.filter(t =>
                t.nextReviewAt && new Date(t.nextReviewAt) <= today
            ).map(t => ({
                ...t,
                subjectName: s.name,
                subjectEmoji: s.emoji,
                subjectColor: s.color,
            }))
        )

        // Prepare context for AI
        const context = {
            subjects: subjects.map(s => ({
                name: s.name,
                emoji: s.emoji,
                targetHoursWeek: s.targetHoursWeek,
                topicsCount: s.topics.length,
            })),
            topicsForReview: topicsForReview.map(t => ({
                name: t.name,
                subject: t.subjectName,
                status: t.status,
                intervalDays: t.intervalDays,
                daysSinceReview: t.lastRevisedAt
                    ? Math.floor((today.getTime() - new Date(t.lastRevisedAt).getTime()) / (1000 * 60 * 60 * 24))
                    : null,
            })),
            availableHours: totalHours,
            date: date || today.toISOString().split('T')[0],
            userContext,
            memories: memories.map(m => `[${m.type}] ${m.content}`),
            userMessage,
        }

        // Call Gemini API
        const genAI = new GoogleGenerativeAI(apiKey)
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

        const prompt = `Ты - AI ассистент для планирования учёбы. Создай оптимальное расписание на день.

КОНТЕКСТ:
- Дата: ${context.date}
- Доступное время: ${context.availableHours} часов
- Предметы: ${JSON.stringify(context.subjects, null, 2)}
- Темы для повторения (приоритет): ${JSON.stringify(context.topicsForReview, null, 2)}

ПРАВИЛА:
1. Чередуй разные предметы для лучшего усвоения
2. Начни с тем, которые давно не повторялись
3. Добавь перерывы каждые 45-90 минут
4. Учитывай целевые часы в неделю для каждого предмета
5. Каждый блок должен быть 30-90 минут

Верни ТОЛЬКО валидный JSON массив блоков в формате:
[
  {
    "type": "LESSON" | "BREAK",
    "title": "string",
    "durationMinutes": number,
    "startTime": "HH:MM",
    "color": "#hex",
    "segments": [{"title": "string", "durationMinutes": number}],
    "subtasks": ["string"],
    "reason": "краткое объяснение почему этот блок"
  }
]

ВАЖНО: Верни ТОЛЬКО JSON, без markdown, без объяснений.`

        const result = await model.generateContent(prompt)
        const responseText = result.response.text()

        // Parse JSON from response
        let schedule
        try {
            // Clean up response - remove markdown code blocks if present
            let cleanedResponse = responseText
                .replace(/```json\n?/g, '')
                .replace(/```\n?/g, '')
                .trim()

            schedule = JSON.parse(cleanedResponse)
        } catch (parseError) {
            console.error('Failed to parse AI response:', responseText)
            return NextResponse.json({
                error: 'Failed to parse AI response',
                rawResponse: responseText
            }, { status: 500 })
        }

        return NextResponse.json({
            schedule,
            context: {
                date: context.date,
                totalHours: context.availableHours,
                topicsForReviewCount: topicsForReview.length,
            },
        })

    } catch (error) {
        console.error('Error generating schedule:', error)
        return NextResponse.json({
            error: 'Failed to generate schedule',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 })
    }
}
