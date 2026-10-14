#!/usr/bin/env bash
#
# KrakenOS — instalador nativo de un comando (US-216).
#
#   curl -fsSL https://raw.githubusercontent.com/Flores-rivera-24/krakenos/main/scripts/install.sh | sudo bash
#
# Idempotente: re-ejecutarlo actualiza el código sin tocar tu configuración
# (.env, keys/, data/ y la base de datos se conservan siempre).
#
# Uso:
#   install.sh [opciones]              instala (o re-instala) KrakenOS
#   install.sh --update                actualiza vía el orquestador con rollback (US-190)
#   install.sh --uninstall [--purge]   desinstala el servicio (conserva los datos salvo --purge)
#
# Opciones:
#   --yes            no pregunta (con los extras se decide por banderas, no por prompt)
#   --dry-run        imprime el plan sin ejecutar nada que mute el sistema
#   --dir DIR        directorio de instalación (por defecto /opt/krakenos)
#   --from-local P   instala desde una copia local del repo en vez de clonar (CI/dev)
#   --branch REF     rama/tag a instalar (por defecto: la última etiqueta v*, o main)
#   --no-service     no crea la unidad systemd (contenedores/CI; arranque manual)
#
# Extras (OPT-IN explícito; sin bandera no se instalan y se avisa al final):
#   --with-helper    helper privilegiado + sudoers → VPN WireGuard, firewall, QoS
#   --with-ffmpeg    ffmpeg → cámaras RTSP (vídeo en vivo, movimiento, grabación)
#   --with-deps      deps opcionales de integraciones (node-ssh, mqtt, net-snmp, ws)
#   --with-all       las tres anteriores
#
# TLS (US-241) — sin HTTPS el navegador no da «contexto seguro» y se caen la app
# instalable (PWA), los avisos push y las passkeys. Por eso HTTPS es el DEFECTO:
#   --tls auto       (por defecto) tailscale si Tailscale está instalado y con
#                    sesión + MagicDNS; si no, local
#   --tls tailscale  certificado de Let's Encrypt vía Tailscale para *.ts.net
#                    (el móvil confía sin instalar nada) + renovación por timer
#   --tls local      CA propia de KrakenOS (limitada por nameConstraints a .local,
#                    localhost y rangos privados) + certificado de servidor para
#                    <equipo>.local, krakenos.local, localhost y la IP de la LAN.
#                    Cada dispositivo instala el certificado de la CA UNA vez
#                    (GET /api/system/ca-cert o Ajustes → Conexión segura)
#   --tls self       OBSOLETO: alias de local
#   --tls none       HTTP plano, solo si se pide expresamente; se avisa de lo que pierdes
#
# El material TLS vive en /etc/krakenos (CA en ca/, 0700 root; lo servido en tls/,
# root:<servicio> 0750, que el agente lee por grupo) y el script de renovación se
# ejecuta desde una copia de root en /usr/local/lib/krakenos: root nunca ejecuta ni
# escribe nada que el servicio pueda modificar.
#
# En `curl | sudo bash` stdin ES la tubería, así que no hay TTY para preguntar: por
# eso los extras se piden por bandera. Antes se «ofrecían» y siempre salían que no,
# dejando la instalación sin cámaras ni VPN en silencio (AUD3-23).
#
# Variables (tests/CI): KRAKENOS_REPO · KRAKENOS_INSTALL_DIR · KRAKENOS_SERVICE_NAME ·
#   KRAKENOS_SERVICE_USER · KRAKENOS_OS_ID · KRAKENOS_ARCH · KRAKENOS_MIN_RAM_MB ·
#   KRAKENOS_MIN_DISK_MB · KRAKENOS_SKIP_CHECKS=1
set -euo pipefail

# ---------------------------------------------------------------- configuración
REPO="${KRAKENOS_REPO:-Flores-rivera-24/krakenos}"
INSTALL_DIR="${KRAKENOS_INSTALL_DIR:-/opt/krakenos}"
SERVICE_NAME="${KRAKENOS_SERVICE_NAME:-krakenos}"
SERVICE_USER="${KRAKENOS_SERVICE_USER:-krakenos}"
# Material TLS FUERA del árbol de instalación. Todo lo que `root` ejecuta o escribe
# (los timers de renovación, la clave de la CA, el script que emite certificados)
# vive donde el usuario del servicio NO puede modificarlo: el árbol de instalación
# es suyo (`chown -R`), así que un agente comprometido podría cambiar ahí el script
# que root ejecutaría al mes siguiente, o plantar un enlace simbólico que un `chown`
# de root seguiría.
CA_DIR="${KRAKENOS_CA_DIR:-/etc/krakenos/ca}"         # root:root 0700 — clave de la CA
TLS_DIR="${KRAKENOS_TLS_DIR:-/etc/krakenos/tls}"      # root:<servicio> 0750 — lo que se sirve
LIB_DIR="${KRAKENOS_LIB_DIR:-/usr/local/lib/krakenos}" # root:root 0755 — copia de root del script
PNPM_VERSION="9.12.0" # pinneado = packageManager del repo (patrón AUD-27: sin descargas en runtime)
NODE_MAJOR=24
MIN_RAM_MB="${KRAKENOS_MIN_RAM_MB:-900}"
MIN_DISK_MB="${KRAKENOS_MIN_DISK_MB:-2000}"

MODE=install
DRY_RUN=0
ASSUME_YES=0
NO_SERVICE=0
NO_SYSTEMD=0
PURGE=0
FROM_LOCAL=""
BRANCH=""
WITH_HELPER=0
WITH_FFMPEG=0
WITH_DEPS=0
TLS_MODE=auto
# Resumen final: lo que quedó desactivado se dice en voz alta, no en silencio.
SUMMARY=()

