#!/usr/bin/env bash
#
# linux-lifecycle.sh — ciclo de vida de un paquete de KrakenOS (US-287/US-294).
#
#   sudo scripts/package/linux-lifecycle.sh <deb|arch> <paquete-viejo> <paquete-nuevo>
#
# Corre como root en una máquina con systemd (el runner de CI lo tiene). Instala el viejo, crea un
# administrador, edita PORT, actualiza al nuevo, desinstala, reinstala y purga. Cada paso comprueba
# algo observable; sale con ≠0 en el PRIMER fallo diciendo qué paso falló y qué se observó.
#
# El token de setup y la contraseña del administrador de prueba nunca se imprimen: se desactiva
# xtrace aunque se invoque con `bash -x`, y la salida del gestor de paquetes (cuyo postinst
# imprime el enlace de /setup) se filtra antes de mostrarse.
set -euo pipefail
set +x

KIND="${1:-}"
OLD="${2:-}"
NEW="${3:-}"
case "$KIND" in deb | arch) ;; *)
  echo "uso: $0 <deb|arch> <paquete-viejo> <paquete-nuevo>" >&2
  exit 2
  ;; esac
[[ -f $OLD && -f $NEW ]] || { echo "ERROR: no existen los paquetes: $OLD / $NEW" >&2; exit 2; }
[[ $(id -u) -eq 0 ]] || { echo "ERROR: corre como root" >&2; exit 2; }
OLD="$(readlink -f -- "$OLD")"
NEW="$(readlink -f -- "$NEW")"

ENV_FILE=/etc/krakenos/krakenos.env
SETUP=/usr/lib/krakenos/libexec/krakenos-setup
SETUP_HELPER=/usr/lib/krakenos/libexec/krakenos-helper
CERT=/etc/krakenos/tls/agent-cert.pem
WORK="$(mktemp -d)"
[[ -n $WORK && -d $WORK ]] || { echo "ERROR: mktemp falló" >&2; exit 2; }
TOKEN_FILE=/var/lib/krakenos/setup-token
# Si el script muere entre mover el token y restaurarlo, no deja un FIFO en /var/lib/krakenos.
limpiar() {
  rm -rf -- "${WORK:?}"
  # Resto de un paso 0 a medias: un archivo donde debe ir el directorio de TLS.
  [[ -f /etc/krakenos/tls && ! -L /etc/krakenos/tls ]] && rm -f -- /etc/krakenos/tls
  if [[ -e /var/lib/krakenos/setup-token.orig ]]; then
    rm -f -- /var/lib/krakenos/setup-token
    mv -- /var/lib/krakenos/setup-token.orig /var/lib/krakenos/setup-token || true
  fi
}
trap limpiar EXIT
STEP="0"
STEP_TITLE="preparación"

redact() { sed -E 's/(token=)[^[:space:]]+/\1***/g'; }
paso() {
  STEP="$1"
  STEP_TITLE="$2"
  printf '\n=== Paso %s: %s ===\n' "$STEP" "$STEP_TITLE"
}
ok() { printf '  ok: %s\n' "$*"; }
fail() {
  local msg="paso $STEP ($STEP_TITLE): $*"
  printf 'FALLO en el %s\n' "$msg" >&2
  [[ -z ${GITHUB_ACTIONS:-} ]] || printf '::error::ciclo de vida %s\n' "$msg"
  exit 1
}

