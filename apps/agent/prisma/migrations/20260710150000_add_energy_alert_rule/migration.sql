-- Reglas de alerta de consumo eléctrico por dispositivo (US-183).
-- CreateTable
CREATE TABLE "EnergyAlertRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "threshold" REAL NOT NULL,
    "sustainMinutes" INTEGER NOT NULL DEFAULT 5,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "EnergyAlertRule_deviceId_idx" ON "EnergyAlertRule"("deviceId");