# Los secretos que se generan aquí (.env, claves RS256, credenciales en data/) no
# deben nacer legibles por todo el sistema: root instala con umask 022 y el
# `chown -R` posterior NO cambia el modo (AUD3-06).
umask 077

log() { printf '==> %s\n' "$*"; }
warn() { printf 'AVISO: %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# Ejecuta el comando, o lo imprime como plan con --dry-run. Todo lo que MUTA el
# sistema pasa por aquí; las comprobaciones de solo-lectura corren siempre.
run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    printf 'dry-run$ %s\n' "$*"
  else
    "$@"
  fi
}

# ¿Hay un checkout de git EN este directorio (no en un padre)?
#
# Se comprobaba con `[[ -d "$dir/.git" ]]`, y eso solo es cierto en un clon
# normal: en un **worktree** de git —y en un clon con `--separate-git-dir`—
# `.git` es un **fichero** de texto que apunta al repo real. Con la comprobación
# vieja, `--update` moría con «no hay una instalación git» sobre una instalación
# perfectamente válida, y `fetch_source` se iba a la rama del `git clone` sobre
# un directorio no vacío (que falla).
#
# `-e` acepta fichero o directorio y, a la vez, exige que el marcador esté
# **aquí**: descarta un subdirectorio cualquiera de un repo padre, que es lo que
# dejaría pasar un `rev-parse` a secas. El `rev-parse` confirma que git lo
# reconoce de verdad (un `.git` suelto y basura no cuela).
is_git_checkout() {
  [[ -e "$1/.git" ]] && git -C "$1" rev-parse --is-inside-work-tree > /dev/null 2>&1
}

# Pregunta sí/no (por defecto NO). Solo se usa para confirmaciones DESTRUCTIVAS
# (--purge): los extras van por bandera, porque en `curl | sudo bash` no hay TTY y
# esto siempre respondía que no en silencio (AUD3-23).
confirm() {
  local prompt="$1"
  if [[ $ASSUME_YES -eq 1 || ! -t 0 ]]; then return 1; fi
  local answer=""
  read -r -p "$prompt [s/N] " answer
  [[ "$answer" == "s" || "$answer" == "S" ]]
}

usage() { sed -n '3,31p' "$0" 2>/dev/null || true; }

# ---------------------------------------------------------------- argumentos
parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --yes | -y) ASSUME_YES=1 ;;
      --dry-run) DRY_RUN=1 ;;
      --dir)
        [[ $# -ge 2 ]] || die "--dir necesita un valor"
        INSTALL_DIR="$2"
        shift
        ;;
      --from-local)
        [[ $# -ge 2 ]] || die "--from-local necesita una ruta"
        FROM_LOCAL="$2"
        shift
        ;;
      --branch)
        [[ $# -ge 2 ]] || die "--branch necesita un valor"
        BRANCH="$2"
        shift
        ;;
      --no-service) NO_SERVICE=1 ;;
      --tls)
        [[ $# -ge 2 ]] || die "--tls necesita un valor: auto | tailscale | local | none"
        case "$2" in
          auto | tailscale | local | none) TLS_MODE="$2" ;;
          self)
            warn "--tls self está obsoleto: ahora es un alias de --tls local (CA propia en vez de un autofirmado suelto)"
            TLS_MODE=local
            ;;
          *) die "--tls admite auto | tailscale | local | none (recibido: $2)" ;;
        esac
        shift
        ;;
      --with-helper) WITH_HELPER=1 ;;
      --with-ffmpeg) WITH_FFMPEG=1 ;;
      --with-deps) WITH_DEPS=1 ;;
      --with-all)
        WITH_HELPER=1
        WITH_FFMPEG=1
        WITH_DEPS=1
        ;;
      --update) MODE=update ;;
      --uninstall) MODE=uninstall ;;
      --purge) PURGE=1 ;;
      --help | -h)
        usage
        exit 0
        ;;
      *) die "opción desconocida: $1 (usa --help)" ;;
    esac
    shift
  done
}

