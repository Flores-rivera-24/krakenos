#!/usr/bin/env bash
# Crea (una sola vez) una CA propia de KrakenOS y emite con ella el certificado
# TLS del agente para la red local. Sustituye al autofirmado suelto de gen-cert.sh:
# con una CA, cada dispositivo instala UN certificado público una vez y confía en
# el servidor — también tras cada renovación del certificado de servidor.
#
# Uso: ./scripts/gen-local-ca.sh        (idempotente: re-ejecutarlo es seguro)
#
#   · CA (solo si no existe): clave en keys/krakenos-ca-key.pem (600) y certificado
#     público en certs/krakenos-ca.pem. 10 años. Lleva `nameConstraints`: solo puede
#     avalar *.local, localhost y rangos privados. Si su clave se filtrara, NO sirve
#     para suplantar ningún sitio de internet.
#   · Servidor (si falta, caduca en <60 días, ya no lo avala la CA o cambió la IP):
#     certs/agent-key.pem (600) + certs/agent-cert.pem. 825 días, el máximo que
#     Apple admite para raíces instaladas por el usuario.
#
# Variables (tests/instalador): KRAKENOS_CERTS_DIR · KRAKENOS_KEYS_DIR ·
#   KRAKENOS_HOSTNAME · KRAKENOS_LAN_IP · KRAKENOS_TLS_GROUP
#
# KRAKENOS_TLS_GROUP: grupo (el del servicio) que debe poder LEER el certificado y
# la clave del servidor. El instalador ejecuta este script como root desde una copia
# de root (/usr/local/lib/krakenos) y con los directorios en /etc/krakenos, que el
# servicio no puede modificar: root nunca ejecuta ni escribe nada que el servicio
# pueda cambiar. Por eso aquí se rechaza cualquier destino que sea un enlace
# simbólico y los permisos se ajustan sobre ficheros de directorios de root.
set -euo pipefail

# Las claves no deben nacer legibles por otros usuarios.
umask 077

AGENT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERTS_DIR="${KRAKENOS_CERTS_DIR:-$AGENT_DIR/certs}"
KEYS_DIR="${KRAKENOS_KEYS_DIR:-$AGENT_DIR/keys}"

CA_KEY="$KEYS_DIR/krakenos-ca-key.pem"
CA_CERT="$CERTS_DIR/krakenos-ca.pem"
SRV_KEY="$CERTS_DIR/agent-key.pem"
SRV_CERT="$CERTS_DIR/agent-cert.pem"

CA_DAYS=3650
SRV_DAYS=825
RENEW_BEFORE_DAYS=60

# Todo lo que esta CA puede avalar. `DNS:local` cubre *.local; las IP van como
# dirección/máscara. Es el seguro de la CA: no se amplía sin una decisión expresa.
NAME_CONSTRAINTS="critical,permitted;DNS:local,permitted;DNS:localhost,permitted;IP:127.0.0.0/255.0.0.0,permitted;IP:10.0.0.0/255.0.0.0,permitted;IP:172.16.0.0/255.240.0.0,permitted;IP:192.168.0.0/255.255.0.0"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
info() { printf '%s\n' "$*"; }
warn() { printf 'AVISO: %s\n' "$*" >&2; }

command -v openssl > /dev/null 2>&1 || die "falta openssl"

# Nombre corto del equipo, saneado para usarlo en un nombre DNS.
raw_host="${KRAKENOS_HOSTNAME:-$(hostname -s 2> /dev/null || true)}"
HOST_NAME="$(printf '%s' "$raw_host" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')"
HOST_NAME="${HOST_NAME:-krakenos}"

