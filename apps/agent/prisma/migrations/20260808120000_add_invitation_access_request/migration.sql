-- US-272 · Invitaciones de un solo uso.
--
-- Sustituye al alta en la que el admin tecleaba ÉL la contraseña y se la mandaba a
-- la persona por WhatsApp: la contraseña más reutilizada de la casa viajando por un
-- chat, y conocida por dos personas desde el minuto cero. Ahora la elige quien la va
-- a usar y nadie más la ve.
--
-- Solo se guarda el hash del token, como con los refresh y los códigos de
-- recuperación: quien lea la base no puede usar las invitaciones pendientes.
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "accountExpiresAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");
CREATE INDEX "Invitation_email_idx" ON "Invitation"("email");

-- US-273 · Solicitudes de acceso desde la pantalla de entrada.
--
-- El autorregistro abierto está descartado a propósito: KrakenOS controla firewall,
-- cámaras y cerraduras, y hasta un rol `viewer` ve el inventario de red entero. Quien
-- decide el rol —y si entra siquiera— es siempre un administrador.
--
-- `email` es UNIQUE para que reenviar la solicitud no llene la bandeja del admin con
-- la misma persona repetida.
CREATE TABLE "AccessRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "decidedAt" DATETIME,
    "decidedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AccessRequest_email_key" ON "AccessRequest"("email");
CREATE INDEX "AccessRequest_status_idx" ON "AccessRequest"("status");
