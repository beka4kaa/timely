
import Database from 'better-sqlite3';
import { PrismaClient } from '@prisma/client';
import path from 'path';

const prisma = new PrismaClient();
const dbPath = path.resolve(process.cwd(), 'prisma/dev.db');

async function migrateData() {
    console.log(`📂 Connecting to SQLite database at ${dbPath}...`);
    let db;
    try {
        db = new Database(dbPath, { readonly: true });
    } catch (e) {
        console.error('❌ Failed to open SQLite database:', e);
        return;
    }

    console.log('🚀 Starting migration to Neon Postgres...');

    try {
        // 1. Migrate Subjects
        console.log('📦 Migrating Subjects...');
        const subjects = db.prepare('SELECT * FROM Subject').all();
        for (const s of subjects as any[]) {
            await prisma.subject.upsert({
                where: { id: s.id },
                update: {},
                create: {
                    id: s.id,
                    name: s.name,
                    emoji: s.emoji,
                    color: s.color,
                    targetHoursWeek: s.targetHoursWeek,
                    textbookUrl: s.textbookUrl,
                    createdAt: new Date(s.createdAt),
                    updatedAt: new Date(s.updatedAt),
                }
            });
        }
        console.log(`✅ Migrated ${subjects.length} subjects.`);

        // 2. Migrate Topics
        console.log('📦 Migrating Topics...');
        const topics = db.prepare('SELECT * FROM Topic').all();
        // Check if orderIndex column exists in SQLite
        const topicColumns = db.prepare('PRAGMA table_info(Topic)').all() as any[];
        const hasOrderIndex = topicColumns.some(c => c.name === 'orderIndex');

        for (const t of topics as any[]) {
            await prisma.topic.upsert({
                where: { id: t.id },
                update: {},
                create: {
                    id: t.id,
                    subjectId: t.subjectId,
                    name: t.name,
                    status: t.status,
                    studyState: t.studyState,
                    picked: Boolean(t.picked),
                    orderIndex: hasOrderIndex ? t.orderIndex : 0, // Handle missing column

                    createdAt: new Date(t.createdAt),
                    updatedAt: new Date(t.updatedAt),
                    // Handle logical optional fields
                    reviewLogs: undefined,
                }
            });
        }
        console.log(`✅ Migrated ${topics.length} topics.`);

        // 3. Migrate DayPlans
        console.log('📦 Migrating DayPlans...');
        const dayPlans = db.prepare('SELECT * FROM DayPlan').all();
        for (const dp of dayPlans as any[]) {
            await prisma.dayPlan.upsert({
                where: { id: dp.id },
                update: {}, // Don't overwrite if exists (preserves new seed data potentially)
                create: {
                    id: dp.id,
                    date: dp.date,
                    createdAt: new Date(dp.createdAt),
                    updatedAt: new Date(dp.updatedAt),
                }
            });
        }
        console.log(`✅ Migrated ${dayPlans.length} day plans.`);

        // 4. Migrate Blocks (Complex due to relations)
        console.log('📦 Migrating Blocks...');
        const blocks = db.prepare('SELECT * FROM Block').all();
        for (const b of blocks as any[]) {
            // Check if parent dayPlan exists first (it should)
            const dayPlanExists = await prisma.dayPlan.findUnique({ where: { id: b.dayPlanId } });
            if (!dayPlanExists) continue;

            await prisma.block.upsert({
                where: { id: b.id },
                update: {},
                create: {
                    id: b.id,
                    dayPlanId: b.dayPlanId,
                    type: b.type,
                    title: b.title,
                    durationMinutes: b.durationMinutes,
                    startTime: b.startTime,
                    status: b.status,
                    orderIndex: b.orderIndex,
                    notes: b.notes,
                    color: b.color,
                    createdAt: new Date(b.createdAt),
                    updatedAt: new Date(b.updatedAt),
                }
            });
        }
        console.log(`✅ Migrated ${blocks.length} blocks.`);

        // 5. Migrate Segments
        console.log('📦 Migrating Segments...');
        const segments = db.prepare('SELECT * FROM Segment').all();
        for (const s of segments as any[]) {
            const blockExists = await prisma.block.findUnique({ where: { id: s.blockId } });
            if (!blockExists) continue;

            await prisma.segment.upsert({
                where: { id: s.id },
                update: {},
                create: {
                    id: s.id,
                    blockId: s.blockId,
                    title: s.title,
                    durationMinutes: s.durationMinutes,
                    status: s.status,
                    orderIndex: s.orderIndex,
                }
            });
        }
        console.log(`✅ Migrated ${segments.length} segments.`);

        console.log('✨ Data migration completed successfully!');

    } catch (error) {
        console.error('❌ Migration failed:', error);
    } finally {
        if (db) db.close();
        await prisma.$disconnect();
    }
}

migrateData();
