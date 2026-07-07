-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'generic',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "IotRoomMember" (
    "iotDeviceId" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IotRoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "sources" TEXT NOT NULL DEFAULT '[]',
    "firstSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Device_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Device" ("firstSeen", "hostname", "id", "ip", "isBlocked", "label", "lastSeen", "mac", "notes", "online", "pausedUntil", "sources", "type", "vendor", "vlanTag") SELECT "firstSeen", "hostname", "id", "ip", "isBlocked", "label", "lastSeen", "mac", "notes", "online", "pausedUntil", "sources", "type", "vendor", "vlanTag" FROM "Device";
DROP TABLE "Device";
ALTER TABLE "new_Device" RENAME TO "Device";
CREATE UNIQUE INDEX "Device_mac_key" ON "Device"("mac");
CREATE INDEX "Device_online_idx" ON "Device"("online");
CREATE INDEX "Device_roomId_idx" ON "Device"("roomId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "IotRoomMember_roomId_idx" ON "IotRoomMember"("roomId");

-- CreateIndex
CREATE INDEX "Favorite_userId_idx" ON "Favorite"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_userId_kind_ref_key" ON "Favorite"("userId", "kind", "ref");
