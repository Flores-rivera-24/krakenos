#!/usr/bin/env bash
#
# KrakenOS — biblioteca de sistema compartida: sudoers validado y material TLS.
#
# Se CARGA con `source`, no se ejecuta. La usan `scripts/install.sh` y el
# `krakenos-setup` del paquete, para que los dos hagan exactamente lo mismo.
# Las funciones se movieron tal cual de install.sh; la única diferencia es que la
# plantilla del .env ya no se deduce de $INSTALL_DIR sino de $ENV_EXAMPLE.
#
# CONTRATO — quien la carga define ANTES de llamar a cualquier función:
#   Funciones:
#     run, log, warn, die       ejecutar (respeta DRY_RUN), mensajes y abortar
#     write_file, set_env_var   escribir un fichero / fijar una variable del .env
#     has_systemd               ¿hay systemd?
#     agent_port                puerto del agente
#     tailscale_fqdn            nombre MagicDNS de Tailscale (vacío si no hay)
#   Variables:
#     DRY_RUN, NO_SERVICE       0/1
#     SERVICE_USER, SERVICE_NAME
#     TLS_DIR, CA_DIR, LIB_DIR  dirs de root (material TLS y copia de local-ca.js)
#     TLS_MODE                  auto|tailscale|local|none (resolve_tls_mode lo fija)
#     SUMMARY                   array donde se acumula el resumen final
#     ROOT_NODE                 node con el que root ejecuta local-ca.js
#                               (lo fija el que carga, p. ej. install_root_script)
#     ENV_EXAMPLE               ruta de la plantilla .env.example (setup_tls_local
#                               solo fija WEBAUTHN_* si la plantilla los contempla)
#     INSTALL_DIR               solo ensure_service_user: home del usuario del servicio
#
# Sin `set -e`/`umask`: eso lo decide el script que la carga.

# Instala un fichero de sudoers VALIDÁNDOLO antes de ponerlo en su sitio: un
# /etc/sudoers.d con error de sintaxis rompe `sudo` en toda la máquina (AUD3-06),
# así que se valida una copia temporal y solo entonces se mueve.
install_sudoers() {
  local dest="$1" content="$2"
  if [[ $DRY_RUN -eq 1 ]]; then
    printf 'dry-run$ install %s (validado con visudo -cf)\n' "$dest"
    return 0
  fi
  # Un contenido vacío (fichero de origen ausente o ilegible) instalaría una regla
  # que no concede nada, y el usuario lo descubriría al fallar la VPN.
  if [[ -z "${content//[[:space:]]/}" ]]; then
    warn "no se pudo generar la regla sudoers $dest (contenido vacío)"
    SUMMARY+=("regla sudoers $dest NO instalada (no se pudo generar)")
    return 1
  fi
  local tmp
  tmp="$(mktemp)"
  printf '%s\n' "$content" > "$tmp"
  chmod 0440 "$tmp"
  if ! visudo -cf "$tmp" > /dev/null 2>&1; then
    rm -f "$tmp"
    warn "regla sudoers inválida, NO se instala $dest (sudo queda intacto)"
    SUMMARY+=("regla sudoers $dest NO instalada (falló visudo -cf)")
    return 1
  fi
  install -m 0440 "$tmp" "$dest"
  rm -f "$tmp"
}

# El usuario del servicio tiene que existir ANTES de crear los directorios TLS: el
# grupo del directorio es el suyo (el agente lee por grupo). Sin servicio
# (--no-service) no se crea, y el grupo cae a root.
ensure_service_user() {
  if ! id -u "$SERVICE_USER" > /dev/null 2>&1; then
    run useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
  fi
}

tls_group() {
  if [[ $NO_SERVICE -eq 0 ]] || id -u "$SERVICE_USER" > /dev/null 2>&1; then
    printf '%s' "$SERVICE_USER"
  else
    printf 'root'
  fi
}

