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

# Migración de la base con el aplicador propio (US-275), que sustituye a la CLI de
# Prisma. Hace él mismo la copia previa cuando hay migraciones pendientes (US-233: una
# migración que falla a mitad —o que llega con una imagen más nueva de lo que el
# volumen espera— puede dejar la base inservible, y aquí no hay rollback como en el
# actualizador de systemd): `VACUUM INTO`, correcto con WAL, y conserva las 3 últimas
# en vez de la única `.pre-migrate` de antes.
# Las copias van al VOLUMEN: en el sistema de ficheros del contenedor se perderían justo
# al recrearlo con la imagen nueva, que es cuando hacen falta.
export KRAKENOS_PRE_MIGRATE_DIR="${KRAKENOS_PRE_MIGRATE_DIR:-/data/pre-migrate}"

echo "[entrypoint] Aplicando migraciones de base de datos…"
if ! node dist/migrate.js; then
  echo "[entrypoint] ERROR: la migración falló (la base quedó como estaba)." >&2
  echo "[entrypoint] Las copias previas a la migración están en ${KRAKENOS_PRE_MIGRATE_DIR}/pre-migrate-*.db" >&2
  echo "[entrypoint] Para volver atrás: para el contenedor, restaura la copia más reciente sobre" >&2
  echo "[entrypoint] la base (y borra su -wal/-shm) y arranca la imagen anterior." >&2
  exit 1
fi

echo "[entrypoint] Arrancando KrakenOS…"
exec node dist/index.js
