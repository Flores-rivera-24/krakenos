-- US-108: horarios de acceso / control parental.
CREATE TABLE "AccessSchedule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "mac" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "days" TEXT NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AccessSchedule_mac_idx" ON "AccessSchedule"("mac");