# Directorios del material TLS, todos de root (ver el comentario de las constantes).
prepare_tls_dirs() {
  local with_ca="$1"
  [[ $DRY_RUN -eq 1 || "$(id -u)" -eq 0 ]] ||
    die "el material TLS se instala en /etc/krakenos y necesita root (usa sudo)"
  [[ $NO_SERVICE -eq 1 ]] || ensure_service_user
  local group
  group="$(tls_group)"
  if [[ "$group" == root ]]; then
    SUMMARY+=("sin usuario de servicio ($SERVICE_USER): el material TLS queda legible solo por root — ejecuta el agente como root o ajusta el grupo de $TLS_DIR")
  fi
  run install -d -o root -g root -m 0755 "$(dirname "$TLS_DIR")"
  run install -d -o root -g "$group" -m 0750 "$TLS_DIR"
  if [[ "$with_ca" == yes ]]; then
    run install -d -o root -g root -m 0700 "$CA_DIR"
  fi
}

# ¿`path` y TODOS sus directorios son de root y no escribibles por grupo ni otros? Si no,
# el usuario del servicio podría sustituirlo, y lo que root ejecuta no puede ser nada que
# el servicio pueda modificar.
root_owned_chain() {
  local p="$1" m
  while :; do
    [[ "$(stat -c %u "$p" 2> /dev/null)" == 0 ]] || return 1
    m="$(stat -c %a "$p" 2> /dev/null)" || return 1
    (((8#$m & 8#022) == 0)) || return 1
    [[ "$p" == / ]] && return 0
    p="$(dirname "$p")"
  done
}

# Rutas del certificado servido en el .env (absolutas, fuera del árbol de instalación).
set_tls_env_paths() {
  set_env_var HTTPS_ENABLED true
  set_env_var TLS_CERT_PATH "$TLS_DIR/agent-cert.pem"
  set_env_var TLS_KEY_PATH "$TLS_DIR/agent-key.pem"
}

# Certificado de Let's Encrypt vía Tailscale: el móvil confía sin instalar nada.
setup_tls_tailscale() {
  local fqdn
  command -v tailscale > /dev/null 2>&1 ||
    die "--tls tailscale necesita Tailscale instalado y con sesión iniciada (ver docs/remote-access.md)"
  fqdn="$(tailscale_fqdn || true)"
  # Sin FQDN no se puede emitir nada: se para en vez de dejar a medias una
  # instalación que el usuario creería con HTTPS.
  [[ -n "$fqdn" || $DRY_RUN -eq 1 ]] ||
    die "Tailscale no reporta nombre MagicDNS: haz 'tailscale up' y activa MagicDNS + HTTPS en la consola del tailnet"
  fqdn="${fqdn:-ejemplo.tailnet.ts.net}"

  prepare_tls_dirs no
  log "    emitiendo certificado para $fqdn (Let's Encrypt vía Tailscale)…"
  # root escribe en un directorio de root: el usuario del servicio no puede plantar
  # un enlace simbólico en esa ruta. Después se da lectura por grupo al servicio.
  run tailscale cert --cert-file "$TLS_DIR/agent-cert.pem" --key-file "$TLS_DIR/agent-key.pem" "$fqdn"
  run chgrp "$(tls_group)" "$TLS_DIR/agent-cert.pem" "$TLS_DIR/agent-key.pem"
  run chmod 0644 "$TLS_DIR/agent-cert.pem"
  run chmod 0640 "$TLS_DIR/agent-key.pem"

  set_tls_env_paths
  set_env_var WEB_ORIGIN "https://${fqdn}"
  install_tls_renew_timer "$fqdn"

  # Certificate Transparency: el nombre queda publicado en un registro PÚBLICO y
  # permanente. No filtra la IP ni el contenido, pero se dice — enterarse después
  # es enterarse mal.
  SUMMARY+=("TLS por Tailscale: el nombre «$fqdn» queda publicado en los registros públicos de Certificate Transparency (no tu IP ni tus datos)")
}

# Renovación: el cert de Let's Encrypt dura 90 días. `tailscale cert` es idempotente
# y solo renueva cuando toca; el agente detecta el fichero nuevo y lo aplica EN
# CALIENTE (no hace falta reiniciar el servicio). Corre como root SOLO sobre
# /etc/krakenos/tls (dir de root): ningún `chown` sobre rutas del servicio.
install_tls_renew_timer() {
  local fqdn="$1"
  [[ $NO_SERVICE -eq 1 ]] && {
    SUMMARY+=("sin systemd: el certificado NO se renovará solo — programa 'tailscale cert' cada mes")
    return 0
  }
  write_file "/etc/systemd/system/${SERVICE_NAME}-cert.service" "$(
    cat << UNIT
[Unit]
Description=Renueva el certificado TLS de KrakenOS (Tailscale)

[Service]
Type=oneshot
ExecStart=/usr/bin/env tailscale cert --cert-file ${TLS_DIR}/agent-cert.pem --key-file ${TLS_DIR}/agent-key.pem ${fqdn}
ExecStartPost=/usr/bin/env chgrp ${SERVICE_USER} ${TLS_DIR}/agent-cert.pem ${TLS_DIR}/agent-key.pem
ExecStartPost=/usr/bin/env chmod 0644 ${TLS_DIR}/agent-cert.pem
ExecStartPost=/usr/bin/env chmod 0640 ${TLS_DIR}/agent-key.pem
UNIT
  )"
  write_file "/etc/systemd/system/${SERVICE_NAME}-cert.timer" "$(
    cat << 'UNIT'
[Unit]
Description=Renovacion semanal del certificado TLS de KrakenOS

[Timer]
OnCalendar=weekly
Persistent=true

[Install]
WantedBy=timers.target
UNIT
  )"
  run systemctl daemon-reload
  run systemctl enable --now "${SERVICE_NAME}-cert.timer"
  log "    renovación automática programada (timer semanal; el agente recarga el cert sin reiniciar)"
}

# Nombre corto del equipo, saneado como en crypto/local-ca.ts (se le pasa por
# KRAKENOS_HOSTNAME para que ambos usen exactamente el mismo).
local_hostname() {
  local h
  h="$(hostname -s 2> /dev/null | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-' || true)"
  printf '%s' "${h:-krakenos}"
}

# mDNS: `<equipo>.local` solo resuelve si el servidor responde mDNS (Avahi) y el
# cliente de este equipo lo consulta (libnss-mdns). Sin él, WEB_ORIGIN y las
# passkeys apuntarían a un nombre que nadie resuelve.
# No choca con el descubrimiento del agente: éste abre su socket UDP con `bind()`
# sin puerto (efímero) y `reuseAddr` (`discovery/transport.ts`), así que no compite
# con Avahi por el 5353.
install_avahi() {
  local runlevel=()
  # Sin systemd (contenedor) el postinst intentaría arrancar el demonio y fallaría;
  # RUNLEVEL=1 hace que invoke-rc.d no lo intente.
  has_systemd || runlevel=(RUNLEVEL=1)
  if ! run env DEBIAN_FRONTEND=noninteractive "${runlevel[@]}" apt-get install -y -qq avahi-daemon libnss-mdns; then
    warn "no se pudo instalar avahi-daemon: instálalo a mano para que <equipo>.local resuelva"
    SUMMARY+=("avahi-daemon NO instalado: <equipo>.local no resolverá hasta que lo instales (apt install avahi-daemon libnss-mdns)")
    return 0
  fi
  if has_systemd && [[ $NO_SERVICE -eq 0 ]]; then
    run systemctl enable --now avahi-daemon || warn "avahi-daemon instalado pero no arrancó"
    SUMMARY+=("avahi-daemon instalado y activo: el equipo responde como <equipo>.local en la red local")
  else
    SUMMARY+=("avahi-daemon instalado pero SIN arrancar (sin systemd o con --no-service): <equipo>.local no resolverá hasta que lo inicies")
  fi
}

# CA propia de KrakenOS: el cert de servidor lo firma una CA que el dispositivo
# instala UNA vez. Sus nameConstraints la limitan a .local/localhost/rangos
# privados, así que su clave no sirve para suplantar ningún sitio de internet.
#
# Dónde vive cada cosa (root nunca ejecuta ni escribe lo que el servicio modifica):
#   · /usr/local/lib/krakenos/local-ca.js        copia de root de la CLI (y node, si el del
#                                                sistema no es de root)
#   · /etc/krakenos/ca/krakenos-ca-key.pem       clave de la CA, root 0600 en dir 0700
#   · /etc/krakenos/tls/                         root:<servicio> 0750; el agente lee
#                                                cert y clave del servidor POR GRUPO
setup_tls_local() {
  local host port
  host="$(local_hostname)"
  port="$(agent_port)"

  prepare_tls_dirs yes
  install_root_script
  run env KRAKENOS_HOSTNAME="$host" KRAKENOS_CERTS_DIR="$TLS_DIR" KRAKENOS_KEYS_DIR="$CA_DIR" \
    KRAKENOS_TLS_GROUP="$(tls_group)" "$ROOT_NODE" "$LIB_DIR/local-ca.js"

  set_tls_env_paths
  set_env_var TLS_CA_CERT_PATH "$TLS_DIR/krakenos-ca.pem"
  set_env_var WEB_ORIGIN "https://${host}.local:${port}"
  # WebAuthn exige un NOMBRE (no una IP) y que el origen coincida con el del
  # navegador; solo se fija si la plantilla del .env los contempla.
  if grep -qE '^#? *WEBAUTHN_RP_ID=' "$ENV_EXAMPLE" 2> /dev/null; then
    set_env_var WEBAUTHN_RP_ID "${host}.local"
  fi
  if grep -qE '^#? *WEBAUTHN_ORIGIN=' "$ENV_EXAMPLE" 2> /dev/null; then
    set_env_var WEBAUTHN_ORIGIN "https://${host}.local:${port}"
  fi
  install_tls_local_timer "$host"
  install_avahi

  SUMMARY+=("TLS con CA propia: cada dispositivo debe instalar UNA vez el certificado de la CA (descárgalo en https://${host}.local:${port}/api/system/ca-cert o en Ajustes → Conexión segura; en iPhone/iPad hay además que activarlo en Ajustes → General → Información → Confianza de certificados)")
  SUMMARY+=("la clave de la CA está en ${CA_DIR} (solo root); no la copies ni la compartas")
}

# Renovación del certificado de servidor (825 días): local-ca.js solo lo
# reemite cuando quedan <60 días o cambió la IP; el agente lo recarga en caliente.
# El timer ejecuta la COPIA DE ROOT de la CLI y no toca nada del árbol del servicio.
install_tls_local_timer() {
  local host="$1"
  [[ $NO_SERVICE -eq 1 ]] && {
    SUMMARY+=("sin systemd: el certificado local NO se renovará solo — ejecuta «node ${LIB_DIR}/local-ca.js» (con KRAKENOS_CERTS_DIR/KRAKENOS_KEYS_DIR) antes de que caduque")
    return 0
  }
  write_file "/etc/systemd/system/${SERVICE_NAME}-cert-local.service" "$(
    cat << UNIT
[Unit]
Description=Renueva el certificado TLS local de KrakenOS (CA propia)

[Service]
Type=oneshot
Environment=KRAKENOS_HOSTNAME=${host}
Environment=KRAKENOS_CERTS_DIR=${TLS_DIR}
Environment=KRAKENOS_KEYS_DIR=${CA_DIR}
Environment=KRAKENOS_TLS_GROUP=${SERVICE_USER}
ExecStart=${ROOT_NODE} ${LIB_DIR}/local-ca.js
UNIT
  )"
  write_file "/etc/systemd/system/${SERVICE_NAME}-cert-local.timer" "$(
    cat << 'UNIT'
[Unit]
Description=Comprobacion mensual del certificado TLS local de KrakenOS

[Timer]
OnCalendar=monthly
Persistent=true

[Install]
WantedBy=timers.target
UNIT
  )"
  run systemctl daemon-reload
  run systemctl enable --now "${SERVICE_NAME}-cert-local.timer"
  log "    renovación automática programada (timer mensual; el agente recarga el cert sin reiniciar)"
}

