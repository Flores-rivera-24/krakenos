-- US-112: reglas de alerta configurables.
CREATE TABLE "AlertRule" (
  "event" TEXT NOT NULL PRIMARY KEY,
  "push" BOOLEAN NOT NULL DEFAULT true,
  "email" BOOLEAN NOT NULL DEFAULT false
);