# --- gestor de paquetes -------------------------------------------------------------------------
pkg_install() { # $1 = fichero; la salida va a $WORK/pkg.log (lleva el enlace de /setup con el token)
  local rc=0
  case "$KIND" in
    # Sin --force-conf*: krakenos.env no es conffile, así que dpkg no debe preguntar nada; si algún
    # día pregunta, sin terminal falla y la CI lo ve.
    deb) DEBIAN_FRONTEND=noninteractive apt-get install -y "$1" > "$WORK/pkg.log" 2>&1 || rc=$? ;;
    arch) pacman -U --noconfirm "$1" > "$WORK/pkg.log" 2>&1 || rc=$? ;;
  esac
  tail -n 6 "$WORK/pkg.log" | redact | sed 's/^/  | /'
  [[ $rc -eq 0 ]] || fail "la instalación de $(basename -- "$1") salió con $rc"
}
pkg_remove() {
  case "$KIND" in
    deb) DEBIAN_FRONTEND=noninteractive apt-get remove -y krakenos > "$WORK/pkg.log" 2>&1 || fail "apt-get remove falló: $(tail -n 5 "$WORK/pkg.log" | redact)" ;;
    arch) pacman -R --noconfirm krakenos > "$WORK/pkg.log" 2>&1 || fail "pacman -R falló: $(tail -n 5 "$WORK/pkg.log" | redact)" ;;
  esac
}
pkg_purge() {
  case "$KIND" in
    deb) DEBIAN_FRONTEND=noninteractive apt-get purge -y krakenos > "$WORK/pkg.log" 2>&1 || fail "apt-get purge falló: $(tail -n 5 "$WORK/pkg.log" | redact)" ;;
    arch)
      # pacman no purga: la documentación del paquete manda borrar los datos y la configuración a mano.
      pacman -Rns --noconfirm krakenos > "$WORK/pkg.log" 2>&1 || fail "pacman -Rns falló: $(tail -n 5 "$WORK/pkg.log" | redact)"
      rm -rf /var/lib/krakenos /etc/krakenos
      ;;
  esac
}

# --- comprobaciones observables ----------------------------------------------------------------
agent_port() { sed -n 's/^PORT=\([0-9]\{1,5\}\).*/\1/p' "$ENV_FILE" | tail -n 1; }
base_url() { # 127.0.0.1 y no WEB_ORIGIN: el nombre .local solo resuelve con avahi
  local scheme=http
  grep -q '^WEB_ORIGIN=https://' "$ENV_FILE" && scheme=https
  printf '%s://127.0.0.1:%s' "$scheme" "$(agent_port || true)"
}
http_code() { # $1 = ruta; opcional $2 = fichero con el cuerpo JSON (POST)
  local data=()
  [[ -z ${2:-} ]] || data=(-X POST -H 'Content-Type: application/json' --data-binary "@$2")
  curl -sk -o "$WORK/body.json" -w '%{http_code}' --max-time 15 "${data[@]}" "$(base_url)$1" || true
}
wait_ready() { # hasta 60 s, sin dormir a ciegas
  local i code=""
  for ((i = 0; i < 60; i++)); do
    code="$(http_code /health/ready)"
    [[ $code == 200 ]] && return 0
    sleep 1
  done
  fail "el servicio no respondió 200 en /health/ready en 60 s (último código: ${code:-ninguno}, URL $(base_url))"
}
active() { systemctl is-active --quiet krakenos; }
need_active() { active || fail "systemctl is-active krakenos = $(systemctl is-active krakenos || true)"; }
# Lo que ve de verdad el proceso del servicio (no lo que dice el archivo): /proc/<pid>/environ.
env_del_servicio() { # $1 = clave
  local pid
  pid="$(systemctl show -p MainPID --value krakenos)"
  [[ $pid =~ ^[1-9][0-9]*$ ]] || fail "krakenos no tiene MainPID (¿no está activo?)"
  tr '\0' '\n' < "/proc/$pid/environ" | sed -n "s/^$1=//p" | tail -n 1
}
claves_del_paquete_intactas() { # $1 = en qué momento se comprueba
  [[ "$(env_del_servicio KRAKENOS_DEPLOY_MODE)" == package ]] || fail "$1: KRAKENOS_DEPLOY_MODE del servicio es '$(env_del_servicio KRAKENOS_DEPLOY_MODE)' (lo pisó krakenos.env)"
  [[ "$(env_del_servicio KRAKENOS_DATA_DIR)" == /var/lib/krakenos ]] || fail "$1: KRAKENOS_DATA_DIR del servicio es '$(env_del_servicio KRAKENOS_DATA_DIR)' (lo pisó krakenos.env)"
  [[ "$(env_del_servicio WG_HELPER_PATH)" == "$SETUP_HELPER" ]] || fail "$1: WG_HELPER_PATH del servicio es '$(env_del_servicio WG_HELPER_PATH)' (lo pisó krakenos.env)"
}
sha() { sha256sum -- "$1" | cut -d' ' -f1; }

