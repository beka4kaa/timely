import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
    // Get today's date
    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]

    // Create today's plan with sample data
    const dayPlan = await prisma.dayPlan.upsert({
        where: { date: todayStr },
        update: {},
        create: {
            date: todayStr,
            blocks: {
                create: [
                    {
                        type: 'LESSON',
                        title: 'Математика: производные',
                        durationMinutes: 90,
                        startTime: '09:00',
                        orderIndex: 0,
                        color: '#8b5cf6',
                        segments: {
                            create: [
                                { title: 'Теория', durationMinutes: 45, orderIndex: 0 },
                                { title: 'Практика', durationMinutes: 45, orderIndex: 1 },
                            ],
                        },
                        subtasks: {
                            create: [
                                { title: 'Прочитать конспект', orderIndex: 0 },
                                { title: 'Решить 10 задач', orderIndex: 1 },
                                { title: 'Разобрать ошибки', orderIndex: 2 },
                            ],
                        },
                    },
                    {
                        type: 'BREAK',
                        title: 'Перерыв',
                        durationMinutes: 10,
                        startTime: '10:30',
                        orderIndex: 1,
                        color: '#10b981',
                    },
                    {
                        type: 'LESSON',
                        title: 'Английский язык',
                        durationMinutes: 60,
                        startTime: '10:40',
                        orderIndex: 2,
                        color: '#3b82f6',
                        segments: {
                            create: [
                                { title: 'Грамматика', durationMinutes: 30, orderIndex: 0 },
                                { title: 'Практика говорения', durationMinutes: 30, orderIndex: 1 },
                            ],
                        },
                        subtasks: {
                            create: [
                                { title: 'Выучить новые слова', orderIndex: 0 },
                                { title: 'Прослушать аудио', orderIndex: 1 },
                            ],
                        },
                    },
                    {
                        type: 'EVENT',
                        title: 'Обед',
                        durationMinutes: 45,
                        startTime: '12:00',
                        orderIndex: 3,
                        color: '#f59e0b',
                        notes: 'Не забыть пообедать и отдохнуть',
                    },
                ],
            },
        },
    })

    console.log(`✅ Created day plan for ${todayStr} with ${dayPlan.id}`)
    console.log('📚 Sample blocks: Математика (90 мин), Перерыв (10 мин), Английский (60 мин), Обед (45 мин)')

    // ============================================
    // Mind Learning System Seed Data
    // ============================================

    // Create subjects
    const physics = await prisma.subject.upsert({
        where: { id: 'seed-physics' },
        update: {},
        create: {
            id: 'seed-physics',
            name: 'A Level Physics',
            emoji: '⚛️',
            color: '#8b5cf6',
            targetHoursWeek: 6,
        },
    })

    const furtherMath = await prisma.subject.upsert({
        where: { id: 'seed-further-math' },
        update: {},
        create: {
            id: 'seed-further-math',
            name: 'A Level Further Math',
            emoji: '📐',
            color: '#3b82f6',
            targetHoursWeek: 8,
        },
    })

    const math = await prisma.subject.upsert({
        where: { id: 'seed-math' },
        update: {},
        create: {
            id: 'seed-math',
            name: 'A Level Math',
            emoji: '🔢',
            color: '#10b981',
            targetHoursWeek: 5,
        },
    })

    console.log('📖 Created subjects: A Level Physics, A Level Further Math, A Level Math')

    // Create topics for Physics
    const physicsTopics = ['Waves', 'Particle physics', 'Superposition', 'Radioactivity', 'Polarization']
    for (let i = 0; i < physicsTopics.length; i++) {
        await prisma.topic.upsert({
            where: { id: `seed-physics-${i}` },
            update: {},
            create: {
                id: `seed-physics-${i}`,
                subjectId: physics.id,
                name: physicsTopics[i],
                status: i === 0 ? 'MEDIUM' : 'NOT_STARTED',
                picked: i < 2,
            },
        })
    }

    // Create topics for Further Math
    const furtherMathTopics = [
        'Rational funcs & graphs',
        'Forces in two dimensions',
        'Equilibrium of a rigid body',
        'Friction',
        'Connected particles',
    ]
    for (let i = 0; i < furtherMathTopics.length; i++) {
        await prisma.topic.upsert({
            where: { id: `seed-further-math-${i}` },
            update: {},
            create: {
                id: `seed-further-math-${i}`,
                subjectId: furtherMath.id,
                name: furtherMathTopics[i],
                status: i === 0 ? 'SUCCESS' : 'NOT_STARTED',
                picked: i === 0,
            },
        })
    }

    // Create topics for Math
    const mathTopics = ['Integration', 'Differentiation', 'Series']
    for (let i = 0; i < mathTopics.length; i++) {
        await prisma.topic.upsert({
            where: { id: `seed-math-${i}` },
            update: {},
            create: {
                id: `seed-math-${i}`,
                subjectId: math.id,
                name: mathTopics[i],
                status: i === 0 ? 'MASTERED' : i === 1 ? 'SUCCESS' : 'NOT_STARTED',
                intervalDays: i === 0 ? 14 : null,
                nextReviewAt: i === 0 ? new Date() : null, // Due today for testing
                lastRevisedAt: i === 0 ? new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) : null,
            },
        })
    }

    console.log('🧠 Created topics for spaced repetition:')
    console.log('   Physics: Waves, Particle physics, Superposition, Radioactivity, Polarization')
    console.log('   Further Math: Rational funcs, Forces, Equilibrium, Friction, Connected particles')
    console.log('   Math: Integration, Differentiation, Series')
}

main()
    .then(async () => {
        await prisma.$disconnect()
    })
    .catch(async (e) => {
        console.error(e)
        await prisma.$disconnect()
        process.exit(1)
    })