# `auto`: Tailscale si está listo (el móvil confía sin instalar nada); si no, la
# CA local. Se resuelve a un modo concreto y se dice cuál y por qué.
resolve_tls_mode() {
  [[ "$TLS_MODE" == auto ]] || return 0
  if command -v tailscale > /dev/null 2>&1 && [[ -n "$(tailscale_fqdn || true)" ]]; then
    TLS_MODE=tailscale
    log "    --tls auto → tailscale (Tailscale instalado, con sesión y MagicDNS)"
    SUMMARY+=("TLS automático: se eligió «tailscale» porque Tailscale está instalado y con sesión")
  else
    TLS_MODE=local
    log "    --tls auto → local (no hay Tailscale con sesión y MagicDNS)"
    SUMMARY+=("TLS automático: se eligió «local» porque no hay Tailscale instalado y con sesión")
  fi
}

setup_tls() {
  log "TLS (US-241)…"
  resolve_tls_mode
  case "$TLS_MODE" in
    tailscale) setup_tls_tailscale ;;
    local) setup_tls_local ;;
    none)
      SUMMARY+=("sin HTTPS → NO funcionan la app instalable (PWA), los avisos push ni las passkeys: el navegador exige contexto seguro (reinstala sin --tls none)")
      ;;
  esac
}