# ---------------------------------------------------------------- comprobaciones
# Las rutas se interpolan en `bash -c '…'`: se RECHAZAN (no se sanean) las que
# romperían el quoting o el unit de systemd (comillas, control, espacios raros).
validate_paths() {
  local p
  for p in "$INSTALL_DIR" "$FROM_LOCAL"; do
    [[ -z "$p" ]] && continue
    case "$p" in
      *"'"* | *'"'* | *'$'* | *'`'* | *$'\n'* | *$'\t'* | *" "*)
        die "ruta no válida ('$p'): sin espacios, comillas ni metacaracteres"
        ;;
      /*) ;;
      *) die "ruta no válida ('$p'): debe ser absoluta" ;;
    esac
  done
}

check_platform() {
  [[ "${KRAKENOS_SKIP_CHECKS:-0}" == "1" ]] && return 0

  local os_id="${KRAKENOS_OS_ID:-}"
  if [[ -z "$os_id" && -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    os_id="$(. /etc/os-release && printf '%s %s' "${ID:-}" "${ID_LIKE:-}")"
  fi
  case " $os_id " in
    *" debian "* | *" ubuntu "* | *" raspbian "*) ;;
    *) die "SO no soportado por el instalador ('$os_id'): necesita Debian/Ubuntu/Raspberry Pi OS. En otros sistemas, sigue el README (instalación manual)." ;;
  esac

  local arch="${KRAKENOS_ARCH:-$(uname -m)}"
  case "$arch" in
    x86_64 | amd64 | aarch64 | arm64) ;;
    *) die "arquitectura no soportada: $arch (necesita x86-64 o ARM64; una Pi de 32 bits no alcanza)" ;;
  esac

  local ram_mb
  ram_mb=$(awk '/MemTotal/ { printf "%d", $2 / 1024 }' /proc/meminfo 2>/dev/null || echo 0)
  if [[ "$ram_mb" -gt 0 && "$ram_mb" -lt "$MIN_RAM_MB" ]]; then
    die "RAM insuficiente: ${ram_mb} MB (mínimo ~${MIN_RAM_MB} MB)"
  fi

  local disk_target="$INSTALL_DIR"
  [[ -d "$disk_target" ]] || disk_target="$(dirname "$INSTALL_DIR")"
  local disk_mb
  disk_mb=$(df -Pm "$disk_target" 2>/dev/null | awk 'NR==2 { print $4 }' || echo 0)
  if [[ "$disk_mb" -gt 0 && "$disk_mb" -lt "$MIN_DISK_MB" ]]; then
    die "disco insuficiente en $disk_target: ${disk_mb} MB libres (mínimo ~${MIN_DISK_MB} MB)"
  fi

  log "Plataforma OK (arch $arch · RAM ${ram_mb} MB · disco ${disk_mb} MB libres)"
}

require_root() {
  # Instalar Node, crear el usuario de servicio y la unidad exigen root. Con
  # --no-service (contenedor/CI ya-root o dir propio) basta poder escribir.
  if [[ $DRY_RUN -eq 1 ]]; then return 0; fi
  if [[ "$(id -u)" -ne 0 && $NO_SERVICE -eq 0 ]]; then
    die "ejecútalo como root (sudo): instala paquetes y crea el servicio systemd"
  fi
}

# ---------------------------------------------------------------- dependencias
ensure_base_packages() {
  log "[1/7] Paquetes base (git, curl, openssl)…"
  if ! command -v git > /dev/null || ! command -v curl > /dev/null || ! command -v openssl > /dev/null; then
    run apt-get update -qq
    run apt-get install -y -qq git curl ca-certificates openssl
  fi
}

node_major_installed() {
  command -v node > /dev/null || return 1
  local v
  v="$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
  [[ -n "$v" && "$v" -ge $NODE_MAJOR ]]
}

ensure_node() {
  log "[2/7] Node.js ≥ ${NODE_MAJOR}…"
  if node_major_installed; then
    log "    Node $(node --version) ya presente"
  else
    # `set -o pipefail` DENTRO del bash -c: el `set -euo pipefail` de arriba no se
    # hereda en el subshell, así que un fallo de NodeSource quedaba enmascarado por
    # el éxito de `bash -` y la instalación seguía con el Node 18 de Debian (AUD3-23).
    run bash -c "set -o pipefail; curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -"
    run apt-get install -y -qq nodejs
    if [[ $DRY_RUN -eq 0 ]] && ! node_major_installed; then
      die "no se pudo instalar Node ${NODE_MAJOR} (NodeSource falló). Instálalo a mano y reintenta."
    fi
  fi
}

ensure_pnpm() {
  log "[3/7] pnpm ${PNPM_VERSION} (corepack pinneado)…"
  run corepack enable
  # `prepare --activate` deja pnpm cacheado: el primer arranque no descarga nada (AUD-27).
  run corepack prepare "pnpm@${PNPM_VERSION}" --activate
}

# ---------------------------------------------------------------- código fuente
resolve_ref() {
  # La última etiqueta v* del repo remoto; sin etiquetas → main. --branch la fija.
  if [[ -n "$BRANCH" ]]; then
    printf '%s' "$BRANCH"
    return
  fi
  local tag=""
  tag="$(git -C "$INSTALL_DIR" tag -l 'v*' --sort=-v:refname 2>/dev/null | head -1 || true)"
  printf '%s' "${tag:-main}"
}

fetch_source() {
  log "[4/7] Código fuente en $INSTALL_DIR…"
  if [[ -n "$FROM_LOCAL" ]]; then
    [[ -d "$FROM_LOCAL" ]] || die "--from-local: no existe $FROM_LOCAL"
    run mkdir -p "$INSTALL_DIR"
    # Copia local (CI/dev): el árbol sin artefactos NI secretos del origen —
    # la instalación genera su propio .env/keys y no hereda estado (data/var).
    run bash -c "tar -C '$FROM_LOCAL' --exclude=node_modules --exclude=.git --exclude='*.db' --exclude=.env --exclude=keys --exclude=data --exclude=var -cf - . | tar -C '$INSTALL_DIR' -xf -"
    return
  fi
  if is_git_checkout "$INSTALL_DIR"; then
    # Idempotente: repo ya clonado → traer y posicionarse; .env/keys/data son
    # untracked y git no los toca.
    run git -C "$INSTALL_DIR" fetch --tags --prune origin
    local ref
    ref="$(resolve_ref)"
    log "    actualizando a $ref"
    run git -C "$INSTALL_DIR" checkout --quiet "$ref"
    if [[ "$ref" == "main" ]]; then run git -C "$INSTALL_DIR" pull --ff-only origin main; fi
  else
    run git clone --quiet "https://github.com/${REPO}.git" "$INSTALL_DIR"
    local ref
    ref="$(resolve_ref)"
    log "    instalando $ref"
    run git -C "$INSTALL_DIR" checkout --quiet "$ref"
  fi
}

# ---------------------------------------------------------------- build + config
build_and_configure() {
  log "[5/7] Configuración, base de datos y build…"
  local agent="$INSTALL_DIR/apps/agent"
  if [[ ! -f "$agent/.env" ]]; then
    run cp "$agent/.env.example" "$agent/.env"
    log "    .env creado desde .env.example (todo arranca en modo mock)"
  fi
  if [[ ! -f "$agent/keys/jwt-private.pem" ]]; then
    run bash "$agent/scripts/gen-keys.sh"
  fi
  # Comprobación de actualizaciones (US-116) activa en una instalación real: sin
  # esto no hay releases → 0 tags → el update one-click no puede funcionar y toda
  # instalación corre la punta de `main` (AUD3-20). En dev sigue apagada: la línea
  # de `.env.example` está comentada y solo el instalador la activa.
  if [[ $DRY_RUN -eq 0 ]] && ! grep -q '^UPDATE_CHECK_REPO=' "$agent/.env" 2>/dev/null; then
    printf 'UPDATE_CHECK_REPO=%s\n' "$REPO" >> "$agent/.env"
    log "    UPDATE_CHECK_REPO=$REPO (comprobación de actualizaciones activada)"
  elif [[ $DRY_RUN -eq 1 ]]; then
    printf 'dry-run$ añadir UPDATE_CHECK_REPO=%s a %s\n' "$REPO" "$agent/.env"
  fi
  run bash -c "cd '$INSTALL_DIR' && pnpm install --frozen-lockfile"
  run bash -c "cd '$INSTALL_DIR' && pnpm --filter @krakenos/agent exec prisma generate"
  run bash -c "cd '$INSTALL_DIR' && pnpm --filter @krakenos/agent exec prisma migrate deploy"
  run bash -c "cd '$INSTALL_DIR' && pnpm build"
}

# Puerto real del agente (respeta PORT del .env; por defecto 3001).
agent_port() {
  local env_file="$INSTALL_DIR/apps/agent/.env" port=""
  if [[ -r "$env_file" ]]; then
    port="$(sed -n 's/^PORT=\([0-9]\{1,5\}\).*/\1/p' "$env_file" | tail -1)"
  fi
  printf '%s' "${port:-3001}"
}