# El administrador de prueba: la contraseña vive solo en estos ficheros 0600.
umask 077
PASS="Lc1$(head -c 18 /dev/urandom | od -An -tx1 | tr -d ' \n')"
EMAIL="admin-ciclo@krakenos.test"
printf '{"email":"%s","password":"%s"}\n' "$EMAIL" "$PASS" > "$WORK/login.json"
unset PASS

login() {
  local code
  code="$(http_code /api/auth/login "$WORK/login.json")"
  [[ $code == 200 ]] || fail "POST /api/auth/login devolvió $code (se esperaba 200) en $(base_url)"
}

# Punto de partida limpio: un krakenos instalado antes falsearía todos los pasos.
case "$KIND" in
  deb) ! dpkg -s krakenos > /dev/null 2>&1 || fail "krakenos ya está instalado: purga el paquete antes de correr el ciclo" ;;
  arch) ! pacman -Q krakenos > /dev/null 2>&1 || fail "krakenos ya está instalado: desinstálalo antes de correr el ciclo" ;;
esac

# =================================================================================================
if [[ $KIND == deb ]]; then
  paso 0 "HTTPS que falla: ni instalar ni actualizar arrancan el servicio, y al arreglarlo sí"
  PENDIENTE=/etc/krakenos/.https-pendiente
  sin_arrancar() { # $1 = en qué momento se comprueba
    [[ -f $PENDIENTE ]] || fail "$1: falta el marcador $PENDIENTE tras un tls auto fallido"
    ! active || fail "$1: krakenos está activo aunque HTTPS no se pudo configurar"
    ! systemctl is-enabled --quiet krakenos 2> /dev/null || fail "$1: krakenos quedó habilitado aunque HTTPS no se pudo configurar"
  }
  # Un archivo normal donde `tls auto` necesita el directorio /etc/krakenos/tls lo hace fallar sin
  # tocar openssl ni PATH, y se revierte con rm.
  install -d -m 0755 /etc/krakenos
  : > /etc/krakenos/tls
  pkg_install "$OLD"
  sin_arrancar "instalación nueva"
  ok "instalación nueva con HTTPS roto: marcador presente y servicio parado y sin habilitar"
  pkg_install "$NEW"
  sin_arrancar "actualización"
  ok "actualización con HTTPS roto: sigue sin arrancar (reintentó tls auto por el marcador)"
  rm -f /etc/krakenos/tls
  # Misma versión por encima: apt-get no hace nada, dpkg -i sí corre el postinst (con $2 no vacío).
  DEBIAN_FRONTEND=noninteractive dpkg -i "$NEW" > "$WORK/pkg.log" 2>&1 || fail "dpkg -i falló: $(tail -n 5 "$WORK/pkg.log" | redact)"
  [[ ! -e $PENDIENTE ]] || fail "con HTTPS arreglado el marcador $PENDIENTE sigue ahí"
  need_active
  grep -q '^WEB_ORIGIN=https://' "$ENV_FILE" || fail "tras arreglar HTTPS, WEB_ORIGIN es '$(sed -n 's/^WEB_ORIGIN=//p' "$ENV_FILE" | tail -n 1)' y debería empezar por https://"
  wait_ready
  ok "HTTPS arreglado y reinstalado: marcador borrado, servicio activo y WEB_ORIGIN https"
  # El usuario borra el archivo de entorno: reinstalar lo repone con HTTP, y debe quedar HTTPS otra vez.
  rm -f "$ENV_FILE"
  DEBIAN_FRONTEND=noninteractive dpkg -i "$NEW" > "$WORK/pkg.log" 2>&1 || fail "dpkg -i tras borrar $ENV_FILE falló: $(tail -n 5 "$WORK/pkg.log" | redact)"
  [[ -f $ENV_FILE ]] || fail "reinstalar no repuso $ENV_FILE"
  grep -q '^WEB_ORIGIN=https://' "$ENV_FILE" || fail "con el archivo de entorno repuesto, WEB_ORIGIN es '$(sed -n 's/^WEB_ORIGIN=//p' "$ENV_FILE" | tail -n 1)' y debería empezar por https:// (arrancó sin cifrar)"
  [[ ! -e $PENDIENTE ]] || fail "con el archivo de entorno repuesto y HTTPS configurado, el marcador $PENDIENTE sigue ahí"
  need_active
  wait_ready
  ok "archivo de entorno repuesto: HTTPS reconfigurado, sin marcador y servicio activo"
  pkg_purge
  [[ ! -e /etc/krakenos ]] || fail "/etc/krakenos sigue existiendo tras purgar"
  ok "purgado antes del ciclo principal"
