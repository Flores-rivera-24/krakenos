#!/usr/bin/env bash
# Genera un certificado TLS autofirmado para servir el agente por HTTPS en la LAN.
# Uso: ./scripts/gen-cert.sh [hostname-o-IP]   (por defecto: la IP de LAN detectada)
set -euo pipefail

CERTS_DIR="$(cd "$(dirname "$0")/.." && pwd)/certs"
mkdir -p "$CERTS_DIR"

if [[ -f "$CERTS_DIR/agent-cert.pem" ]]; then
  echo "El certificado ya existe en $CERTS_DIR — abortando para no sobrescribir." >&2
  exit 1
fi

# Host/IP para el SAN: argumento, o primera IP de LAN, o localhost.
HOST="${1:-$(hostname -I 2>/dev/null | awk '{print $1}')}"
HOST="${HOST:-127.0.0.1}"

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$CERTS_DIR/agent-key.pem" \
  -out "$CERTS_DIR/agent-cert.pem" \
  -days 825 \
  -subj "/CN=krakenos.local" \
  -addext "subjectAltName=DNS:localhost,DNS:krakenos.local,IP:127.0.0.1,IP:${HOST}"

chmod 600 "$CERTS_DIR/agent-key.pem"

echo "Certificado autofirmado generado en $CERTS_DIR (SAN: localhost, krakenos.local, 127.0.0.1, ${HOST})"
echo "Pon HTTPS_ENABLED=true en .env para activarlo."
