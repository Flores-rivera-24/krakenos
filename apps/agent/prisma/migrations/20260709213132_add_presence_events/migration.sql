-- CreateTable
CREATE TABLE "PresenceEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PresenceEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PresenceEvent_userId_createdAt_idx" ON "PresenceEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PresenceEvent_createdAt_idx" ON "PresenceEvent"("createdAt");
