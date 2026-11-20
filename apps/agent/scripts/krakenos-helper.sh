#!/usr/bin/env bash
#
# krakenos-helper — helper privilegiado de KrakenOS.
#
# El agente corre SIN privilegios y delega las operaciones de red privilegiadas
# en este helper, invocado vía `sudo -n`. La allowlist de abajo es la única
# superficie con permisos de root. Acota DOS cosas (US-74, F1):
#   1. el VERBO: solo un subconjunto de wg/wg-quick/iptables/tc;
#   2. el ÁMBITO (objetivo): `iptables` solo sobre la cadena dedicada (y su
#      enlace en FORWARD), `tc` solo sobre la interfaz de QoS y `wg`/`wg-quick`
#      solo sobre la interfaz WireGuard. Cualquier otra cosa se rechaza (64).
#
# Instalación:
#   sudo install -m 0755 krakenos-helper.sh /usr/local/bin/krakenos-helper
#   sudo install -m 0440 krakenos.sudoers.example /etc/sudoers.d/krakenos
#
set -euo pipefail

# --- Ámbito permitido (acota el OBJETIVO, no solo el verbo — US-74, F1) -------
#
# Estos valores limitan SOBRE QUÉ puede actuar root y deben coincidir con la
# config del agente (FW_CHAIN / TC_INTERFACE / WG_INTERFACE). El agente, SIN
# privilegios, NO puede ampliarlos: en producción `sudo` descarta el entorno
# (`env_reset`, por defecto), así que el ámbito se toma de los defaults de abajo
# o de un fichero root-owned opcional (`/etc/krakenos/helper.conf`). Si despliegas
# con valores no-default, edita este script (root-owned) o crea ese fichero con
# `KRAKENOS_FW_CHAIN=...`, `KRAKENOS_TC_IFACE=...`, `KRAKENOS_WG_IFACE=...`.
_conf="${KRAKENOS_HELPER_CONF:-/etc/krakenos/helper.conf}"
# shellcheck source=/dev/null
[ -r "$_conf" ] && . "$_conf"
KRAKENOS_FW_CHAIN="${KRAKENOS_FW_CHAIN:-KRAKENOS}"
KRAKENOS_TC_IFACE="${KRAKENOS_TC_IFACE:-eth0}"
KRAKENOS_WG_IFACE="${KRAKENOS_WG_IFACE:-wg0}"

deny() {
  echo "krakenos-helper: no permitido: $*" >&2
  exit 64
}

# Los argumentos se pasan SIEMPRE como argv separado (`exec wg "$@"`, sin `eval`
# ni shell), así que no hay inyección de shell. Defensa en profundidad extra:
# ningún argumento legítimo de wg/iptables/tc contiene saltos de línea, retornos
# de carro, tabuladores u otros caracteres de control, así que se rechazan de
# entrada (un valor con `\n` solo tendría sentido como intento de inyección).
for arg in "$@"; do
  case "$arg" in
    *[$'\n\r\t\v\f']*) deny "argumento con caracteres de control" ;;
  esac
done

# Exige que el argumento que sigue a `dev` sea la interfaz permitida (tc).
require_tc_dev() {
  local want="$1"; shift
  local prev="" a found=""
  for a in "$@"; do
    if [ "$prev" = "dev" ]; then
      [ "$a" = "$want" ] || deny "tc dev no permitido: $a"
      found=1
    fi
    prev="$a"
  done
  [ -n "$found" ] || deny "tc sin 'dev $want'"
}

_ipv4='^([0-9]{1,3}\.){3}[0-9]{1,3}(/[0-9]{1,2})?$'

