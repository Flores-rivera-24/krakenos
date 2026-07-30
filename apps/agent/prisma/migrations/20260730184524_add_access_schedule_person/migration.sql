-- US-240: el control parental pasa a definirse **por persona**, no por MAC.
--
-- `AccessSchedule.personId` marca las filas que gobierna una persona: el servidor
-- replica su «hora de dormir» a todos sus dispositivos (una fila por MAC) y las
-- reconcilia cuando el parque de aparatos cambia. Las filas existentes quedan con
-- `personId = NULL`, que es exactamente lo que son: horarios creados sobre un
-- dispositivo suelto desde su detalle (US-108). No hay pérdida ni remapeo.
--
-- `ON DELETE CASCADE` a propósito: un horario de persona que sobreviva a su persona
-- seguiría cortando internet a un aparato heredado sin nadie a quien atribuirlo.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AccessSchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "mac" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "days" TEXT NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "personId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessSchedule_personId_fkey" FOREIGN KEY ("personId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AccessSchedule" ("createdAt", "days", "enabled", "endMinute", "id", "mac", "name", "startMinute") SELECT "createdAt", "days", "enabled", "endMinute", "id", "mac", "name", "startMinute" FROM "AccessSchedule";
DROP TABLE "AccessSchedule";
ALTER TABLE "new_AccessSchedule" RENAME TO "AccessSchedule";
CREATE INDEX "AccessSchedule_mac_idx" ON "AccessSchedule"("mac");
CREATE INDEX "AccessSchedule_personId_idx" ON "AccessSchedule"("personId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
