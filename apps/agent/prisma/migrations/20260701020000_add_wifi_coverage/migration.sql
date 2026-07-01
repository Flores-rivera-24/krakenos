-- CreateTable
CREATE TABLE "FloorPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "widthM" REAL NOT NULL,
    "heightM" REAL NOT NULL,
    "backgroundImage" TEXT,
    "walls" TEXT NOT NULL DEFAULT '[]',
    "accessPoints" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SurveyScan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "floorPlanId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "band" TEXT NOT NULL,
    "deviceMac" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SurveyScan_floorPlanId_fkey" FOREIGN KEY ("floorPlanId") REFERENCES "FloorPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SurveySample" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scanId" TEXT NOT NULL,
    "x" REAL NOT NULL,
    "y" REAL NOT NULL,
    "rssiDbm" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SurveySample_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "SurveyScan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SurveyScan_floorPlanId_idx" ON "SurveyScan"("floorPlanId");

-- CreateIndex
CREATE INDEX "SurveySample_scanId_idx" ON "SurveySample"("scanId");
