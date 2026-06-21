#!/usr/bin/env bash
# Rota el par de claves RS256 de firma de JWT (US-64) con solape.
#
# Qué hace:
#   1. Conserva la clave pública ACTUAL como "previa" (jwt-public.prev.pem), para
#      que los tokens aún válidos firmados con ella sigan verificando durante el
#      solape (no cierra las sesiones existentes).
#   2. Genera un par NUEVO (jwt-private.pem / jwt-public.pem) que pasa a firmar.
#
# Después de ejecutarlo:
#   - Añade/ajusta en el .env:  JWT_PREVIOUS_PUBLIC_KEY_PATHS=./keys/jwt-public.prev.pem
#   - Reinicia el agente (systemctl restart krakenos, o el proceso). A partir de
#     ahí firma con la clave nueva (kid nuevo) y verifica con ambas.
#   - Pasado el solape (>= la vida del refresh token, REFRESH_TOKEN_TTL), retira
#     la previa: borra jwt-public.prev.pem y quita JWT_PREVIOUS_PUBLIC_KEY_PATHS,
#     y reinicia de nuevo.
#
# Uso: ./scripts/rotate-keys.sh
set -euo pipefail

KEYS_DIR="$(cd "$(dirname "$0")/.." && pwd)/keys"
PRIV="$KEYS_DIR/jwt-private.pem"
PUB="$KEYS_DIR/jwt-public.pem"
PREV_PUB="$KEYS_DIR/jwt-public.prev.pem"

if [[ ! -f "$PRIV" || ! -f "$PUB" ]]; then
  echo "No existe el par actual en $KEYS_DIR. Genera el primero con ./scripts/gen-keys.sh." >&2
  exit 1
fi

# 1. La pública actual pasa a ser la "previa" del solape.
cp "$PUB" "$PREV_PUB"
chmod 644 "$PREV_PUB"

# 2. Genera el par nuevo (sobrescribe el actual).
TMP_PRIV="$(mktemp "$KEYS_DIR/.jwt-private.XXXXXX")"
openssl genpkey -algorithm RSA -out "$TMP_PRIV" -pkeyopt rsa_keygen_bits:2048
openssl rsa -in "$TMP_PRIV" -pubout -out "$PUB"
mv "$TMP_PRIV" "$PRIV"
chmod 600 "$PRIV"

echo "Rotación lista:"
echo "  · Clave de firma NUEVA: $PRIV / $PUB"
echo "  · Clave PREVIA (solape): $PREV_PUB"
echo
echo "Siguiente:"
echo "  1) En el .env:  JWT_PREVIOUS_PUBLIC_KEY_PATHS=./keys/jwt-public.prev.pem"
echo "  2) Reinicia el agente."
echo "  3) Tras el solape (>= REFRESH_TOKEN_TTL), borra $PREV_PUB, quita la"
echo "     variable y reinicia. Ver docs/jwt-key-rotation.md."