# Lista cerrada de la cadena propia: solo lo que emiten los constructores de
# `iptables.helpers.ts`. Cualquier otro token (-m osf, -M, -tnat, --table=, -j LOG…)
# se rechaza, porque iptables abrevia opciones y carga módulos/programas.
#   check_iptables_rule <token>...   (los tokens tras `<op> <cadena>`)
check_iptables_rule() {
  local a
  while [ "$#" -gt 0 ]; do
    a="$1"; shift
    case "$a" in
      -p) [[ "${1:-}" =~ ^(tcp|udp|icmp)$ ]] || deny "iptables -p ${1:-}"; shift ;;
      -s|-d) [[ "${1:-}" =~ $_ipv4 ]] || deny "iptables $a ${1:-}"; shift ;;
      --dport)
        [[ "${1:-}" =~ ^[0-9]{1,5}$ ]] && [ "$((10#$1))" -ge 1 ] && [ "$((10#$1))" -le 65535 ] \
          || deny "iptables --dport ${1:-}"
        shift ;;
      -m) [ "${1:-}" = "comment" ] || deny "iptables -m ${1:-}"; shift ;;
      --comment) [[ "${1:-}" =~ ^krakenos:[A-Za-z0-9_-]+$ ]] || deny "iptables --comment"; shift ;;
      -j) [[ "${1:-}" =~ ^(ACCEPT|DROP)$ ]] || deny "iptables -j ${1:-}"; shift ;;
      *) deny "iptables argumento no permitido: $a" ;;
    esac
  done
}

# tc: lista cerrada de palabras de `tc.helpers.ts`. `bpf`, `obj`, `action`, `-b`,
# `exec`… no están, así que caen en el `*)`. La interfaz tras `dev` ya la acota
# `require_tc_dev`; aquí solo se admiten números y `<n>:<m>` / `<n>kbit` / IPv4.
check_tc_tokens() {
  local a
  for a in "$@"; do
    case "$a" in
      qdisc|class|filter|add|del|dev|parent|root|handle|htb|default|classid|rate|ceil|prio|protocol|ip|u32|match|dst|flowid) ;;
      "$KRAKENOS_TC_IFACE") ;;
      *)
        [[ "$a" =~ ^[0-9]+(kbit)?$ ]] || [[ "$a" =~ ^[0-9]+:[0-9]*$ ]] || [[ "$a" =~ $_ipv4 ]] \
          || deny "tc argumento no permitido: $a"
        ;;
    esac
  done
}

# --- Actualización por paquete (pkg-update / pkg-rollback) ---------------------
#
# Corre como ROOT e instala paquetes: ante la duda, se rechaza. El agente (sin privilegios) deja
# paquete, manifiesto y firma en SU directorio de staging; todo lo que viva ahí lo puede cambiar
# el servicio hasta el último instante, así que root NUNCA verifica ni instala desde ahí: copia a
# un directorio suyo (root:root 0700), vuelve a verificar LA COPIA con el verificador instalado por
# el paquete (clave embebida, nunca recibida) e instala solo desde esa copia. Root no descarga nada.
# Estas rutas se pueden cambiar solo desde /etc/krakenos/helper.conf (root): `sudo` descarta el entorno.
KRAKENOS_PKG_DATA_DIR="${KRAKENOS_PKG_DATA_DIR:-/var/lib/krakenos}"
KRAKENOS_PKG_STAGING="${KRAKENOS_PKG_STAGING:-$KRAKENOS_PKG_DATA_DIR/updates}"
KRAKENOS_PKG_ROOT_DIR="${KRAKENOS_PKG_ROOT_DIR:-/var/lib/krakenos-root/updates}"
KRAKENOS_PKG_NODE="${KRAKENOS_PKG_NODE:-/usr/lib/krakenos/node/bin/node}"
KRAKENOS_PKG_VERIFIER="${KRAKENOS_PKG_VERIFIER:-/usr/lib/krakenos/libexec/krakenos-verify-update.mjs}"
KRAKENOS_PKG_USER="${KRAKENOS_PKG_USER:-krakenos}"
KRAKENOS_PKG_RUN_AS="${KRAKENOS_PKG_RUN_AS:-runuser -u $KRAKENOS_PKG_USER --}"
KRAKENOS_PKG_UNIT="${KRAKENOS_PKG_UNIT:-krakenos}"
KRAKENOS_PKG_FORMAT="${KRAKENOS_PKG_FORMAT:-}" # deb | arch; vacío = el que haya (dpkg-query o pacman)
KRAKENOS_PKG_MAX_BYTES="${KRAKENOS_PKG_MAX_BYTES:-1073741824}"
KRAKENOS_PKG_ROLLBACK_WINDOW_MIN="${KRAKENOS_PKG_ROLLBACK_WINDOW_MIN:-60}"

