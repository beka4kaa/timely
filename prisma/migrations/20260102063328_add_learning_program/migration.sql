-- CreateTable
CREATE TABLE "LearningProgram" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT 'Моя программа обучения',
    "startDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" DATETIME,
    "totalWeeks" INTEGER NOT NULL DEFAULT 12,
    "hoursPerWeek" INTEGER NOT NULL DEFAULT 20,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "strategy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WeekPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "programId" TEXT NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "subjectHours" TEXT NOT NULL DEFAULT '{}',
    "focus" TEXT,
    "notes" TEXT,
    CONSTRAINT "WeekPlan_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LearningProgram" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TopicPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "programId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "plannedWeek" INTEGER NOT NULL,
    "estimatedHours" REAL NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "reinforceWeek1" INTEGER,
    "reinforceWeek2" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "completedAt" DATETIME,
    CONSTRAINT "TopicPlan_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LearningProgram" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TopicPlan_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScheduledTest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "programId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "scheduledDate" DATETIME NOT NULL,
    "scheduledTime" TEXT,
    "topicsCovered" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'TOPIC_TEST',
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "completedAt" DATETIME,
    "score" REAL,
    CONSTRAINT "ScheduledTest_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LearningProgram" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScheduledTest_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WeekPlan_programId_idx" ON "WeekPlan"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "WeekPlan_programId_weekNumber_key" ON "WeekPlan"("programId", "weekNumber");

-- CreateIndex
CREATE INDEX "TopicPlan_programId_idx" ON "TopicPlan"("programId");

-- CreateIndex
CREATE INDEX "TopicPlan_topicId_idx" ON "TopicPlan"("topicId");

-- CreateIndex
CREATE INDEX "ScheduledTest_programId_idx" ON "ScheduledTest"("programId");

-- CreateIndex
CREATE INDEX "ScheduledTest_subjectId_idx" ON "ScheduledTest"("subjectId");
