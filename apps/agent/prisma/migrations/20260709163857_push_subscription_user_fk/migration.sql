-- Poda suscripciones huérfanas (usuario ya borrado) antes de imponer la FK:
-- seguían recibiendo push de seguridad tras la revocación del acceso (AUD-02).
DELETE FROM "PushSubscription" WHERE "userId" NOT IN (SELECT "id" FROM "User");

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PushSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PushSubscription" ("auth", "createdAt", "endpoint", "id", "p256dh", "userId") SELECT "auth", "createdAt", "endpoint", "id", "p256dh", "userId" FROM "PushSubscription";
DROP TABLE "PushSubscription";
ALTER TABLE "new_PushSubscription" RENAME TO "PushSubscription";
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