_semver='^[0-9]+\.[0-9]+\.[0-9]+$'
PKG_RC_REJECTED=65 # la verificación de root rechazó el paquete
PKG_RC_NO_PREVIOUS=66 # rollback sin paquete anterior que reinstalar

pkg_state_file() { echo "$KRAKENOS_PKG_ROOT_DIR/.state"; }

# Ejecuta un comando COMO el usuario del servicio: root no lee ni escribe en directorios del
# servicio con sus privilegios (un enlace simbólico plantado allí lo desviaría).
run_as() {
  local -a pre
  read -r -a pre <<< "$KRAKENOS_PKG_RUN_AS"
  "${pre[@]}" "$@"
}

pkg_format() {
  case "$KRAKENOS_PKG_FORMAT" in
    deb|arch) echo "$KRAKENOS_PKG_FORMAT"; return ;;
    "") ;;
    *) deny "pkg: formato desconocido" ;;
  esac
  # Por quién tiene instalado `krakenos`, no por qué gestor existe: Arch puede traer `dpkg` (en `extra`).
  # shellcheck disable=SC2016
  local st='${Status}' # «install ok <estado>»: también half-configured/half-installed tras un fallo de dpkg
  if command -v dpkg-query > /dev/null 2>&1 && dpkg-query -W -f="$st" krakenos 2> /dev/null | grep -q '^install ok '; then echo deb
  elif command -v pacman > /dev/null 2>&1 && pacman -Q krakenos > /dev/null 2>&1; then echo arch
  else deny "pkg: krakenos no consta instalado ni en dpkg ni en pacman"; fi
}

# Plataforma del manifiesto que corresponde a ESTE equipo (la decide root, no el agente).
pkg_platform() {
  local a
  case "$1" in
    deb)
      a="$(dpkg --print-architecture)"
      case "$a" in amd64) echo deb-amd64 ;; arm64) echo deb-arm64 ;; *) deny "pkg: arquitectura $a" ;; esac ;;
    arch)
      [ "$(uname -m)" = "x86_64" ] || deny "pkg: arquitectura $(uname -m)"
      echo arch-x86_64 ;;
  esac
}

# Versión instalada, leída del gestor de paquetes (nunca del agente), sin época ni revisión.
pkg_installed() {
  local v
  # shellcheck disable=SC2016
  local fmtver='${Version}'
  case "$1" in
    deb) v="$(dpkg-query -W -f="$fmtver" krakenos 2> /dev/null || true)"; v="${v#*:}" ;;
    arch) v="$(pacman -Q krakenos 2> /dev/null | awk '{print $2}' || true)"; v="${v#*:}"; v="${v%-*}" ;;
  esac
  v="${v%%[~+-]*}"
  [[ "$v" =~ $_semver ]] || deny "pkg: no se pudo leer la versión instalada"
  echo "$v"
}

pkg_ext_ok() {
  case "$1" in
    deb) [[ "$2" =~ ^[A-Za-z0-9][A-Za-z0-9._+~-]*\.deb$ ]] ;;
    arch) [[ "$2" =~ ^[A-Za-z0-9][A-Za-z0-9._+~-]*\.pkg\.tar\.zst$ ]] ;;
  esac
}

# El directorio de root existe, es de root (de quien corre el helper), 0700 y no es un enlace.
pkg_root_dir() {
  local d="$KRAKENOS_PKG_ROOT_DIR" p
  p="$(dirname "$d")"
  for x in "$p" "$d"; do [ -e "$x" ] || [ -L "$x" ] || mkdir -m 0700 -- "$x"; done
  for x in "$p" "$d"; do
    { [ ! -L "$x" ] && [ -d "$x" ] && [ "$(stat -c '%u %a' -- "$x")" = "$(id -u) 700" ]; } \
      || deny "pkg: $x no es un directorio de root 0700"
  done
  exec 9> "$d/.lock"
  flock -n 9 || deny "pkg: ya hay una actualización en curso"
}