# ¿Es una IPv4 privada (RFC 1918) o de loopback? Fuera de esos rangos la IP
# quedaría fuera de las nameConstraints y rompería la verificación.
is_private_ipv4() {
  local ip="$1" a b c d
  [[ "$ip" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] || return 1
  a="${BASH_REMATCH[1]}" b="${BASH_REMATCH[2]}" c="${BASH_REMATCH[3]}" d="${BASH_REMATCH[4]}"
  ((10#$a <= 255 && 10#$b <= 255 && 10#$c <= 255 && 10#$d <= 255)) || return 1
  ((10#$a == 10 || 10#$a == 127)) && return 0
  ((10#$a == 172 && 10#$b >= 16 && 10#$b <= 31)) && return 0
  ((10#$a == 192 && 10#$b == 168)) && return 0
  return 1
}

# IPv4 de la LAN: la inyectada, o la primera PRIVADA que dé `hostname -I`.
LAN_IP=""
if [[ -n "${KRAKENOS_LAN_IP:-}" ]]; then
  candidates="$KRAKENOS_LAN_IP"
else
  candidates="$(hostname -I 2> /dev/null || true)"
fi
for ip in $candidates; do
  if is_private_ipv4 "$ip"; then
    LAN_IP="$ip"
    break
  fi
done
if [[ -z "$LAN_IP" ]]; then
  warn "no hay una IPv4 privada de LAN: el certificado NO incluirá IP (se entra por ${HOST_NAME}.local)"
fi

# Ni los directorios ni los ficheros destino pueden ser enlaces simbólicos: openssl,
# chmod y chgrp los seguirían y escribirían (o abrirían) donde apunte el enlace.
for target in "$CERTS_DIR" "$KEYS_DIR" "$CA_KEY" "$CA_CERT" "$SRV_KEY" "$SRV_CERT"; do
  [[ ! -L "$target" ]] || die "$target es un enlace simbólico: me niego a escribir a través de él"
done

mkdir -p "$CERTS_DIR" "$KEYS_DIR"

# --- CA -------------------------------------------------------------------
if [[ -f "$CA_KEY" && -f "$CA_CERT" ]]; then
  info "CA ya existente: se conserva ($CA_CERT)"
elif [[ -f "$CA_KEY" || -f "$CA_CERT" ]]; then
  # Una mitad sola: regenerar la otra invalidaría los certificados ya instalados
  # en los dispositivos sin avisar.
  die "la CA está a medias (¿falta $CA_KEY o $CA_CERT?): restaura el par o bórralos ambos a conciencia"
else
  info "Creando la CA local de KrakenOS…"
  openssl req -x509 -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
    -keyout "$CA_KEY" -out "$CA_CERT" -days "$CA_DAYS" -sha256 \
    -subj "/CN=KrakenOS CA local (${HOST_NAME})" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash" \
    -addext "nameConstraints=${NAME_CONSTRAINTS}" 2> /dev/null
  chmod 600 "$CA_KEY"
  chmod 644 "$CA_CERT"
fi

# --- Certificado de servidor ---------------------------------------------
san="DNS:${HOST_NAME}.local,DNS:krakenos.local,DNS:localhost,IP:127.0.0.1"
[[ -n "$LAN_IP" ]] && san="${san},IP:${LAN_IP}"

# ¿Hay que (re)emitir? Falta, caduca pronto, ya no lo avala esta CA o su SAN dejó
# de coincidir con lo que hoy se sirve (cambió la IP o el nombre del equipo).
needs_issue() {
  [[ -f "$SRV_KEY" && -f "$SRV_CERT" ]] || return 0
  openssl x509 -in "$SRV_CERT" -noout -checkend $((RENEW_BEFORE_DAYS * 86400)) > /dev/null 2>&1 || return 0
  openssl verify -CAfile "$CA_CERT" "$SRV_CERT" > /dev/null 2>&1 || return 0
  local actual expected
  actual="$(openssl x509 -in "$SRV_CERT" -noout -ext subjectAltName 2> /dev/null | tail -n +2 | tr -d ' \n')"
  # OpenSSL imprime «IP Address:» donde se escribe «IP:».
  actual="${actual//IPAddress:/IP:}"
  expected="${san// /}"
  [[ "$actual" == "$expected" ]] || return 0
  return 1
}

if needs_issue; then
  info "Emitiendo el certificado del servidor (SAN: ${san})…"
  # Dentro de CERTS_DIR (no en /tmp): así los `mv` finales son renombrados del
  # mismo sistema de ficheros, atómicos, y nunca una copia que siga un enlace.
  tmp="$(mktemp -d "$CERTS_DIR/.emision.XXXXXX")"
  trap 'rm -rf "$tmp"' EXIT
  openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
    -keyout "$tmp/key.pem" -out "$tmp/req.csr" -subj "/CN=${HOST_NAME}.local" 2> /dev/null
  printf '%s\n' \
    "basicConstraints=critical,CA:FALSE" \
    "keyUsage=critical,digitalSignature,keyEncipherment" \
    "extendedKeyUsage=serverAuth" \
    "subjectKeyIdentifier=hash" \
    "authorityKeyIdentifier=keyid" \
    "subjectAltName=${san}" > "$tmp/ext.cnf"
  openssl x509 -req -in "$tmp/req.csr" -CA "$CA_CERT" -CAkey "$CA_KEY" \
    -set_serial "0x$(openssl rand -hex 16)" -days "$SRV_DAYS" -sha256 \
    -extfile "$tmp/ext.cnf" -out "$tmp/cert.pem" 2> /dev/null
  # Se mueven al final: nunca queda un par a medias si algo falla antes.
  mv "$tmp/key.pem" "$SRV_KEY"
  mv "$tmp/cert.pem" "$SRV_CERT"
  chmod 600 "$SRV_KEY"
  chmod 644 "$SRV_CERT"
  info "Certificado emitido: $SRV_CERT"
else
  info "El certificado del servidor sigue vigente: no se reemite"
fi

# Permisos del par servido: el servicio lee por GRUPO, no es dueño. Se reaplican
# siempre (también si no hubo reemisión) para corregir instalaciones previas.
if [[ -n "${KRAKENOS_TLS_GROUP:-}" ]]; then
  chgrp "$KRAKENOS_TLS_GROUP" "$SRV_KEY" "$SRV_CERT" "$CA_CERT"
  chmod 640 "$SRV_KEY"
  chmod 644 "$SRV_CERT" "$CA_CERT"
fi

info "Certificado de la CA (el que cada dispositivo debe instalar): $CA_CERT"
