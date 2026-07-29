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
WITH_HELPER=0
WITH_FFMPEG=0
WITH_DEPS=0
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
    local i
    for i in $(seq 1 20); do
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
  local i port
  port="$(agent_port)"
  for i in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${port}/health/ready" > /dev/null 2>&1; then break; fi
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
  log "Resultado en $INSTALL_DIR/apps/agent/var/update-result.json (y en la card de Ajustes → Sistema)."
}

# ¿Hay systemd de verdad? En un contenedor `systemctl` existe pero no hay PID 1 de
# systemd: sus llamadas fallan y con `set -e` tumbaban el desinstalador entero antes
# de enumerar los datos conservados.
has_systemd() { [[ -d /run/systemd/system ]] && command -v systemctl > /dev/null; }

do_uninstall() {
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
  harden_permissions
  install_service
  install_extras
  print_setup_url
  log "Listo. Documentación: README y docs/ del repo."
  print_summary
}

main "$@"
