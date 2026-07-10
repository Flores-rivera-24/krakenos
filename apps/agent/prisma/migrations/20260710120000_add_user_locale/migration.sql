-- Idioma de la interfaz por usuario (US-177). Default 'es' (el proyecto nació en español).
ALTER TABLE "User" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'es';
