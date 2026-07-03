#!/bin/sh
# Arranque del contenedor: genera claves si faltan, aplica migraciones y arranca.
set -e

export JWT_PRIVATE_KEY_PATH="${JWT_PRIVATE_KEY_PATH:-/data/keys/jwt-private.pem}"
export JWT_PUBLIC_KEY_PATH="${JWT_PUBLIC_KEY_PATH:-/data/keys/jwt-public.pem}"

mkdir -p "$(dirname "$JWT_PRIVATE_KEY_PATH")"

# Par RS256 para los JWT (el resto de claves —secretbox, VAPID— se autogeneran al
# arrancar). El agente EXIGE la clave privada al iniciar, así que debe existir ya.
if [ ! -f "$JWT_PRIVATE_KEY_PATH" ]; then
  echo "[entrypoint] Generando claves JWT RS256…"
  # umask 077 en un subshell: la clave privada nace 600 (sin ventana legible por
  # grupo/otros entre crearla y el chmod).
  ( umask 077
    openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$JWT_PRIVATE_KEY_PATH"
    openssl rsa -pubout -in "$JWT_PRIVATE_KEY_PATH" -out "$JWT_PUBLIC_KEY_PATH" )
  chmod 600 "$JWT_PRIVATE_KEY_PATH"
fi

echo "[entrypoint] Aplicando migraciones de base de datos…"
pnpm exec prisma migrate deploy

echo "[entrypoint] Arrancando KrakenOS…"
exec node dist/index.js
