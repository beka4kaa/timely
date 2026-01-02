-- CreateTable
CREATE TABLE "ScheduleBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#3b82f6',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "subjectEmoji" TEXT,
    "subjectName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
