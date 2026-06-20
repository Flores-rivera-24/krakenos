-- CreateTable
CREATE TABLE "DeviceTrafficSample" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mac" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rxBytesPerSec" REAL NOT NULL,
    "txBytesPerSec" REAL NOT NULL
);

-- CreateIndex
CREATE INDEX "DeviceTrafficSample_mac_timestamp_idx" ON "DeviceTrafficSample"("mac", "timestamp");
