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
#   --yes            no pregunta (los extras opcionales se OMITEN; instálalos aparte)
#   --dry-run        imprime el plan sin ejecutar nada que mute el sistema
#   --dir DIR        directorio de instalación (por defecto /opt/krakenos)
#   --from-local P   instala desde una copia local del repo en vez de clonar (CI/dev)
#   --branch REF     rama/tag a instalar (por defecto: la última etiqueta v*, o main)
#   --no-service     no crea la unidad systemd (contenedores/CI; arranque manual)
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
PNPM_VERSION="9.12.0" # pinneado = packageManager del repo (patrón AUD-27: sin descargas en runtime)
NODE_MAJOR=20
MIN_RAM_MB="${KRAKENOS_MIN_RAM_MB:-900}"
MIN_DISK_MB="${KRAKENOS_MIN_DISK_MB:-2000}"

MODE=install
DRY_RUN=0
ASSUME_YES=0
NO_SERVICE=0
PURGE=0
FROM_LOCAL=""
BRANCH=""

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

# Pregunta sí/no (por defecto NO): los extras son opt-in honesto. Con --yes o
# sin TTY no pregunta y responde que no.
confirm() {
  local prompt="$1"
  if [[ $ASSUME_YES -eq 1 || ! -t 0 ]]; then return 1; fi
  local answer=""
  read -r -p "$prompt [s/N] " answer
  [[ "$answer" == "s" || "$answer" == "S" ]]
}

usage() { sed -n '3,27p' "$0" 2>/dev/null || true; }

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
    run bash -c "curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -"
    run apt-get install -y -qq nodejs
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
  if [[ -d "$INSTALL_DIR/.git" ]]; then
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
  run bash -c "cd '$INSTALL_DIR' && pnpm install --frozen-lockfile"
  run bash -c "cd '$INSTALL_DIR' && pnpm --filter @krakenos/agent exec prisma generate"
  run bash -c "cd '$INSTALL_DIR' && pnpm --filter @krakenos/agent exec prisma migrate deploy"
  run bash -c "cd '$INSTALL_DIR' && pnpm build"
}

# ---------------------------------------------------------------- servicio
install_service() {
  if [[ $NO_SERVICE -eq 1 ]]; then
    log "[6/7] Servicio systemd omitido (--no-service). Arranque manual:"
    log "    cd $INSTALL_DIR/apps/agent && NODE_ENV=production node dist/index.js"
    return
  fi
  log "[6/7] Servicio systemd ($SERVICE_NAME)…"
  if ! id -u "$SERVICE_USER" > /dev/null 2>&1; then
    run useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
  fi
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
NoNewPrivileges=false
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT
  fi
  run systemctl daemon-reload
  run systemctl enable --now "$SERVICE_NAME"
}

print_setup_url() {
  log "[7/7] Primer acceso…"
  if [[ $DRY_RUN -eq 1 || $NO_SERVICE -eq 1 ]]; then
    log "    Al primer arranque sin usuarios, el agente imprime la URL de /setup?token= con QR."
    return
  fi
  # Espera al readiness y saca del journal la URL de configuración (AUD-26:
  # el agente la imprime por stdout, legible en journald).
  local i
  for i in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:3001/health/ready" > /dev/null 2>&1; then break; fi
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

# ---------------------------------------------------------------- extras opt-in
offer_extras() {
  [[ $DRY_RUN -eq 1 ]] && return 0
  if confirm "¿Instalar el helper privilegiado + sudoers (VPN WireGuard, firewall, QoS)?"; then
    run install -m 0755 "$INSTALL_DIR/apps/agent/scripts/krakenos-helper.sh" /usr/local/bin/krakenos-helper
    run install -m 0440 "$INSTALL_DIR/apps/agent/scripts/krakenos.sudoers.example" /etc/sudoers.d/krakenos
    run apt-get install -y -qq wireguard-tools iptables iproute2
  else
    log "Extras de red omitidos (VPN/firewall/QoS necesitan el helper: README → Operaciones privilegiadas)"
  fi
  if confirm "¿Instalar ffmpeg (cámaras RTSP: vídeo en vivo, movimiento, grabación)?"; then
    run apt-get install -y -qq ffmpeg
  else
    log "ffmpeg omitido (las cámaras RTSP no operarán hasta instalarlo)"
  fi
  if confirm "¿Instalar las dependencias opcionales de integraciones (node-ssh, mqtt, net-snmp, ws)?"; then
    run bash -c "cd '$INSTALL_DIR/apps/agent' && pnpm add node-ssh mqtt net-snmp ws"
  else
    log "Deps de integraciones omitidas (se instalan al conectar cada equipo: guías en docs/)"
  fi
}

# ---------------------------------------------------------------- update / uninstall
do_update() {
  [[ -d "$INSTALL_DIR/.git" ]] || die "no hay una instalación git en $INSTALL_DIR (¿instalaste con --from-local?)"
  local runner="$INSTALL_DIR/apps/agent/dist/update-runner.js"
  [[ $DRY_RUN -eq 1 || -f "$runner" ]] || die "falta $runner — completa una instalación antes de actualizar"
  log "Buscando la última versión…"
  run git -C "$INSTALL_DIR" fetch --tags --prune origin
  local tag
  tag="$(git -C "$INSTALL_DIR" tag -l 'v*' --sort=-v:refname 2>/dev/null | head -1 || true)"
  [[ -n "$tag" || $DRY_RUN -eq 1 ]] || die "el repo no tiene etiquetas v*: nada que actualizar por releases"
  local version="${tag#v}"
  log "Actualizando a ${tag:-<última etiqueta>} vía el orquestador (US-190: backup → apply → migrate → restart → healthcheck, con rollback)…"
  # Reusa EXACTAMENTE el camino del update one-click: mismo proceso one-shot.
  run bash -c "cd '$INSTALL_DIR/apps/agent' && node dist/update-runner.js '${version:-0.0.0}'"
  log "Resultado en $INSTALL_DIR/apps/agent/var/update-result.json (y en la card de Ajustes → Sistema)."
}

do_uninstall() {
  log "Desinstalando el servicio $SERVICE_NAME…"
  run systemctl disable --now "$SERVICE_NAME" || true
  run rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  run systemctl daemon-reload
  if [[ $PURGE -eq 1 ]]; then
    if confirm "¿Borrar TAMBIÉN $INSTALL_DIR (base de datos, claves y credenciales)? Es irreversible" || [[ $ASSUME_YES -eq 1 ]]; then
      run rm -rf "$INSTALL_DIR"
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
  require_root
  ensure_base_packages
  ensure_node
  ensure_pnpm
  fetch_source
  build_and_configure
  install_service
  offer_extras
  print_setup_url
  log "Listo. Documentación: README y docs/ del repo."
}

main "$@"