# Ruta de entrada: absoluta, sin enlaces, fichero normal y DIRECTAMENTE en el staging del servicio.
pkg_check_input() {
  local f="$1" st rp
  st="$(realpath -e -- "$KRAKENOS_PKG_STAGING" 2> /dev/null || true)"
  [ -n "$st" ] && [ "$st" = "$KRAKENOS_PKG_STAGING" ] || deny "pkg: el staging no es el esperado"
  case "$f" in /*) ;; *) deny "pkg: ruta no absoluta" ;; esac
  [ ! -L "$f" ] || deny "pkg: enlace simbólico: $f"
  rp="$(realpath -e -- "$f" 2> /dev/null || true)"
  [ -n "$rp" ] && [ "$rp" = "$f" ] && [ "$(dirname -- "$rp")" = "$st" ] || deny "pkg: fuera del staging: $f"
  [ -f "$rp" ] || deny "pkg: no es un fichero normal: $f"
}

# Copia como el usuario del servicio (con tope) a un destino que abre root en SU directorio.
pkg_copy_in() {
  umask 077
  run_as head -c "$KRAKENOS_PKG_MAX_BYTES" -- "$1" > "$2" || return 1
  [ -f "$2" ] && [ ! -L "$2" ]
}

pkg_verify() { # <dir> <nombre-paquete> <plataforma> <versión> (--installed v | --rollback)
  local d="$1" name="$2" plat="$3" ver="$4"; shift 4
  "$KRAKENOS_PKG_NODE" "$KRAKENOS_PKG_VERIFIER" --manifest "$d/manifest.json" --sig "$d/manifest.json.sig" \
    --package "$d/$name" --platform "$plat" --version "$ver" "$@"
}

# apt-get/pacman escriben en /usr y /etc, y la unidad del servicio lleva `ProtectSystem=full`: lo que
# lanza `sudo` desde el servicio HEREDA ese espacio de montaje (solo lectura) y la instalación fallaría
# siempre. Se ejecuta en una unidad transitoria que arranca PID 1, fuera del espacio y del cgroup del
# servicio (que el postinst reinicia). Sin `systemd-run` se ABORTA: nunca se instala desde el espacio
# del servicio. El comando que recibe es siempre una ruta de la copia de root, ya verificada.
pkg_isolated() { # <prefijo-unidad> <versión> <comando>...
  local unit="$1" ver="$2"; shift 2
  [[ "$ver" =~ $_semver ]] || { echo "krakenos-helper: versión no válida para la unidad" >&2; return 64; }
  command -v systemd-run > /dev/null 2>&1 || { echo "krakenos-helper: falta systemd-run: no se instala desde el espacio del servicio" >&2; return 69; }
  systemd-run --wait --collect --pipe --quiet --unit="$unit-$ver" -- "$@"
}

pkg_install() { # <formato> <fichero> <versión> [rollback]
  if [ "$1" = deb ]; then
    local -a extra=()
    local unit=krakenos-update
    [ "${4:-}" = rollback ] && { extra=(--allow-downgrades); unit=krakenos-rollback; }
    pkg_isolated "$unit" "$3" env DEBIAN_FRONTEND=noninteractive apt-get install -y -o Dpkg::Options::=--force-confold "${extra[@]}" "$2"
  else
    pkg_isolated "$([ "${4:-}" = rollback ] && echo krakenos-rollback || echo krakenos-update)" "$3" pacman -U --noconfirm "$2"
  fi
}

# El paquete (único *.deb / *.pkg.tar.zst) que root guardó para una versión.
pkg_saved_name() {
  local f
  for f in "$KRAKENOS_PKG_ROOT_DIR/$1"/*; do
    [ -f "$f" ] && [ ! -L "$f" ] && pkg_ext_ok "$2" "$(basename -- "$f")" && { basename -- "$f"; return 0; }
  done
  return 1
}

pkg_update() {
  [ "$#" -eq 4 ] || deny "pkg-update <paquete> <manifest.json> <manifest.json.sig> <versión>"
  local pkg="$1" man="$2" sig="$3" ver="$4" fmt plat installed name d prev=""
  [[ "$ver" =~ $_semver ]] || deny "pkg-update: versión no válida"
  fmt="$(pkg_format)"
  name="$(basename -- "$pkg")"
  pkg_ext_ok "$fmt" "$name" || deny "pkg-update: nombre de paquete no válido"
  [ "$(basename -- "$man")" = manifest.json ] && [ "$(basename -- "$sig")" = manifest.json.sig ] \
    || deny "pkg-update: manifiesto o firma con otro nombre"
  for f in "$pkg" "$man" "$sig"; do pkg_check_input "$f"; done
  plat="$(pkg_platform "$fmt")"
  installed="$(pkg_installed "$fmt")"

  pkg_root_dir
  rm -f -- "$(pkg_state_file)" # sin estado no hay nada que revertir: un rollback antiguo no puede reinstalar nada
  d="$KRAKENOS_PKG_ROOT_DIR/$ver"
  rm -rf -- "$d"
  mkdir -m 0700 -- "$d"
  # Copia primero, verifica LA COPIA: lo que cambie el servicio a partir de aquí ya no cuenta.
  pkg_copy_in "$man" "$d/manifest.json" && pkg_copy_in "$sig" "$d/manifest.json.sig" \
    && pkg_copy_in "$pkg" "$d/$name" || { rm -rf -- "$d"; deny "pkg-update: no se pudo copiar"; }
  if ! pkg_verify "$d" "$name" "$plat" "$ver" --installed "$installed"; then
    rm -rf -- "$d"
    echo "krakenos-helper: la verificación de root rechazó la actualización" >&2
    exit "$PKG_RC_REJECTED"
  fi

  # Paquete anterior para el rollback: solo si root tiene su copia y sigue verificando.
  if [ -d "$KRAKENOS_PKG_ROOT_DIR/$installed" ] && [ ! -L "$KRAKENOS_PKG_ROOT_DIR/$installed" ]; then
    if pname="$(pkg_saved_name "$installed" "$fmt")" \
      && pkg_verify "$KRAKENOS_PKG_ROOT_DIR/$installed" "$pname" "$plat" "$installed" --rollback > /dev/null 2>&1; then
      prev="$installed"
    fi
  fi
  printf 'fmt=%s ver=%s prev=%s\n' "$fmt" "$ver" "$prev" > "$(pkg_state_file)"
  pkg_install "$fmt" "$d/$name" "$ver" || exit "$?"
  # Se conservan solo la nueva y la anterior.
  for x in "$KRAKENOS_PKG_ROOT_DIR"/*/; do
    x="$(basename -- "$x")"
    [ "$x" = "$ver" ] || [ "$x" = "$prev" ] || rm -rf -- "${KRAKENOS_PKG_ROOT_DIR:?}/$x"
  done
}

