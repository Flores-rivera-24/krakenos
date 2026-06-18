#!/usr/bin/env bash
#
# KrakenOS — arranque de producción en un solo comando.
#
# Encadena todo el flujo: dependencias → claves JWT → migración de la base →
# build (agente + web) → arranque del agente sirviendo API y UI en un puerto.
# El admin NO se siembra: en el primer arranque la UI muestra el wizard /setup.
#
# Uso:   ./scripts/prod.sh            (foreground; Ctrl-C para parar)
# Para un servicio persistente, ver scripts/krakenos.service.example (systemd).
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT="$ROOT/apps/agent"
cd "$ROOT"

echo "==> [1/5] Instalando dependencias (pnpm)…"
pnpm install --frozen-lockfile

echo "==> [2/5] Configuración y claves del agente…"
if [[ ! -f "$AGENT/.env" ]]; then
  cp "$AGENT/.env.example" "$AGENT/.env"
  echo "    .env creado desde .env.example — REVÍSALO antes de exponerlo."
fi
if [[ ! -f "$AGENT/keys/jwt-private.pem" ]]; then
  "$AGENT/scripts/gen-keys.sh"
fi

echo "==> [3/5] Base de datos (Prisma migrate deploy)…"
pnpm --filter @krakenos/agent exec prisma generate
pnpm --filter @krakenos/agent exec prisma migrate deploy

echo "==> [4/5] Build (agente + web)…"
pnpm build

echo "==> [5/5] Arrancando KrakenOS (API + UI en un puerto)…"
cd "$AGENT"
# `exec` para que las señales (systemd/Ctrl-C) lleguen directas a Node.
exec env NODE_ENV=production node dist/index.js
