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
    "online" BOOLEAN NOT NULL DEFAULT true,
    "sources" TEXT NOT NULL DEFAULT '[]',
    "firstSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Device" ("firstSeen", "hostname", "id", "ip", "label", "lastSeen", "mac", "notes", "online", "sources", "type", "vendor") SELECT "firstSeen", "hostname", "id", "ip", "label", "lastSeen", "mac", "notes", "online", "sources", "type", "vendor" FROM "Device";
DROP TABLE "Device";
ALTER TABLE "new_Device" RENAME TO "Device";
CREATE UNIQUE INDEX "Device_mac_key" ON "Device"("mac");
CREATE INDEX "Device_online_idx" ON "Device"("online");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
