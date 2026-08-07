-- US-253: destinos ya vistos por aparato, para poder decir «nunca había contactado».
-- Existe porque DnsQueryLog se poda a los 7 días y sobre esa ventana «nunca» no
-- es sabible. Guarda el dominio REGISTRABLE (eTLD+1), no el FQDN: detecta un
-- cambio de comportamiento sin permitir reconstruir navegación. Retención propia
-- y más larga, declarada en config/retention.ts.
CREATE TABLE "KnownDestination" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mac" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "KnownDestination_mac_domain_key" ON "KnownDestination"("mac", "domain");
CREATE INDEX "KnownDestination_lastSeenAt_idx" ON "KnownDestination"("lastSeenAt");
