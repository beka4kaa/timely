-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Topic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subjectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "studyState" TEXT NOT NULL DEFAULT 'NOT_STUDIED',
    "picked" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "lastRevisedAt" DATETIME,
    "nextReviewAt" DATETIME,
    "intervalDays" INTEGER,
    "easeFactor" REAL NOT NULL DEFAULT 2.5,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Topic_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Topic" ("archived", "createdAt", "easeFactor", "id", "intervalDays", "lastRevisedAt", "name", "nextReviewAt", "picked", "status", "studyState", "subjectId", "updatedAt") SELECT "archived", "createdAt", "easeFactor", "id", "intervalDays", "lastRevisedAt", "name", "nextReviewAt", "picked", "status", "studyState", "subjectId", "updatedAt" FROM "Topic";
DROP TABLE "Topic";
ALTER TABLE "new_Topic" RENAME TO "Topic";
CREATE INDEX "Topic_subjectId_idx" ON "Topic"("subjectId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