# Los secretos no deben quedar legibles por cualquier cuenta del sistema (AUD3-06).
# `umask 077` cubre lo que se crea AHORA; esto además repara una instalación previa
# hecha con la versión antigua del instalador (el `chown -R` no cambia el modo).
harden_permissions() {
  local agent="$INSTALL_DIR/apps/agent" d
  log "    Permisos de secretos (600 .env · 700 keys/ y data/)…"
  if [[ $DRY_RUN -eq 1 ]]; then
    # El plan se imprime completo aunque los ficheros aún no existan.
    printf 'dry-run$ chmod 600 %s/.env\n' "$agent"
    printf 'dry-run$ chmod 700 %s/keys %s/data %s/var\n' "$agent" "$agent" "$agent"
    printf 'dry-run$ chmod 600 %s/keys/* %s/prisma/*.db\n' "$agent" "$agent"
    return 0
  fi
  [[ -f "$agent/.env" ]] && chmod 600 "$agent/.env"
  for d in "$agent/keys" "$agent/data" "$agent/var"; do
    [[ -d "$d" ]] && chmod 700 "$d"
  done
  find "$agent/keys" -type f -exec chmod 600 {} + 2> /dev/null || true
  find "$agent/prisma" -maxdepth 1 -name '*.db*' -exec chmod 600 {} + 2> /dev/null || true
}

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

# ---------------------------------------------------------------- servicio
install_service() {
  if [[ $NO_SERVICE -eq 1 ]]; then
    if [[ $NO_SYSTEMD -eq 1 ]]; then
      log "[6/7] Servicio systemd omitido (este sistema no tiene systemd). Arranque manual:"
    else
      log "[6/7] Servicio systemd omitido (--no-service). Arranque manual:"
    fi
    log "    cd $INSTALL_DIR/apps/agent && NODE_ENV=production node dist/index.js"
    return
  fi
  log "[6/7] Servicio systemd ($SERVICE_NAME)…"
  ensure_service_user
  run chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
  local unit="/etc/systemd/system/${SERVICE_NAME}.service"
  local node_bin
  node_bin="$(command -v node || echo /usr/bin/node)"
  if [[ $DRY_RUN -eq 1 ]]; then
    printf 'dry-run$ write %s (User=%s, WorkingDirectory=%s/apps/agent)\n' "$unit" "$SERVICE_USER" "$INSTALL_DIR"
  else
    cat > "$unit" <<UNIT
[Unit]
Description=KrakenOS — Home Control
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR/apps/agent
Environment=NODE_ENV=production
ExecStart=$node_bin $INSTALL_DIR/apps/agent/dist/index.js
Restart=on-failure
RestartSec=5
# Imprescindible para la actualización one-click (US-232): el actualizador es un
# hijo del agente y el paso 'restart' reinicia esta unidad. Con el KillMode por
# defecto (control-group) systemd lo mataría a mitad de su propia secuencia y
# nunca habría healthcheck ni rollback.
KillMode=process
NoNewPrivileges=false
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT
  fi
  # Regla sudoers de la actualización one-click (US-190/US-232): el paso `restart`
  # reinicia ESTA unidad y el agente no corre como root. Se instalaba **comentada**
  # en el ejemplo, así que el update fallaba siempre en el último paso (AUD3-20).
  # Ámbito mínimo: reiniciar esa unidad concreta, nada más.
  local systemctl_bin
  systemctl_bin="$(command -v systemctl || echo /usr/bin/systemctl)"
  if install_sudoers "/etc/sudoers.d/krakenos-update" \
    "# KrakenOS — actualización one-click (US-232). Generado por install.sh.
# Ámbito mínimo: reiniciar SOLO la unidad del agente. Sin esto, el paso 'restart'
# del actualizador falla y la actualización se revierte.
$SERVICE_USER ALL=(root) NOPASSWD: $systemctl_bin restart $SERVICE_NAME
$SERVICE_USER ALL=(root) NOPASSWD: $systemctl_bin stop $SERVICE_NAME
$SERVICE_USER ALL=(root) NOPASSWD: $systemctl_bin start $SERVICE_NAME"; then
    log "    sudoers de actualización instalado (restart/stop/start de $SERVICE_NAME)"
  fi

  run systemctl daemon-reload
  run systemctl enable --now "$SERVICE_NAME"
  # No basta con que `enable --now` devuelva 0: si el agente se cae al arrancar
  # (puerto ocupado, .env inválido) la unidad queda en 'failed' y el instalador
  # decía "Listo" igualmente.
  if [[ $DRY_RUN -eq 0 ]]; then
    for _ in $(seq 1 20); do
      systemctl is-active --quiet "$SERVICE_NAME" && break
      sleep 1
    done
    if ! systemctl is-active --quiet "$SERVICE_NAME"; then
      warn "el servicio $SERVICE_NAME no está activo. Revisa: journalctl -u $SERVICE_NAME -n 50"
      SUMMARY+=("servicio $SERVICE_NAME NO activo — revisa el journal")
    fi
  fi
}

