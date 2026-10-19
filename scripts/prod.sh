#!/usr/bin/env bash
#
# KrakenOS — arranque de producción en un solo comando.
#
# Encadena todo el flujo: dependencias → cliente de Prisma → build (agente + web) →
# claves JWT (las genera Node, desde el build; sin openssl, US-277) → migración de la
# base (aplicador propio, US-275) → arranque del agente sirviendo API y UI en un puerto.
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

echo "==> [2/5] Configuración del agente…"
if [[ ! -f "$AGENT/.env" ]]; then
  cp "$AGENT/.env.example" "$AGENT/.env"
  echo "    .env creado desde .env.example — REVÍSALO antes de exponerlo."
fi

echo "==> [3/5] Cliente de Prisma…"
pnpm --filter @krakenos/agent exec prisma generate

echo "==> [4/5] Build (agente + web)…"
pnpm build

echo "==> [5/5] Claves, base de datos y arranque de KrakenOS (API + UI en un puerto)…"
cd "$AGENT"
# Claves JWT y de secretbox si faltan (no sobrescribe nada). La CLI vive en el build.
if [[ ! -f "$AGENT/keys/jwt-private.pem" ]]; then
  node dist/keys.js gen
fi
# Migra aquí, de forma explícita, para que un fallo salga con su causa antes de
# arrancar (el agente también migra al arrancar; sin pendientes es un no-op).
node dist/migrate.js
# `exec` para que las señales (systemd/Ctrl-C) lleguen directas a Node.
exec env NODE_ENV=production node dist/index.js
