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
    exec tc "$@"
    ;;
  *)
    deny "$cmd"
    ;;
esac
