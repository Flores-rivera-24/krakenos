#!/usr/bin/env bash
# Genera el par de claves RS256 para firmar/verificar JWT.
# Uso: ./scripts/gen-keys.sh
set -euo pipefail

KEYS_DIR="$(cd "$(dirname "$0")/.." && pwd)/keys"
mkdir -p "$KEYS_DIR"

if [[ -f "$KEYS_DIR/jwt-private.pem" ]]; then
  echo "Las claves ya existen en $KEYS_DIR — abortando para no sobrescribir." >&2
  exit 1
fi

openssl genpkey -algorithm RSA -out "$KEYS_DIR/jwt-private.pem" -pkeyopt rsa_keygen_bits:2048
openssl rsa -in "$KEYS_DIR/jwt-private.pem" -pubout -out "$KEYS_DIR/jwt-public.pem"
chmod 600 "$KEYS_DIR/jwt-private.pem"

echo "Claves RS256 generadas en $KEYS_DIR"
