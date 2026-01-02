import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { GoogleGenerativeAI } from '@google/generative-ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // This is a long operation

interface TopicPlanInput {
    topicId: string
    topicName: string
    subjectId: string
    subjectName: string
    plannedWeek: number
    estimatedHours: number
    priority: number
    reinforceWeek1?: number
    reinforceWeek2?: number
}

interface WeekPlanInput {
    weekNumber: number
    subjectHours: Record<string, number>
    focus: string
    notes: string
}

interface ScheduledTestInput {
    subjectId: string
    subjectName: string
    scheduledWeek: number
    title: string
    description: string
    topicsCovered: string[]
    type: string
}

interface AIGeneratedProgram {
    description: string
    strategy: string
    topicPlans: TopicPlanInput[]
    weekPlans: WeekPlanInput[]
    scheduledTests: ScheduledTestInput[]
}

// POST /api/ai/generate-program - Generate a comprehensive learning program
export async function POST(request: NextRequest) {
    try {
        const apiKey = process.env.GEMINI_API_KEY
        if (!apiKey) {
            return NextResponse.json({ error: 'Gemini API not configured' }, { status: 500 })
        }

        const body = await request.json()
        const {
            totalWeeks = 12,
            hoursPerWeek = 20,
            startDate = new Date().toISOString(),
            endDate,
            name = 'Моя программа обучения',
            subjectDeadlines = [] // Array of { subjectId, milestoneTopicId, deadline }
        } = body

        // Calculate actual weeks based on deadlines
        let actualWeeks = totalWeeks
        if (subjectDeadlines.length > 0) {
            const latestDeadline = subjectDeadlines.reduce((latest: string | null, sd: { deadline: string }) => {
                if (!latest || new Date(sd.deadline) > new Date(latest)) return sd.deadline
                return latest
            }, null)
            if (latestDeadline) {
                const diffMs = new Date(latestDeadline).getTime() - new Date().getTime()
                actualWeeks = Math.max(1, Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000)))
            }
        }

        // Load all context
        const subjects = await prisma.subject.findMany({
            include: {
                topics: {
                    where: { archived: false },
                    include: {
                        reviewLogs: { orderBy: { reviewedAt: 'desc' }, take: 5 },
                    },
                },
            },
        })

        const userContext = await prisma.userContext.findMany()
        const userProfile = userContext.find(c => c.key === 'profile')
        const memories = await prisma.aIMemory.findMany({
            orderBy: { importance: 'desc' },
            take: 10,
        })

        // Calculate study sessions history
        const sessions = await prisma.mindSession.findMany({
            where: { endedAt: { not: null } },
            orderBy: { startedAt: 'desc' },
            take: 50,
        })

        const avgSessionLength = sessions.length > 0
            ? sessions.reduce((acc, s) => acc + (s.totalMinutes || 0), 0) / sessions.length
            : 45

        // Prepare comprehensive context for AI
        const aiContext = {
            subjects: subjects.map(s => ({
                id: s.id,
                name: s.name,
                emoji: s.emoji,
                targetHoursWeek: s.targetHoursWeek,
                topics: s.topics.map(t => ({
                    id: t.id,
                    name: t.name,
                    status: t.status,
                    studyState: t.studyState,
                    picked: t.picked,
                    intervalDays: t.intervalDays,
                    reviewCount: t.reviewLogs.length,
                    lastReviewRating: t.reviewLogs[0]?.rating || null,
                })),
            })),
            userProfile: userProfile ? JSON.parse(userProfile.value) : null,
            memories: memories.map(m => `[${m.type}] ${m.content}`),
            settings: {
                totalWeeks,
                hoursPerWeek,
                startDate,
                endDate,
                avgSessionLength: Math.round(avgSessionLength),
            },
        }

        // Call Gemini API
        const genAI = new GoogleGenerativeAI(apiKey)
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.0-flash',
            generationConfig: {
                maxOutputTokens: 8192, // Enough for large JSON
                temperature: 0.7,
            }
        })

        // Build deadline info for prompt
        const deadlineInfo = subjectDeadlines.length > 0
            ? `
❗❗❗ ЖЕСТКИЕ ДЕДЛАЙНЫ (НЕ НАРУШАТЬ!):
${subjectDeadlines.map((sd: { subjectId: string; deadline: string }) => {
                const subject = subjects.find(s => s.id === sd.subjectId)
                return `- ${subject?.name || 'Predmet'}: ВСЕ темы ДО ${new Date(sd.deadline).toLocaleDateString('ru-RU')}`
            }).join('\n')}

СЕГОДНЯ: ${new Date().toLocaleDateString('ru-RU')}
ДНЕЙ ДО ДЕДЛАЙНА: ${actualWeeks * 7}
`
            : ''



        const prompt = `Ты - СТРОГИЙ AI - планировщик.Твоя задача - СОЗДАТЬ РЕАЛЬНЫЙ ПЛАН для ДОСТИЖЕНИЯ ЦЕЛИ.

            ${deadlineInfo}

        КОНТЕКСТ:
${JSON.stringify(aiContext, null, 0)}

        ЗАДАЧА: Создать программу на ${actualWeeks} недель с ${hoursPerWeek} часами / неделю.

❗ КРИТИЧЕСКИЕ ПРАВИЛА:
        1. ДЕДЛАЙНЫ НЕ ОБСУЖДАЮТСЯ - ВСЕ темы ДОЛЖНЫ быть запланированы ДО дедлайна
        2. Если времени мало - УВЕЛИЧЬ часы в день, а НЕ растягивай программу
        3. MASTERED и SUCCESS темы = 0.5 - 1 час(повторение)
        4. NOT_STARTED = 2 - 4 часа(полное изучение)
        5. НЕ ЖАЛЕЙ пользователя - если надо 8 часов в день, ставь 8 часов

ФОРМАТ ОТВЕТА(ТОЛЬКО валидный JSON, без markdown):
        {
            "description": "Короткое описание",
                "strategy": "Короткая стратегия",
                    "topicPlans": [{ "topicId": "", "topicName": "", "subjectId": "", "subjectName": "", "plannedWeek": 1, "estimatedHours": 2, "priority": 1 }],
                        "weekPlans": [{ "weekNumber": 1, "subjectHours": {}, "focus": "", "notes": "" }],
                            "scheduledTests": []
        }

БЕЗ ПОВТОРЕНИЙ(reinforceWeek).ТОЛЬКО основное изучение.БУДЬ КРАТКИМ.`

        const result = await model.generateContent(prompt)
        const responseText = result.response.text()

        // Parse AI response
        let aiProgram: AIGeneratedProgram
        try {
            const cleanedResponse = responseText
                .replace(/```json\n ?/g, '')
                .replace(/```\n?/g, '')
                .trim()
            aiProgram = JSON.parse(cleanedResponse)
        } catch (parseError) {
            console.error('Failed to parse AI response:', responseText)
            return NextResponse.json({
                error: 'Failed to parse AI response',
                rawResponse: responseText.substring(0, 1000)
            }, { status: 500 })
        }

        // Create program in database
        const startDateObj = new Date(startDate)
        const endDateObj = endDate ? new Date(endDate) : null

        const program = await prisma.learningProgram.create({
            data: {
                name,
                startDate: startDateObj,
                endDate: endDateObj,
                totalWeeks,
                hoursPerWeek,
                description: aiProgram.description,
                strategy: aiProgram.strategy,
            },
        })

        // Create week plans
        for (const wp of aiProgram.weekPlans) {
            const weekStart = new Date(startDateObj)
            weekStart.setDate(weekStart.getDate() + (wp.weekNumber - 1) * 7)
            const weekEnd = new Date(weekStart)
            weekEnd.setDate(weekEnd.getDate() + 6)

            await prisma.weekPlan.create({
                data: {
                    programId: program.id,
                    weekNumber: wp.weekNumber,
                    startDate: weekStart,
                    endDate: weekEnd,
                    subjectHours: JSON.stringify(wp.subjectHours),
                    focus: wp.focus,
                    notes: wp.notes,
                },
            })
        }

        // Create topic plans
        for (const tp of aiProgram.topicPlans) {
            // Verify topic exists
            const topic = await prisma.topic.findUnique({ where: { id: tp.topicId } })
            if (topic) {
                await prisma.topicPlan.create({
                    data: {
                        programId: program.id,
                        topicId: tp.topicId,
                        plannedWeek: tp.plannedWeek,
                        estimatedHours: tp.estimatedHours,
                        priority: tp.priority,
                        reinforceWeek1: tp.reinforceWeek1,
                        reinforceWeek2: tp.reinforceWeek2,
                    },
                })
            }
        }

        // Create scheduled tests
        for (const st of aiProgram.scheduledTests) {
            // Verify subject exists
            const subject = await prisma.subject.findUnique({ where: { id: st.subjectId } })
            if (!subject) continue // Skip if subject doesn't exist

            const testDate = new Date(startDateObj)
            testDate.setDate(testDate.getDate() + (st.scheduledWeek - 1) * 7 + 5) // Friday of that week

            await prisma.scheduledTest.create({
                data: {
                    programId: program.id,
                    subjectId: st.subjectId,
                    scheduledDate: testDate,
                    scheduledTime: '15:00',
                    title: st.title || 'Тест',
                    description: st.description || '',
                    topicsCovered: JSON.stringify(st.topicsCovered || []),
                    type: st.type || 'TOPIC_TEST',
                },
            })
        }

        // Fetch complete program
        const completeProgram = await prisma.learningProgram.findUnique({
            where: { id: program.id },
            include: {
                weekPlans: { orderBy: { weekNumber: 'asc' } },
                topicPlans: { include: { topic: true } },
                scheduledTests: { include: { subject: true }, orderBy: { scheduledDate: 'asc' } },
            },
        })

        return NextResponse.json(completeProgram, { status: 201 })

    } catch (error) {
        console.error('Error generating program:', error)
        return NextResponse.json({
            error: 'Failed to generate program',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 })
    }
}
