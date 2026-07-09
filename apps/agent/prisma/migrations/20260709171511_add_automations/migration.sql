-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" TEXT NOT NULL,
    "condition" TEXT,
    "actions" TEXT NOT NULL,
    "cooldownSec" INTEGER NOT NULL DEFAULT 60,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ruleId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutomationRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AutomationRun_ruleId_createdAt_idx" ON "AutomationRun"("ruleId", "createdAt");

-- CreateIndex
CREATE INDEX "AutomationRun_createdAt_idx" ON "AutomationRun"("createdAt");
