#!/usr/bin/env bash
#
# krakenos-helper — helper privilegiado de KrakenOS.
#
# El agente corre SIN privilegios y delega las operaciones de red privilegiadas
# en este helper, invocado vía `sudo -n`. La allowlist de abajo es la única
# superficie con permisos de root: solo se permite un subconjunto acotado de
# `wg` y `wg-quick`. Cualquier otra cosa se rechaza con código 64.
#
# Instalación:
#   sudo install -m 0755 krakenos-helper.sh /usr/local/bin/krakenos-helper
#   sudo install -m 0440 krakenos.sudoers.example /etc/sudoers.d/krakenos
#
set -euo pipefail

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

cmd="${1:-}"
shift || true

case "$cmd" in
  wg)
    sub="${1:-}"
    case "$sub" in
      show|set) exec wg "$@" ;;
      *) deny "wg $sub" ;;
    esac
    ;;
  wg-quick)
    sub="${1:-}"
    case "$sub" in
      save) exec wg-quick "$@" ;;
      *) deny "wg-quick $sub" ;;
    esac
    ;;
  iptables)
    # Solo operaciones de cadena/regla usadas por el firewall (US-19).
    op="${1:-}"
    case "$op" in
      -N|-F|-A|-D|-C|-L) exec iptables "$@" ;;
      *) deny "iptables $op" ;;
    esac
    ;;
  tc)
    # Solo objetos qdisc/class/filter usados por el QoS (US-20).
    obj="${1:-}"
    case "$obj" in
      qdisc|class|filter) exec tc "$@" ;;
      *) deny "tc $obj" ;;
    esac
    ;;
  *)
    deny "$cmd"
    ;;
esac
