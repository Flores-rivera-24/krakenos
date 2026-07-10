-- Rollup por minuto del consumo eléctrico por dispositivo IoT (US-181).
-- CreateTable
CREATE TABLE "EnergySample" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceId" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "powerW" REAL NOT NULL
);

-- CreateIndex
CREATE INDEX "EnergySample_deviceId_timestamp_idx" ON "EnergySample"("deviceId", "timestamp");

-- CreateIndex
CREATE INDEX "EnergySample_timestamp_idx" ON "EnergySample"("timestamp");