fi

# =================================================================================================
paso 1 "instalar el paquete viejo ($(basename -- "$OLD"))"
pkg_install "$OLD"
if ! active; then
  # Ruling 14: si `tls auto` falla en una instalación nueva, el postinst no arranca ni habilita el servicio.
  if grep -q 'krakenos-setup tls auto' "$WORK/pkg.log"; then
    fail "el postinst no pudo configurar HTTPS (krakenos-setup tls auto falló) y dejó el servicio sin arrancar"
  fi
  fail "systemctl is-active krakenos = $(systemctl is-active krakenos || true) tras instalar"
fi
ok "krakenos activo"
grep -q '^WEB_ORIGIN=https://' "$ENV_FILE" || fail "HTTPS por defecto: WEB_ORIGIN en $ENV_FILE es '$(sed -n 's/^WEB_ORIGIN=//p' "$ENV_FILE" | tail -n 1)' y debería empezar por https://"
ok "WEB_ORIGIN es https (HTTPS por defecto)"
wait_ready
ok "/health/ready = 200 en $(base_url)"
getent passwd krakenos > /dev/null || fail "no existe el usuario krakenos"
[[ -d /var/lib/krakenos && -f $ENV_FILE && -x /usr/lib/krakenos/bin/krakenos ]] || fail "faltan /var/lib/krakenos, $ENV_FILE o /usr/lib/krakenos/bin/krakenos"
ok "usuario, datos, configuración y binario presentes"
CERT_SHA_1="$(sha "$CERT")" || fail "no existe $CERT: el postinst no dejó el certificado"
ok "certificado local emitido"

# =================================================================================================
paso 2 "crear el administrador y entrar"
# (a) un FIFO en lugar del token no cuelga la lectura de root y no deja un `head` huérfano.
[[ -f $TOKEN_FILE ]] || fail "no existe $TOKEN_FILE tras el primer arranque"
runuser -u krakenos -- mv -- "$TOKEN_FILE" "$TOKEN_FILE.orig"
runuser -u krakenos -- mkfifo "$TOKEN_FILE"
t0=$SECONDS
"$SETUP" setup-url --wait 3 > "$WORK/fifo.out" 2> "$WORK/fifo.err" || true
((SECONDS - t0 < 15)) || fail "setup-url tardó $((SECONDS - t0)) s con un FIFO en el lugar del token (se esperaba < 15)"
grep -q 'setup?token=' "$WORK/fifo.out" && fail "setup-url imprimió una URL de setup leyendo un FIFO"
! pgrep -x head > /dev/null || fail "quedó un proceso head huérfano tras leer un FIFO"
runuser -u krakenos -- rm -f -- "$TOKEN_FILE"
runuser -u krakenos -- mv -- "$TOKEN_FILE.orig" "$TOKEN_FILE"
ok "un FIFO en lugar del token se rechaza sin colgar ni dejar procesos"
# Lectura real como root: pasa por la rama runuser de leer_token.
URL="$("$SETUP" setup-url --wait 5 2> /dev/null || true)"
TOKEN="$(printf '%s' "$URL" | sed -n 's/.*[?&]token=\([A-Za-z0-9._~-]\{1,\}\).*/\1/p')"
unset URL
[[ -n $TOKEN ]] || fail "krakenos-setup setup-url no devolvió un enlace con token (¿falla la rama runuser de leer_token?)"
! pgrep -x head > /dev/null || fail "quedó un proceso head huérfano tras setup-url"
printf '{"homeName":"Casa de prueba","email":"%s","displayName":"Admin ciclo","password":%s,"setupToken":"%s"}\n' \
  "$EMAIL" "$(sed -n 's/.*"password":\("[^"]*"\).*/\1/p' "$WORK/login.json")" "$TOKEN" > "$WORK/init.json"
