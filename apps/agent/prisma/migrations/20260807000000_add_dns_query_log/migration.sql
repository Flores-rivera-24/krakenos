-- CreateTable
CREATE TABLE "DnsQueryLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "timestamp" DATETIME NOT NULL,
    "domain" TEXT NOT NULL,
    "client" TEXT NOT NULL,
    "blocked" BOOLEAN NOT NULL,
    "mac" TEXT
);

-- CreateIndex
CREATE INDEX "DnsQueryLog_timestamp_idx" ON "DnsQueryLog"("timestamp");

-- CreateIndex
CREATE INDEX "DnsQueryLog_mac_timestamp_idx" ON "DnsQueryLog"("mac", "timestamp");

