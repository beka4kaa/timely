-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TopicPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "programId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "plannedWeek" INTEGER NOT NULL,
    "estimatedHours" REAL NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "deadline" DATETIME,
    "isFlexible" BOOLEAN NOT NULL DEFAULT true,
    "manuallyMoved" BOOLEAN NOT NULL DEFAULT false,
    "reinforceWeek1" INTEGER,
    "reinforceWeek2" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "completedAt" DATETIME,
    CONSTRAINT "TopicPlan_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LearningProgram" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TopicPlan_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TopicPlan" ("completedAt", "estimatedHours", "id", "plannedWeek", "priority", "programId", "reinforceWeek1", "reinforceWeek2", "status", "topicId") SELECT "completedAt", "estimatedHours", "id", "plannedWeek", "priority", "programId", "reinforceWeek1", "reinforceWeek2", "status", "topicId" FROM "TopicPlan";
DROP TABLE "TopicPlan";
ALTER TABLE "new_TopicPlan" RENAME TO "TopicPlan";
CREATE INDEX "TopicPlan_programId_idx" ON "TopicPlan"("programId");
CREATE INDEX "TopicPlan_topicId_idx" ON "TopicPlan"("topicId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