unset TOKEN
code="$(http_code /api/setup/init "$WORK/init.json")"
rm -f -- "$WORK/init.json"
[[ $code == 200 ]] || fail "POST /api/setup/init devolvió $code (se esperaba 200)"
ok "administrador creado (setup/init = 200)"
login
ok "POST /api/auth/login = 200"

# =================================================================================================
paso 3 "editar PORT en $ENV_FILE y reiniciar"
OLD_PORT="$(agent_port)"
NEW_PORT=3107
[[ $OLD_PORT != "$NEW_PORT" ]] || NEW_PORT=3108
sed -i "s/^PORT=.*/PORT=$NEW_PORT/" "$ENV_FILE"
printf '# editado por linux-lifecycle\n' >> "$ENV_FILE"
# El usuario cambia a mano las claves que fija el paquete: no deben llegar al servicio (package.env gana).
printf 'KRAKENOS_DEPLOY_MODE=git\nKRAKENOS_DATA_DIR=/tmp/otro-sitio\nWG_HELPER_PATH=/tmp/otro-helper\n' >> "$ENV_FILE"
[[ "$(agent_port)" == "$NEW_PORT" ]] || fail "no se pudo editar PORT en $ENV_FILE"
systemctl restart krakenos || fail "systemctl restart krakenos falló"
need_active
wait_ready
ok "el servicio responde en el puerto $NEW_PORT (antes $OLD_PORT)"
claves_del_paquete_intactas "tras editar krakenos.env"
ok "las claves que fija el paquete no cambian aunque krakenos.env diga otra cosa"
login
ok "login = 200 en $NEW_PORT"

# =================================================================================================
paso 4 "instalar el paquete nuevo encima ($(basename -- "$NEW"))"
# El usuario deshabilita a propósito el timer de renovación: una actualización no debe tocarlo.
if [[ -f /etc/systemd/system/krakenos-cert-local.timer ]]; then
  systemctl disable --now krakenos-cert-local.timer > /dev/null 2>&1 || fail "no se pudo deshabilitar krakenos-cert-local.timer a mano"
fi
pkg_install "$NEW"
need_active
if [[ -f /etc/systemd/system/krakenos-cert-local.timer ]]; then
  ! systemctl is-enabled --quiet krakenos-cert-local.timer || fail "la actualización rehabilitó krakenos-cert-local.timer que el usuario había deshabilitado"
  ok "una actualización no toca un timer deshabilitado a mano"
fi
[[ "$(agent_port)" == "$NEW_PORT" ]] || fail "PORT quedó en '$(agent_port)' tras actualizar (se esperaba $NEW_PORT): el paquete pisó krakenos.env"
grep -q '^# editado por linux-lifecycle$' "$ENV_FILE" || fail "krakenos.env perdió la edición del usuario al actualizar"
ok "krakenos.env conserva la edición del usuario (PORT=$NEW_PORT)"
wait_ready
ok "el servicio responde en $NEW_PORT tras actualizar"
claves_del_paquete_intactas "tras actualizar"
login
ok "login = 200 tras actualizar (los datos sobreviven)"
[[ "$(sha "$CERT")" == "$CERT_SHA_1" ]] || fail "actualizar regeneró el certificado TLS"
ok "el certificado no cambió al actualizar"

