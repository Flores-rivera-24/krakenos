-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AlertRule" (
    "event" TEXT NOT NULL PRIMARY KEY,
    "push" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "telegram" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "new_AlertRule" ("email", "event", "push") SELECT "email", "event", "push" FROM "AlertRule";
DROP TABLE "AlertRule";
ALTER TABLE "new_AlertRule" RENAME TO "AlertRule";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
