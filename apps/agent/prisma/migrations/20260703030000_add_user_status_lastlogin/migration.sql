-- US-101: gestión de usuarios. Estado de cuenta + último acceso.
-- SQLite permite ADD COLUMN con NOT NULL + DEFAULT constante (rellena filas existentes).
ALTER TABLE "User" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "User" ADD COLUMN "lastLoginAt" DATETIME;
