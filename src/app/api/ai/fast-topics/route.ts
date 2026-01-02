import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import prisma from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// POST /api/ai/fast-topics
export async function POST(request: NextRequest) {
    try {
        const apiKey = process.env.GEMINI_API_KEY
        if (!apiKey) {
            return NextResponse.json({ error: 'Gemini API not configured' }, { status: 500 })
        }

        const body = await request.json()
        const { subjectId, text } = body

        if (!subjectId || !text) {
            return NextResponse.json({ error: 'Missing defined subjectId or text' }, { status: 400 })
        }

        // Get subject details
        const subject = await prisma.subject.findUnique({
            where: { id: subjectId }
        })

        if (!subject) {
            return NextResponse.json({ error: 'Subject not found' }, { status: 404 })
        }

        const genAI = new GoogleGenerativeAI(apiKey)
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' })

        const prompt = `
        User wants to add topics to the subject: "${subject.name}".
        
        Raw input text:
        "${text}"

        Task:
        1. Analyze the input text and identify the hierarchical structure.
        2. Main topics are usually numbered (1), (2), etc. or have clear separators like "—" or bold headers.
        3. Subtopics are usually numbered like 1.1, 1.2, 2.1, 2.2, etc.
        4. If no clear hierarchy exists, treat each line as a separate topic with no subtopics.
        5. For each main topic, extract all its subtopics.
        6. Clean up the topic names (remove numbering like "1)", "2)" from the start if present).
        7. Keep subtopic names as-is (they can retain numbering like 1.1, 1.2).

        Return valid JSON array:
        [
            {
                "name": "Main Topic Name",
                "subtopics": [
                    "Subtopic 1 name",
                    "Subtopic 2 name"
                ]
            }
        ]

        Rules:
        - If a topic has no subtopics, use an empty array [].
        - Ignore lines like "End-of-chapter review" or "Cross-topic review" - do NOT create topics for these.
        - Clean formatting but preserve meaningful content.
        `

        const result = await model.generateContent(prompt)
        const responseText = result.response.text()

        // Clean and parse JSON
        let cleanedResponse = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

        // Try to extract JSON if it's embedded in other text
        const jsonMatch = cleanedResponse.match(/\[[\s\S]*\]/)
        if (jsonMatch) {
            cleanedResponse = jsonMatch[0]
        }

        let topicsData
        try {
            topicsData = JSON.parse(cleanedResponse)
            console.log('AI parsed topics:', JSON.stringify(topicsData, null, 2))
        } catch (e) {
            console.error('Failed to parse AI response:', responseText)
            console.error('Cleaned response:', cleanedResponse)

            // Fallback: manual parsing from text
            // Match patterns like: "1)" or "1." or "(1)" for main topics
            // Match patterns like: "1.1" or "1.2" for subtopics
            const lines = text.split('\n').filter((l: string) => l.trim())
            const manualTopics: Array<{ name: string, subtopics: string[] }> = []
            let currentTopic: { name: string, subtopics: string[] } | null = null

            console.log('Manual parsing, lines:', lines.length)

            for (const line of lines) {
                const trimmed = line.trim()

                // Skip empty lines and review sections
                if (!trimmed ||
                    trimmed.toLowerCase().includes('end-of-chapter') ||
                    trimmed.toLowerCase().includes('cross-topic') ||
                    trimmed.toLowerCase().includes('review exercise')) {
                    continue
                }

                // Check if it's a main topic: "1)", "1.", "(1)", "Chapter 1", etc.
                const mainTopicMatch = trimmed.match(/^(?:\(?\d+\)?[\.\)]\s*|Chapter\s*\d+[\.:]\s*)(.+)$/)

                // Check if it's a subtopic: "1.1", "1.2", "2.1", etc.
                const subtopicMatch = trimmed.match(/^(\d+\.\d+)\s+(.+)$/)

                if (mainTopicMatch && !subtopicMatch) {
                    // Save previous topic if exists
                    if (currentTopic) {
                        manualTopics.push(currentTopic)
                    }
                    // Start new topic - take everything after the number
                    let topicName = mainTopicMatch[1].trim()
                    // Remove "—" and translation if present (keep just the English name)
                    if (topicName.includes('—')) {
                        topicName = topicName.split('—')[0].trim()
                    }
                    console.log('Found topic:', topicName)
                    currentTopic = { name: topicName, subtopics: [] }
                } else if (subtopicMatch && currentTopic) {
                    // Add subtopic to current topic
                    const subtopicName = subtopicMatch[2].trim()
                    console.log('Found subtopic:', subtopicName, 'for topic:', currentTopic.name)
                    currentTopic.subtopics.push(subtopicName)
                }
            }

            // Add last topic
            if (currentTopic) {
                manualTopics.push(currentTopic)
            }

            console.log('Manual parse result:', JSON.stringify(manualTopics, null, 2))

            if (manualTopics.length === 0) {
                return NextResponse.json({
                    error: 'Failed to parse topics. Please check the format.',
                    aiResponse: responseText
                }, { status: 500 })
            }

            topicsData = manualTopics
        }

        console.log('Final topicsData to create:', JSON.stringify(topicsData.slice(0, 2), null, 2))

        if (!Array.isArray(topicsData)) {
            return NextResponse.json({ error: 'Invalid AI response format' }, { status: 500 })
        }

        // Create topics with subtopics in DB
        const createdTopics = []
        let totalSubtopics = 0

        for (const t of topicsData) {
            // Create the main topic
            const topic = await prisma.topic.create({
                data: {
                    subjectId,
                    name: t.name,
                    status: 'NOT_STARTED',
                }
            })

            // Create subtopics if any
            if (t.subtopics && Array.isArray(t.subtopics) && t.subtopics.length > 0) {
                for (let i = 0; i < t.subtopics.length; i++) {
                    await prisma.subtopic.create({
                        data: {
                            topicId: topic.id,
                            title: t.subtopics[i],
                            orderIndex: i,
                            srsState: {
                                create: {
                                    entityType: 'SUBTOPIC',
                                    mastery: 0,
                                }
                            }
                        }
                    })
                    totalSubtopics++
                }
            }

            createdTopics.push(topic)
        }

        return NextResponse.json({
            success: true,
            topics: createdTopics,
            stats: {
                topicsCreated: createdTopics.length,
                subtopicsCreated: totalSubtopics
            }
        })

    } catch (error: any) {
        console.error('Fast topic add error:', error)
        return NextResponse.json({
            error: 'Internal server error',
            details: error?.message || 'Unknown error'
        }, { status: 500 })
    }
}
