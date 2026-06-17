-- CreateTable
CREATE TABLE "TrafficSample" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rxBytesPerSec" REAL NOT NULL,
    "txBytesPerSec" REAL NOT NULL
);

-- CreateIndex
CREATE INDEX "TrafficSample_timestamp_idx" ON "TrafficSample"("timestamp");