# ¿Es un origen en el que se puede confiar? Fichero normal (ni enlace simbólico),
# con UN solo enlace duro (un enlace duro a /etc/shadow pasa `-f` y `! -L`; solo
# `fs.protected_hardlinks` lo impide, y no es una garantía) y propiedad del usuario
# del servicio o de root.
tls_source_ok() {
  local src="$1" owner
  [[ -f "$src" && ! -L "$src" ]] || return 1
  [[ "$(stat -c %h "$src" 2> /dev/null)" == 1 ]] || return 1
  owner="$(stat -c %U "$src" 2> /dev/null)"
  [[ "$owner" == "$SERVICE_USER" || "$owner" == root ]]
}

# Copia un fichero del árbol del servicio al directorio TLS de root SIN seguir
# enlaces: el origen es del usuario del servicio, así que un enlace (simbólico o
# duro) a /etc/shadow no puede convertirse en un fichero legible por él. Devuelve 1
# si el origen no es de fiar o cambió durante la copia.
copy_tls_file() {
  local src="$1" dst="$2" mode="$3"
  tls_source_ok "$src" || {
    warn "$src no es un fichero normal del servicio (enlace simbólico, enlace duro u otro propietario): se omite"
    return 1
  }
  # `cp -P` copia el enlace como enlace si lo fuera (carrera entre la comprobación
  # y la copia); el destino se revalida ya dentro del directorio de root.
  run cp -P --no-preserve=all "$src" "$dst.nuevo"
  if [[ $DRY_RUN -eq 0 && ( -L "$dst.nuevo" || ! -f "$dst.nuevo" ) ]]; then
    rm -f "$dst.nuevo"
    warn "$src cambió durante la copia (¿enlace simbólico?): se omite"
    return 1
  fi
  run chgrp "$(tls_group)" "$dst.nuevo"
  run chmod "$mode" "$dst.nuevo"
  run mv -f "$dst.nuevo" "$dst"
  run rm -f "$src"
}
