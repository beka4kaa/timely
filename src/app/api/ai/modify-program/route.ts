import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { GoogleGenerativeAI } from '@google/generative-ai'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
    try {
        const apiKey = process.env.GEMINI_API_KEY
        if (!apiKey) {
            return NextResponse.json({ error: 'Gemini API not configured' }, { status: 500 })
        }

        const body = await request.json()
        const { programId, instruction } = body

        if (!programId || !instruction) {
            return NextResponse.json({ error: 'Missing programId or instruction' }, { status: 400 })
        }

        // Fetch current program with full context
        const program = await prisma.learningProgram.findUnique({
            where: { id: programId },
            include: {
                topicPlans: { include: { topic: { include: { subject: true } } } },
                weekPlans: true,
                scheduledTests: { include: { subject: true } }
            }
        })

        if (!program) {
            return NextResponse.json({ error: 'Program not found' }, { status: 404 })
        }

        // Simplify context for AI to avoid token limits
        const simplifiedProgram = {
            id: program.id,
            totalWeeks: program.totalWeeks,
            hoursPerWeek: program.hoursPerWeek,
            weeks: program.weekPlans.map((w: any) => ({
                number: w.weekNumber,
                focus: w.focus,
                subjectHours: JSON.parse(w.subjectHours)
            })),
            topics: program.topicPlans.map((tp: any) => ({
                id: tp.id,
                name: tp.topic.name,
                subject: tp.topic.subject.name,
                plannedWeek: tp.plannedWeek,
                priority: tp.priority,
            }))
        }

        const genAI = new GoogleGenerativeAI(apiKey)
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

        const prompt = `
        Current Learning Program:
        ${JSON.stringify(simplifiedProgram, null, 2)}

        User Instruction: "${instruction}"

        Task:
        Modify the program based on the user's instruction. 
        - If the user wants to reorder topics, change 'plannedWeek'.
        - If the user wants to prioritize something, change 'priority' and/or 'plannedWeek'.
        - If the user wants to change week focus, update 'focus'.

        Return ONLY the modifications in this JSON format:
        {
            "modifiedTopics": [
                { "id": "topic_plan_id", "plannedWeek": 2, "priority": 5 } 
            ],
            "modifiedWeeks": [
                { "number": 1, "focus": "New Focus", "subjectHours": {"subject_id": 10} }
            ],
            "explanation": "Brief explanation of changes"
        }
        Return only JSON.
        `

        const result = await model.generateContent(prompt)
        const responseText = result.response.text()
        const cleanedResponse = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        const modifications = JSON.parse(cleanedResponse)

        // Apply modifications to DB
        const updates = []

        if (modifications.modifiedTopics) {
            for (const mod of modifications.modifiedTopics) {
                updates.push(prisma.topicPlan.update({
                    where: { id: mod.id },
                    data: {
                        plannedWeek: mod.plannedWeek,
                        priority: mod.priority
                    }
                }))
            }
        }

        if (modifications.modifiedWeeks) {
            for (const mod of modifications.modifiedWeeks) {
                // Find correct week plan ID
                const weekPlan = program.weekPlans.find((w: any) => w.weekNumber === mod.number)
                if (weekPlan) {
                    updates.push(prisma.weekPlan.update({
                        where: { id: weekPlan.id },
                        data: {
                            focus: mod.focus,
                            subjectHours: mod.subjectHours ? JSON.stringify(mod.subjectHours) : undefined
                        }
                    }))
                }
            }
        }

        await prisma.$transaction(updates)

        return NextResponse.json({
            success: true,
            message: modifications.explanation
        })

    } catch (error) {
        console.error('Modify program error:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