print_setup_url() {
  log "[7/7] Primer acceso…"
  if [[ $DRY_RUN -eq 1 || $NO_SERVICE -eq 1 ]]; then
    log "    Al primer arranque sin usuarios, el agente imprime la URL de /setup?token= con QR."
    return
  fi
  # Espera al readiness y saca del journal la URL de configuración (AUD-26:
  # el agente la imprime por stdout, legible en journald). El puerto sale del .env:
  # con PORT distinto de 3001 esto sondeaba un puerto que nadie escucha.
  local port scheme=http
  port="$(agent_port)"
  [[ "$TLS_MODE" == none ]] || scheme=https
  # `_` en vez de `i`: la variable no se usa dentro del bucle (shellcheck SC2034).
  for _ in $(seq 1 30); do
    # Con HTTPS el agente no habla HTTP en ese puerto; -k es aceptable SOLO porque
    # es el bucle local (127.0.0.1) y únicamente mira si el servicio está vivo.
    if curl -fsSk "${scheme}://127.0.0.1:${port}/health/ready" > /dev/null 2>&1; then break; fi
    sleep 1
  done
  local setup_lines
  setup_lines="$(journalctl -u "$SERVICE_NAME" --no-pager 2>/dev/null | grep -F '/setup?token=' | tail -1 || true)"
  if [[ -n "$setup_lines" ]]; then
    printf '\n────────────────────────────────────────────────────────\n'
    printf 'KrakenOS está corriendo. Crea el administrador aquí:\n  %s\n' "${setup_lines#*] }"
    printf 'El QR completo está en:  journalctl -u %s | less\n' "$SERVICE_NAME"
    printf '────────────────────────────────────────────────────────\n\n'
  else
    log "    Servicio arrancado. Si es la primera instalación, la URL de /setup está en: journalctl -u $SERVICE_NAME"
  fi
}


# Escribe un fichero completo respetando --dry-run (mismo patrón que la unidad
# systemd: en plan solo se anuncia).
write_file() {
  local path="$1" content="$2"
  if [[ $DRY_RUN -eq 1 ]]; then
    printf 'dry-run$ write %s\n' "$path"
    # El contenido también: es lo que root va a ejecutar, y un plan que lo calla no
    # se puede revisar (ni probar).
    printf '%s\n' "$content" | sed 's/^/dry-run>   /'
    return 0
  fi
  printf '%s\n' "$content" > "$path"
}

# ---------------------------------------------------------------- TLS (US-241)
# Sin HTTPS el navegador no considera «seguro» el origen y se caen tres cosas ya
# entregadas: la app instalable (service worker), los avisos push y las passkeys.
# No es una mejora estética: es el flujo diario en el móvil.

# Escribe (o reemplaza) una clave en el .env del agente.
set_env_var() {
  local key="$1" value="$2" env_file="$INSTALL_DIR/apps/agent/.env"
  if [[ $DRY_RUN -eq 1 ]]; then
    printf 'dry-run$ %s=%s en %s\n' "$key" "$value" "$env_file"
    return 0
  fi
  if grep -q "^${key}=" "$env_file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$env_file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$env_file"
  fi
}