# =================================================================================================
paso 5 "desinstalar (remove) y reinstalar sin purgar"
pkg_remove
! active || fail "krakenos sigue activo tras desinstalar"
[[ -d /var/lib/krakenos ]] || fail "desinstalar borró /var/lib/krakenos (solo purge debe hacerlo)"
[[ ! -e /usr/lib/krakenos ]] || fail "/usr/lib/krakenos sigue existiendo tras desinstalar"
[[ -f $ENV_FILE ]] || fail "desinstalar borró $ENV_FILE (lo crea el postinst y solo purge debe borrarlo)"
ok "servicio parado; datos y configuración conservados; código retirado"
# (c) los enlaces *.wants de la unidad y de los timers no quedan colgando.
colgando="$(find /etc/systemd/system -xtype l -name 'krakenos*' 2> /dev/null || true)"
[[ -z $colgando ]] || fail "enlaces de systemd colgando tras desinstalar: $colgando"
ok "sin enlaces *.wants colgando"
pkg_install "$NEW"
need_active
wait_ready
login
ok "reinstalado sin purgar: servicio activo y login = 200 con los datos de antes"
[[ "$(sha "$CERT")" == "$CERT_SHA_1" ]] || fail "reinstalar sin purgar regeneró el certificado TLS"
ok "el certificado no cambió tras remove + install"
# (c) (antes de volver a llamar a tls auto, que lo habilitaría) el timer de renovación sigue habilitado solo por reinstalar tras remove + install.
if [[ -f /etc/systemd/system/krakenos-cert-local.timer ]]; then
  systemctl is-enabled --quiet krakenos-cert-local.timer || fail "krakenos-cert-local.timer quedó deshabilitado tras remove + install: el certificado dejaría de renovarse"
  ok "el timer de renovación del certificado sigue habilitado"
fi
# (b) `tls auto` a mano también es idempotente: no regenera la CA ni el certificado.
CA_SHA="$(sha /etc/krakenos/ca/krakenos-ca-key.pem)" || fail "no existe la clave de la CA"
"$SETUP" tls auto > "$WORK/tls.log" 2>&1 || fail "krakenos-setup tls auto falló en un sistema ya configurado: $(tail -n 3 "$WORK/tls.log")"
[[ "$(sha "$CERT")" == "$CERT_SHA_1" ]] || fail "krakenos-setup tls auto regeneró el certificado"
[[ "$(sha /etc/krakenos/ca/krakenos-ca-key.pem)" == "$CA_SHA" ]] || fail "krakenos-setup tls auto regeneró la clave de la CA"
ok "tls auto repetido conserva certificado y CA"

# =================================================================================================
paso 6 "purgar"
pkg_purge
for d in /usr/lib/krakenos /var/lib/krakenos /etc/krakenos; do
  [[ ! -e $d ]] || fail "$d sigue existiendo tras purgar"
done
! systemctl cat krakenos.service > /dev/null 2>&1 || fail "la unidad krakenos.service sigue instalada tras purgar"
[[ -z "$(getent passwd krakenos || true)" ]] || fail "el usuario krakenos sigue existiendo tras purgar"
[[ -z "$(getent group krakenos || true)" ]] || fail "el grupo krakenos sigue existiendo tras purgar"
sobras="$(find /etc/systemd /etc/sudoers.d -name 'krakenos*' 2> /dev/null || true)"
[[ -z $sobras ]] || fail "quedan ficheros de KrakenOS en /etc/systemd o /etc/sudoers.d: $sobras"
ok "sin código, datos, configuración, unidad, usuario ni grupo"

printf '\nCICLO DE VIDA %s: todos los pasos en verde\n' "$KIND"
