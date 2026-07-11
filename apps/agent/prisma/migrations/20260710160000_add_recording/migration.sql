-- Clips grabados por evento de movimiento (US-187). Metadatos + ruta en disco.
-- CreateTable
CREATE TABLE "Recording" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cameraId" TEXT NOT NULL,
    "cameraName" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "snapshot" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Recording_cameraId_startedAt_idx" ON "Recording"("cameraId", "startedAt");

-- CreateIndex
CREATE INDEX "Recording_startedAt_idx" ON "Recording"("startedAt");
