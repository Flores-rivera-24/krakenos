-- CreateTable
CREATE TABLE "IntegrationConfig" (
    "domain" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "config" TEXT NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
