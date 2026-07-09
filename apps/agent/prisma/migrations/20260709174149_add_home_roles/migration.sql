-- AlterTable
ALTER TABLE "User" ADD COLUMN "expiresAt" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Device" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mac" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "hostname" TEXT,
    "label" TEXT,
    "vendor" TEXT,
    "type" TEXT NOT NULL DEFAULT 'unknown',
    "notes" TEXT,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "pausedUntil" DATETIME,
    "online" BOOLEAN NOT NULL DEFAULT true,
    "vlanTag" INTEGER,
    "roomId" TEXT,
    "ownerId" TEXT,
    "sources" TEXT NOT NULL DEFAULT '[]',
    "firstSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Device_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Device_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Device" ("firstSeen", "hostname", "id", "ip", "isBlocked", "label", "lastSeen", "mac", "notes", "online", "pausedUntil", "roomId", "sources", "type", "vendor", "vlanTag") SELECT "firstSeen", "hostname", "id", "ip", "isBlocked", "label", "lastSeen", "mac", "notes", "online", "pausedUntil", "roomId", "sources", "type", "vendor", "vlanTag" FROM "Device";
DROP TABLE "Device";
ALTER TABLE "new_Device" RENAME TO "Device";
CREATE UNIQUE INDEX "Device_mac_key" ON "Device"("mac");
CREATE INDEX "Device_online_idx" ON "Device"("online");
CREATE INDEX "Device_roomId_idx" ON "Device"("roomId");
CREATE INDEX "Device_ownerId_idx" ON "Device"("ownerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
