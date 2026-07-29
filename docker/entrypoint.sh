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

# Snapshot antes de migrar (US-233). Una migración que falla a mitad —o que llega con
# una imagen más nueva de lo que el volumen espera— puede dejar la base inservible, y
# aquí no hay rollback como en el actualizador de systemd (US-190). Copiar el fichero
# es barato y es la diferencia entre «vuelvo atrás» y «he perdido la casa».
# Se conserva UNA copia (`.pre-migrate`): es una red de seguridad para el arranque, no
# un histórico — para eso están las copias cifradas de Ajustes → Sistema.
DB_FILE="$(printf '%s' "${DATABASE_URL:-file:./prisma/dev.db}" | sed 's/^file://')"
case "$DB_FILE" in
  /*) ;;
  *) DB_FILE="$(pwd)/$DB_FILE" ;;
esac
if [ -f "$DB_FILE" ]; then
  echo "[entrypoint] Copia previa a la migración: ${DB_FILE}.pre-migrate"
  # `cp` del principal + WAL: con WAL activo (US-228) el fichero suelto no basta.
  cp "$DB_FILE" "${DB_FILE}.pre-migrate" || echo "[entrypoint] AVISO: no se pudo copiar la base antes de migrar"
  [ -f "${DB_FILE}-wal" ] && cp "${DB_FILE}-wal" "${DB_FILE}.pre-migrate-wal" || true
fi

echo "[entrypoint] Aplicando migraciones de base de datos…"
if ! pnpm exec prisma migrate deploy; then
  echo "[entrypoint] ERROR: la migración falló." >&2
  if [ -f "${DB_FILE}.pre-migrate" ]; then
    echo "[entrypoint] La base ANTERIOR está intacta en ${DB_FILE}.pre-migrate" >&2
    echo "[entrypoint] Para volver atrás: para el contenedor, restaura ese fichero sobre" >&2
    echo "[entrypoint] ${DB_FILE} (y su -wal) y arranca la imagen anterior." >&2
  fi
  exit 1
fi

echo "[entrypoint] Arrancando KrakenOS…"
exec node dist/index.js
