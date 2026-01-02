-- CreateTable
CREATE TABLE "DayPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Block" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dayPlanId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "startTime" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "orderIndex" INTEGER NOT NULL,
    "notes" TEXT,
    "color" TEXT NOT NULL DEFAULT '#3b82f6',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Block_dayPlanId_fkey" FOREIGN KEY ("dayPlanId") REFERENCES "DayPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "blockId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "orderIndex" INTEGER NOT NULL,
    CONSTRAINT "Segment_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Subtask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "blockId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL,
    CONSTRAINT "Subtask_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TimerState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "blockId" TEXT NOT NULL,
    "segmentIndex" INTEGER,
    "startedAt" DATETIME,
    "remainingSeconds" INTEGER NOT NULL,
    "isRunning" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "TimerState_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DayPlan_date_key" ON "DayPlan"("date");

-- CreateIndex
CREATE INDEX "Block_dayPlanId_idx" ON "Block"("dayPlanId");

-- CreateIndex
CREATE INDEX "Segment_blockId_idx" ON "Segment"("blockId");

-- CreateIndex
CREATE INDEX "Subtask_blockId_idx" ON "Subtask"("blockId");

-- CreateIndex
CREATE UNIQUE INDEX "TimerState_blockId_key" ON "TimerState"("blockId");