pkg_rollback() {
  [ "$#" -eq 2 ] || deny "pkg-rollback <copia-de-la-base> <versión-destino>"
  local copy="$1" target="$2" db rp prev="" ver="" line fmt plat pname installed rc=0 reinstalled=0 restored=0
  [[ "$target" =~ $_semver ]] || deny "pkg-rollback: versión no válida"
  db="${copy%.pre-update}"
  [ "$db" != "$copy" ] && [ -n "$(basename -- "$db")" ] || deny "pkg-rollback: la copia debe acabar en .pre-update"
  case "$copy" in "$KRAKENOS_PKG_DATA_DIR"/*) ;; *) deny "pkg-rollback: copia fuera de los datos del servicio" ;; esac
  [ ! -L "$copy" ] || deny "pkg-rollback: enlace simbólico"
  rp="$(realpath -e -- "$copy" 2> /dev/null || true)"
  [ "$rp" = "$copy" ] && [ -f "$rp" ] || deny "pkg-rollback: la copia no es un fichero normal bajo los datos del servicio"
  [ ! -L "$db" ] || deny "pkg-rollback: la base es un enlace simbólico"
  { [ ! -e "$db" ] || [ -f "$db" ]; } || deny "pkg-rollback: la base no es un fichero normal"

  pkg_root_dir
  # Solo se revierte lo que `pkg-update` empezó hace poco Y para la versión que el agente dice que falló:
  # un estado de una actualización anterior no puede convertir otro fallo en un downgrade.
  if [ ! -f "$(pkg_state_file)" ] || [ -z "$(find "$(pkg_state_file)" -mmin "-$KRAKENOS_PKG_ROLLBACK_WINDOW_MIN" 2> /dev/null)" ]; then
    echo "krakenos-helper: no hay una instalación reciente que revertir; no se toca nada" >&2
    return 0
  fi
  read -r line < "$(pkg_state_file)" || true
  [[ "$line" =~ ^fmt=(deb|arch)\ ver=([0-9]+\.[0-9]+\.[0-9]+)\ prev=([0-9]+\.[0-9]+\.[0-9]+)?$ ]] || deny "pkg-rollback: estado ilegible"
  # El formato sale del estado que escribió root, no de lo que diga ahora dpkg: tras un fallo a medias
  # el paquete queda half-configured/half-installed y la detección fallaría justo cuando hace falta.
  fmt="${BASH_REMATCH[1]}"
  ver="${BASH_REMATCH[2]}"
  prev="${BASH_REMATCH[3]}"
  if [ "$ver" != "$target" ]; then
    echo "krakenos-helper: el estado es de la versión $ver, no de la $target; no se toca nada" >&2
    return 0
  fi
  # Todo lo que puede abortar va ANTES de parar el servicio: parado, solo se sale tras restaurar y arrancar.
  plat="$(pkg_platform "$fmt")"
  installed="$(pkg_installed "$fmt")"

  # stop/restart solo hablan con PID 1 (no escriben /usr ni /etc): basta llamarlos desde el helper, sin unidad transitoria.
  systemctl stop "$KRAKENOS_PKG_UNIT" || { echo "krakenos-helper: no se pudo parar el servicio" >&2; return 1; }
  # PRIMERO la base, con el servicio parado: el postinst del paquete reinicia el servicio al instalarse
  # y no puede arrancar sobre una base ya migrada ni encontrársela cambiada con el fichero abierto.
  # Se restaura como el usuario del servicio.
  # Los -wal/-shm se borran ANTES de poner la base: si el rm fallara después, SQLite aplicaría el WAL nuevo sobre la base vieja.
  if run_as cp -- "$copy" "$db.restore-tmp" && run_as rm -f -- "$db-wal" "$db-shm" \
    && run_as mv -f -- "$db.restore-tmp" "$db"; then
    restored=1
  else
    echo "krakenos-helper: no se pudo restaurar la base" >&2
    run_as rm -f -- "$db.restore-tmp" || true
    rc=1
  fi
  if [ "$restored" -eq 0 ]; then
    # El paquete anterior arrancaría sobre una base ya migrada por el nuevo: se deja como está.
    echo "krakenos-helper: no se reinstala el paquete anterior porque la base no se restauró; se reinicia el servicio tal cual" >&2
  elif [ "$installed" != "$ver" ]; then
    echo "krakenos-helper: la versión instalada ($installed) no es la destino ($ver): no se reinstala nada" >&2
  elif [ -n "$prev" ]; then
    if pname="$(pkg_saved_name "$prev" "$fmt")" \
      && pkg_verify "$KRAKENOS_PKG_ROOT_DIR/$prev" "$pname" "$plat" "$prev" --rollback \
      && pkg_install "$fmt" "$KRAKENOS_PKG_ROOT_DIR/$prev/$pname" "$prev" rollback; then
      reinstalled=1
    else
      echo "krakenos-helper: no se pudo reinstalar la versión $prev" >&2
      rc=1
    fi
  fi
  systemctl restart "$KRAKENOS_PKG_UNIT" || { echo "krakenos-helper: no se pudo arrancar el servicio" >&2; rc=1; }
  if [ "$installed" = "$ver" ] && [ -z "$prev" ] && [ "$rc" -eq 0 ]; then
    echo "krakenos-helper: no hay paquete anterior que reinstalar (es la primera actualización por paquete): se restauró la base y se arrancó el servicio, pero la versión instalada no vuelve atrás" >&2
    rm -f -- "$(pkg_state_file)"
    return "$PKG_RC_NO_PREVIOUS"
  fi
  { [ "$rc" -eq 0 ] && { [ "$reinstalled" -eq 1 ] || [ "$installed" != "$ver" ]; }; } && rm -f -- "$(pkg_state_file)"
  return "$rc"
}

cmd="${1:-}"
shift || true

case "$cmd" in
  wg)
    # Solo `wg show|set` y SIEMPRE sobre la interfaz WireGuard configurada.
    sub="${1:-}"
    iface="${2:-}"
    case "$sub" in
      show|set) ;;
      *) deny "wg $sub" ;;
    esac
    [ "$iface" = "$KRAKENOS_WG_IFACE" ] || deny "wg interfaz no permitida: ${iface:-<vacío>}"
    exec wg "$@"
    ;;
  wg-quick)
    # Solo `wg-quick save <iface>` sobre la interfaz WireGuard configurada.
    sub="${1:-}"
    iface="${2:-}"
    [ "$sub" = "save" ] || deny "wg-quick $sub"
    [ "$iface" = "$KRAKENOS_WG_IFACE" ] || deny "wg-quick interfaz no permitida: ${iface:-<vacío>}"
    exec wg-quick "$@"
    ;;
  iptables)
    # Solo operaciones de cadena/regla del firewall (US-19) y SIEMPRE sobre la
    # cadena dedicada o su enlace en FORWARD. Nunca otra tabla que la `filter`.
    op="${1:-}"
    chain="${2:-}"
    case "$op" in
      -N|-F|-A|-D|-C|-L) ;;
      *) deny "iptables $op" ;;
    esac
    for a in "$@"; do
      case "$a" in
        -t|--table) deny "iptables tabla no permitida (solo filter)" ;;
      esac
    done
    if [ "$chain" = "$KRAKENOS_FW_CHAIN" ]; then
      case "$op" in
        -N|-F) [ "$#" -eq 2 ] || deny "iptables $op con argumentos extra" ;;
        -L) { [ "$#" -eq 2 ] || { [ "$#" -eq 3 ] && [ "${3:-}" = "-n" ]; }; } || deny "iptables -L con argumentos extra" ;;
        *) check_iptables_rule "${@:3}" ;;
      esac
      exec iptables "$@"
    elif [ "$chain" = "FORWARD" ]; then
      # En FORWARD solo se admite gestionar el SALTO a nuestra cadena, exacto:
      #   -A|-C|-D FORWARD -j <chain>   (sin reglas extra)
      case "$op" in
        -A|-C|-D) ;;
        *) deny "iptables $op FORWARD" ;;
      esac
      { [ "$#" -eq 4 ] && [ "${3:-}" = "-j" ] && [ "${4:-}" = "$KRAKENOS_FW_CHAIN" ]; } \
        || deny "iptables FORWARD solo admite '-j $KRAKENOS_FW_CHAIN'"
      exec iptables "$@"
    else
      deny "iptables cadena no permitida: ${chain:-<vacío>}"
    fi
    ;;
  tc)
    # Solo objetos qdisc/class/filter del QoS (US-20) y SIEMPRE sobre la interfaz
    # configurada (`dev <iface>`).
    obj="${1:-}"
    case "$obj" in
      qdisc|class|filter) ;;
      *) deny "tc $obj" ;;
    esac
    require_tc_dev "$KRAKENOS_TC_IFACE" "$@"
    check_tc_tokens "$@"
    exec tc "$@"
    ;;
  pkg-update)
    pkg_update "$@"
    ;;
  pkg-rollback)
    pkg_rollback "$@"
    ;;
  *)
    deny "$cmd"
    ;;
esac
