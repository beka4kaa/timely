-- CreateTable
CREATE TABLE "Subtopic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Subtopic_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SrsState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "subtopicId" TEXT,
    "reviewSetId" TEXT,
    "lastReviewedAt" DATETIME,
    "nextReviewAt" DATETIME,
    "intervalDays" INTEGER,
    "easeFactor" REAL NOT NULL DEFAULT 2.5,
    "mastery" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SrsState_subtopicId_fkey" FOREIGN KEY ("subtopicId") REFERENCES "Subtopic" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SrsState_reviewSetId_fkey" FOREIGN KEY ("reviewSetId") REFERENCES "ReviewSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subjectId" TEXT,
    "topicId" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ReviewSet_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewSet_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReviewSetLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reviewSetId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    CONSTRAINT "ReviewSetLink_reviewSetId_fkey" FOREIGN KEY ("reviewSetId") REFERENCES "ReviewSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewSetLink_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SrsReviewLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "reviewedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "intervalDaysAfter" INTEGER NOT NULL
);

-- CreateIndex
CREATE INDEX "Subtopic_topicId_idx" ON "Subtopic"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "SrsState_subtopicId_key" ON "SrsState"("subtopicId");

-- CreateIndex
CREATE UNIQUE INDEX "SrsState_reviewSetId_key" ON "SrsState"("reviewSetId");

-- CreateIndex
CREATE INDEX "ReviewSet_subjectId_idx" ON "ReviewSet"("subjectId");

-- CreateIndex
CREATE INDEX "ReviewSet_topicId_idx" ON "ReviewSet"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewSetLink_reviewSetId_topicId_key" ON "ReviewSetLink"("reviewSetId", "topicId");

-- CreateIndex
CREATE INDEX "SrsReviewLog_entityId_idx" ON "SrsReviewLog"("entityId");