# Nombre MagicDNS de esta máquina, leído de la propia CLI de Tailscale.
tailscale_fqdn() {
  tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName": *"\([^"]*\)\..*/\1/p' | head -1
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

# Copia de root del script que emite certificados: el timer (root) ejecuta ESTA, no
# la del árbol de instalación, que es del usuario del servicio.
install_root_script() {
  local agent="$INSTALL_DIR/apps/agent"
  run install -d -o root -g root -m 0755 "$LIB_DIR"
  run install -o root -g root -m 0755 "$agent/scripts/gen-local-ca.sh" "$LIB_DIR/gen-local-ca.sh"
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

# Nombre corto del equipo, saneado como en gen-local-ca.sh (se le pasa por
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
#   · /usr/local/lib/krakenos/gen-local-ca.sh   copia de root del script
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
    KRAKENOS_TLS_GROUP="$(tls_group)" bash "$LIB_DIR/gen-local-ca.sh"

  set_tls_env_paths
  set_env_var TLS_CA_CERT_PATH "$TLS_DIR/krakenos-ca.pem"
  set_env_var WEB_ORIGIN "https://${host}.local:${port}"
  # WebAuthn exige un NOMBRE (no una IP) y que el origen coincida con el del
  # navegador; solo se fija si la plantilla del .env los contempla.
  local agent="$INSTALL_DIR/apps/agent"
  if grep -qE '^#? *WEBAUTHN_RP_ID=' "$agent/.env.example" 2> /dev/null; then
    set_env_var WEBAUTHN_RP_ID "${host}.local"
  fi
  if grep -qE '^#? *WEBAUTHN_ORIGIN=' "$agent/.env.example" 2> /dev/null; then
    set_env_var WEBAUTHN_ORIGIN "https://${host}.local:${port}"
  fi
  install_tls_local_timer "$host"
  install_avahi

  SUMMARY+=("TLS con CA propia: cada dispositivo debe instalar UNA vez el certificado de la CA (descárgalo en https://${host}.local:${port}/api/system/ca-cert o en Ajustes → Conexión segura; en iPhone/iPad hay además que activarlo en Ajustes → General → Información → Confianza de certificados)")
  SUMMARY+=("la clave de la CA está en ${CA_DIR} (solo root); no la copies ni la compartas")
}

# Renovación del certificado de servidor (825 días): gen-local-ca.sh solo lo
# reemite cuando quedan <60 días o cambió la IP; el agente lo recarga en caliente.
# El timer ejecuta la COPIA DE ROOT del script y no toca nada del árbol del servicio.
install_tls_local_timer() {
  local host="$1"
  [[ $NO_SERVICE -eq 1 ]] && {
    SUMMARY+=("sin systemd: el certificado local NO se renovará solo — ejecuta ${LIB_DIR}/gen-local-ca.sh (con KRAKENOS_CERTS_DIR/KRAKENOS_KEYS_DIR) antes de que caduque")
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
ExecStart=/usr/bin/env bash ${LIB_DIR}/gen-local-ca.sh
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

# Migración (--update) de quien instaló antes con el material TLS en
# apps/agent/certs: se mueve a /etc/krakenos/tls, se reescriben las rutas del .env,
# se refresca la copia de root del script y se reinstalan las unidades de los timers
# SIN `ExecStartPost=chown` (root hacía chown, siguiendo enlaces, sobre rutas que el
# servicio controlaba).
#
# Riesgo ACEPTADO (docs/threat-model.md §9.3): el código instalado es del usuario del
# servicio (lo exige la actualización con un clic), así que ejecutar ESTE instalador
# como root ejecuta código que el servicio pudo modificar. Lo automático ya no lo
# hace —el timer usa la copia de root y el servicio no puede invocar el instalador
# por sudo—; al actualizar a mano, el administrador confía en el árbol, como antes.
refresh_tls_after_update() {
  local agent="$INSTALL_DIR/apps/agent" old migrated=0 f
  old="$agent/certs"
  local unit_dir=/etc/systemd/system

  if [[ -f "$old/agent-cert.pem" && ! -f "$TLS_DIR/agent-cert.pem" ]]; then
    log "TLS: migrando el certificado de $old a $TLS_DIR…"
    prepare_tls_dirs no
    # Los dos ficheros normales (ni enlaces) ANTES de tocar nada: mover solo uno
    # dejaría el par partido entre dos rutas.
    if tls_source_ok "$old/agent-cert.pem" && tls_source_ok "$old/agent-key.pem" &&
      copy_tls_file "$old/agent-cert.pem" "$TLS_DIR/agent-cert.pem" 0644 &&
      copy_tls_file "$old/agent-key.pem" "$TLS_DIR/agent-key.pem" 0640; then
      # Si venía de una CA local anterior, el certificado público la acompaña.
      copy_tls_file "$old/krakenos-ca.pem" "$TLS_DIR/krakenos-ca.pem" 0644 || true
      set_tls_env_paths
      if [[ -f "$TLS_DIR/krakenos-ca.pem" || $DRY_RUN -eq 1 ]] && grep -q '^TLS_CA_CERT_PATH=' "$agent/.env" 2> /dev/null; then
        set_env_var TLS_CA_CERT_PATH "$TLS_DIR/krakenos-ca.pem"
      fi
      migrated=1
      SUMMARY+=("TLS migrado: el certificado y la clave pasaron de $old a $TLS_DIR (la clave deja de estar en el árbol del servicio)")
    else
      warn "no se pudo migrar el certificado de $old (¿faltan ficheros o son enlaces?)"
      SUMMARY+=("TLS NO migrado: revisa $old — el certificado sigue en la ruta antigua")
    fi
  fi

  # Unidades: se reinstalan SIEMPRE que existan, para quitar la versión antigua.
  if [[ -f "$unit_dir/${SERVICE_NAME}-cert.timer" || $migrated -eq 1 && $DRY_RUN -eq 1 ]]; then
    local fqdn
    fqdn="$(tailscale_fqdn || true)"
    if [[ -n "$fqdn" ]]; then
      prepare_tls_dirs no
      install_tls_renew_timer "$fqdn"
      SUMMARY+=("timer de renovación de Tailscale reinstalado sin ExecStartPost=chown")
    else
      warn "no se pudo leer el nombre MagicDNS: el timer de Tailscale se deja como estaba"
    fi
  fi
  if [[ -f "$unit_dir/${SERVICE_NAME}-cert-local.timer" ]]; then
    f="$(sed -n 's/^Environment=KRAKENOS_HOSTNAME=//p' "$unit_dir/${SERVICE_NAME}-cert-local.service" 2> /dev/null | head -1)"
    install_root_script
    install_tls_local_timer "${f:-$(local_hostname)}"
    SUMMARY+=("copia de root de gen-local-ca.sh refrescada en $LIB_DIR")
  fi
}

# ---------------------------------------------------------------- extras opt-in
# Deps opcionales de integraciones: no están en package.json (CI con lockfile
# congelado) y se cargan con import perezoso. Se anotan en data/extra-deps.json
# para que el actualizador las reinstale (US-232): `pnpm install --frozen-lockfile`
# las poda en cada update y el usuario perdía su hardware sin ningún aviso (AUD3-22).
EXTRA_DEPS=(node-ssh mqtt net-snmp ws)

install_extras() {
  log "Extras (opt-in por bandera)…"
  if [[ $WITH_HELPER -eq 1 ]]; then
    run install -m 0755 "$INSTALL_DIR/apps/agent/scripts/krakenos-helper.sh" /usr/local/bin/krakenos-helper
    install_sudoers "/etc/sudoers.d/krakenos" "$(sed 's/^krakenos ALL=/'"$SERVICE_USER"' ALL=/' "$INSTALL_DIR/apps/agent/scripts/krakenos.sudoers.example" 2> /dev/null || true)"
    run apt-get install -y -qq wireguard-tools iptables iproute2
    log "    helper privilegiado instalado (VPN/firewall/QoS operativos)"
  else
    SUMMARY+=("sin helper privilegiado → VPN WireGuard, firewall y QoS NO funcionan (reinstala con --with-helper)")
  fi

  if [[ $WITH_FFMPEG -eq 1 ]]; then
    run apt-get install -y -qq ffmpeg
    log "    ffmpeg instalado (cámaras RTSP operativas)"
  else
    SUMMARY+=("sin ffmpeg → las cámaras RTSP (vídeo en vivo, movimiento, grabación) NO funcionan (--with-ffmpeg)")
  fi

  if [[ $WITH_DEPS -eq 1 ]]; then
    run bash -c "cd '$INSTALL_DIR/apps/agent' && pnpm add ${EXTRA_DEPS[*]}"
    write_extra_deps_manifest
    log "    deps de integraciones instaladas (${EXTRA_DEPS[*]})"
  else
    SUMMARY+=("sin deps de integraciones → routers por SSH, MQTT/zigbee2mqtt, SNMP y Matter NO conectarán (--with-deps)")
  fi
}

# Manifiesto que sobrevive al `git checkout` del actualizador (va en data/, que es
# untracked y se conserva entre updates).
write_extra_deps_manifest() {
  local manifest="$INSTALL_DIR/apps/agent/data/extra-deps.json"
  local json
  json="$(printf '"%s",' "${EXTRA_DEPS[@]}")"
  json="[${json%,}]"
  if [[ $DRY_RUN -eq 1 ]]; then
    printf 'dry-run$ escribir %s con %s\n' "$manifest" "$json"
    return 0
  fi
  mkdir -p "$(dirname "$manifest")"
  printf '%s\n' "$json" > "$manifest"
}

# Lo que quedó desactivado se dice EN VOZ ALTA al final: antes se omitía en
# silencio y el usuario descubría por su cuenta que no tenía cámaras ni VPN.
print_summary() {
  [[ ${#SUMMARY[@]} -eq 0 ]] && return 0
  printf '\n──────────────── Qué quedó FUERA de esta instalación ────────────────\n'
  local item
  for item in "${SUMMARY[@]}"; do
    printf '  · %s\n' "$item"
  done
  printf '  Todo junto:  install.sh --with-all\n'
  printf '─────────────────────────────────────────────────────────────────────\n\n'
}

# ---------------------------------------------------------------- update / uninstall
do_update() {
  is_git_checkout "$INSTALL_DIR" || die "no hay una instalación git en $INSTALL_DIR (¿instalaste con --from-local?)"
  local runner="$INSTALL_DIR/apps/agent/dist/update-runner.js"
  [[ $DRY_RUN -eq 1 || -f "$runner" ]] || die "falta $runner — completa una instalación antes de actualizar"
  # Sube Node si el instalado es anterior al que exige esta versión del instalador:
  # una release que pasa a pedir un Node más nuevo no se puede aplicar con el viejo,
  # y es este camino —con root— el único que puede instalarlo.
  ensure_node
  if ! has_systemd; then
    warn "sin systemd, el paso «restart» de la actualización no podrá reiniciar el servicio: reinicia el agente a mano al terminar"
  fi
  log "Buscando la última versión…"
  run git -C "$INSTALL_DIR" fetch --tags --prune origin
  local tag
  tag="$(git -C "$INSTALL_DIR" tag -l 'v*' --sort=-v:refname 2>/dev/null | head -1 || true)"
  [[ -n "$tag" || $DRY_RUN -eq 1 ]] || die "el repo no tiene etiquetas v*: nada que actualizar por releases"
  local version="${tag#v}"
  log "Actualizando a ${tag:-<última etiqueta>} vía el orquestador (US-190: backup → apply → migrate → restart → healthcheck, con rollback)…"
  # Reusa EXACTAMENTE el camino del update one-click: mismo proceso one-shot.
  #
  # Como el USUARIO DEL SERVICIO, no como root: corriéndolo como root, `pnpm` y el
  # build dejaban node_modules/dist propiedad de root sobre un árbol chowneado y el
  # agente ya no podía escribir (AUD3-23). Además la regla sudoers de `restart` está
  # a nombre del usuario del servicio, así que como root tampoco es equivalente.
  local as_user=""
  if [[ "$(id -u)" -eq 0 ]] && id -u "$SERVICE_USER" > /dev/null 2>&1; then
    as_user="runuser -u $SERVICE_USER -- "
    log "    ejecutando como $SERVICE_USER (no como root: no rompe los permisos del árbol)"
  fi
  run bash -c "cd '$INSTALL_DIR/apps/agent' && ${as_user}node dist/update-runner.js '${version:-0.0.0}'"
  refresh_tls_after_update
  print_summary
  log "Resultado en $INSTALL_DIR/apps/agent/var/update-result.json (y en la card de Ajustes → Sistema)."
}

# ¿Hay systemd de verdad? En un contenedor `systemctl` existe pero no hay PID 1 de
# systemd: sus llamadas fallan y con `set -e` tumbaban el desinstalador entero antes
# de enumerar los datos conservados.
# `KRAKENOS_ASSUME_SYSTEMD=yes|no` fuerza la respuesta (solo para los tests, igual que
# KRAKENOS_OS_ID/ARCH): en un runner sin systemd no se puede comprobar el camino con él.
has_systemd() {
  case "${KRAKENOS_ASSUME_SYSTEMD:-}" in
    yes) return 0 ;;
    no) return 1 ;;
  esac
  [[ -d /run/systemd/system ]] && command -v systemctl > /dev/null
}

# ¿Es WSL? Las distros de WSL2 arrancan sin systemd salvo que se active a mano.
is_wsl() {
  case "${KRAKENOS_ASSUME_WSL:-}" in # igual que ASSUME_SYSTEMD: solo para tests
    yes) return 0 ;;
    no) return 1 ;;
  esac
  [[ -n "${WSL_DISTRO_NAME:-}" ]] || grep -qi microsoft /proc/version 2> /dev/null
}

# Sin systemd no hay servicio que instalar: se degrada a --no-service EN VEZ de morir
# a mitad en `systemctl daemon-reload`, y se dice qué falta y cómo seguir. Cubre de
# una vez la unidad, el sudoers de la actualización, los timers de TLS y la espera
# del servicio, que ya se omiten con --no-service.
detect_systemd() {
  [[ $NO_SERVICE -eq 0 ]] || return 0
  has_systemd && return 0
  NO_SERVICE=1
  NO_SYSTEMD=1
  warn "este sistema no tiene systemd en marcha: no se instalará el servicio (se instala todo lo demás)"
  if is_wsl; then
    warn "estás en WSL. Para activar systemd: añade a /etc/wsl.conf las líneas «[boot]» y «systemd=true», ejecuta «wsl --shutdown» desde Windows, vuelve a abrir la distro y repite la instalación"
    SUMMARY+=("sin systemd (WSL): activa systemd en /etc/wsl.conf ([boot] systemd=true) y «wsl --shutdown», y vuelve a ejecutar el instalador para tener servicio, renovación de certificados y actualización automática")
  else
    SUMMARY+=("sin systemd: no hay servicio. Arranque manual: cd $INSTALL_DIR/apps/agent && NODE_ENV=production node dist/index.js (no se reinicia solo ni se actualiza solo)")
  fi
}

do_uninstall() {
  local u
  log "Desinstalando el servicio $SERVICE_NAME…"
  if has_systemd; then
    run systemctl disable --now "$SERVICE_NAME" || true
    run rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    run systemctl daemon-reload || true
  else
    log "    sin systemd en este sistema: solo se limpia la unidad si existe"
    run rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  fi
  run rm -f "/etc/sudoers.d/krakenos-update"
  # Timers de renovación del certificado (los dos modos) y la copia de root.
  for u in cert cert-local; do
    if has_systemd; then run systemctl disable --now "${SERVICE_NAME}-${u}.timer" || true; fi
    run rm -f "/etc/systemd/system/${SERVICE_NAME}-${u}.timer" "/etc/systemd/system/${SERVICE_NAME}-${u}.service"
  done
  run rm -f "$LIB_DIR/gen-local-ca.sh"
  if [[ $PURGE -eq 1 ]]; then
    if confirm "¿Borrar TAMBIÉN $INSTALL_DIR (base de datos, claves y credenciales)? Es irreversible" || [[ $ASSUME_YES -eq 1 ]]; then
      run rm -rf "$INSTALL_DIR"
      # La CA y el certificado servido solo se borran con --purge confirmado: perder
      # la CA obliga a reinstalar su certificado en cada dispositivo.
      run rm -rf "$CA_DIR" "$TLS_DIR"
      log "Eliminado $INSTALL_DIR por completo."
    else
      log "Purga cancelada: $INSTALL_DIR queda intacto."
    fi
  else
    printf '\nSe conserva %s con tus datos:\n' "$INSTALL_DIR"
    printf '  · base de datos (apps/agent/prisma/*.db)\n'
    printf '  · claves (apps/agent/keys/)\n'
    printf '  · credenciales y estado (apps/agent/data/)\n'
    printf 'Para borrarlo todo:  install.sh --uninstall --purge   (o rm -rf %s)\n\n' "$INSTALL_DIR"
  fi
}

# ---------------------------------------------------------------- main
main() {
  parse_args "$@"
  validate_paths

  case "$MODE" in
    uninstall)
      require_root
      do_uninstall
      exit 0
      ;;
    update)
      require_root
      do_update
      exit 0
      ;;
  esac

  log "Instalador de KrakenOS (${REPO}) → $INSTALL_DIR"
  check_platform
  detect_systemd
  require_root
  ensure_base_packages
  ensure_node
  ensure_pnpm
  fetch_source
  build_and_configure
  # TLS antes de arrancar el servicio: el agente lee el cert al iniciar, así que
  # emitirlo después dejaría la primera ejecución en HTTP hasta el siguiente
  # reinicio (US-241).
  setup_tls
  harden_permissions
  install_service
  install_extras
  print_setup_url
  log "Listo. Documentación: README y docs/ del repo."
  print_summary
}

main "$@"
