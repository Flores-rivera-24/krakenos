# Instalar KrakenOS con el paquete `.deb` o el de Arch

El paquete `.deb` instala KrakenOS en Debian, Ubuntu y derivados, y el paquete de Arch (`.pkg.tar.zst`)
en Arch Linux y CachyOS, los dos con **su propio Node.js**: no hace falta instalar Node, pnpm ni clonar
el repositorio. Son la alternativa a `scripts/install.sh`. Esta guía está escrita con los comandos de
`apt`; lo que cambia con `pacman` está en [Paquete de Arch](#paquete-de-arch-pacman). Todo lo demás
(dónde vive cada cosa, `/setup`, HTTPS, el helper) vale para los dos.

- Arquitecturas: **amd64** y **arm64**. El archivo se llama `krakenos_<versión>_<arquitectura>.deb`.
- Requiere **systemd**. Sin systemd el paquete se instala, pero no configura HTTPS ni arranca el servicio:
  deja HTTPS pendiente y el mensaje de la instalación dice qué ejecutar cuando haya systemd.
- No hay repositorio apt ni firma del paquete. A partir de la próxima versión, el `.deb` se adjunta a
  la página de versiones del repositorio (ver [Descargar y verificar](#descargar-y-verificar)); mientras
  una versión no lo traiga, se construye desde el repositorio (siguiente apartado) y se instala desde
  el archivo.

## Descargar y verificar

A partir de la próxima versión, cada versión publicada en la página de versiones (*Releases*) del
repositorio trae los dos `.deb` (amd64 y arm64), el paquete de Arch (x86_64) y un archivo `SHA256SUMS`.
Descarga el paquete de tu arquitectura junto con `SHA256SUMS` en la misma carpeta y verifica:

```bash
sha256sum -c --ignore-missing SHA256SUMS
```

Debe decir `OK` para los archivos que descargaste. Es una comprobación de integridad de la descarga,
no una firma: quien controle la página de versiones controla también los dos archivos. Los paquetes
se adjuntan desde la integración continua; la versión se crea como borrador y se publica a mano
después de revisarla.

## Construir el `.deb`

Se construye en una máquina Linux **de la misma arquitectura** que el paquete (no hay compilación
cruzada). Hace falta el repositorio clonado, Node 24.21.0 y pnpm 9 (`pnpm install --frozen-lockfile`),
acceso a internet (se descarga Node y se verifica su firma con `gpgv`) y `dpkg-deb`.

```bash
pnpm package        # deja out/krakenos-<versión>-linux-x64/ (o linux-arm64)
pnpm package:deb out/krakenos-<versión>-linux-x64
```

El segundo comando imprime la ruta del `.deb` resultante, en `out/`.

## Instalar

```bash
sudo apt install ./krakenos_<versión>_amd64.deb
```

(`apt install ./archivo` resuelve las dependencias; `dpkg -i` no lo hace.) Al terminar, en una
instalación nueva el paquete:

1. crea el usuario de servicio `krakenos` y el directorio de datos;
2. configura **HTTPS** (`krakenos-setup tls auto`, ver más abajo);
3. habilita y arranca el servicio `krakenos`;
4. imprime el enlace para crear el administrador.

Los otros programas que usa KrakenOS son **recomendados**, no obligatorios: `ffmpeg` (cámaras),
`avahi-daemon` y `libnss-mdns` (que el nombre `<equipo>.local` resuelva). `sudo`, `wireguard-tools`,
`iptables` e `iproute2` solo hacen falta si activas el helper (ver más abajo).

## Abrir `/setup` y crear el administrador

El primer acceso crea al administrador desde `/setup`, con un token de un solo uso que genera el
servicio. Al final de la instalación se imprime el enlace completo:

```
Abre para crear el administrador: https://<equipo>.local:3001/setup?token=…
```

(Con HTTPS por Tailscale el enlace lleva el nombre `….ts.net`; con `tls none`, `http://localhost:<puerto>`.)

Si no lo viste (o la instalación no se hizo en una terminal), pídelo otra vez:

```bash
sudo krakenos-setup setup-url
```

Espera hasta 30 segundos a que el servicio escriba el token (`--wait N` cambia la espera). Si aún no
hay token, el comando lo dice y remite a `journalctl -u krakenos`. El enlace lleva el token: no lo
compartas. Una **actualización** del paquete no espera ni imprime ese enlace (el token solo existe
mientras no haya administrador): imprime una línea que recuerda este comando.

## Dónde vive cada cosa

| Qué                                                              | Dónde                           |
| ---------------------------------------------------------------- | ------------------------------- |
| Código y Node.js incluido (de root; el servicio no los modifica) | `/usr/lib/krakenos/`            |
| Configuración (variables de entorno)                             | `/etc/krakenos/krakenos.env`    |
| Rutas y modo que fija el paquete (no se editan)                  | `/usr/lib/krakenos/package.env` |
| Certificado y clave HTTPS                                        | `/etc/krakenos/tls/`            |
| Clave de la CA propia (solo si usas HTTPS `local`; solo root)    | `/etc/krakenos/ca/`             |
| Estado: base de datos, claves de firma, datos de integraciones   | `/var/lib/krakenos/`            |
| Unidad de systemd                                                | `krakenos.service`              |
| Usuario de servicio                                              | `krakenos` (sin shell)          |
| Herramienta de administración                                    | `krakenos-setup`                |

`krakenos.env` lo lee systemd como root: el servicio no necesita poder leerlo, y el archivo no es
legible por otros usuarios. La instalación lo crea una sola vez desde la plantilla de referencia
`/usr/share/krakenos/krakenos.env` y no lo vuelve a tocar. Para cambiar un ajuste, edítalo y reinicia:

```bash
sudo nano /etc/krakenos/krakenos.env
sudo systemctl restart krakenos
```

Las rutas del directorio de datos y del helper y el modo de despliegue (`KRAKENOS_DATA_DIR`,
`KRAKENOS_DEPLOY_MODE`, `WG_HELPER_PATH`, `FW_HELPER_PATH`, `TC_HELPER_PATH`) **no** viven ahí: las
fija el paquete en `/usr/lib/krakenos/package.env`, que el servicio carga después de `krakenos.env` y
por eso gana. Aunque las pongas o borres en tu archivo, el servicio sigue usando las del paquete.
`HOST` y `PORT` sí son tuyos.

El archivo no admite comentarios al final de una línea con valor (`PORT=3001  # nota`): systemd los
tomaría como parte del valor. Los comentarios van en su propia línea.

**Si cambias `PORT`**, `WEB_ORIGIN` (y, con HTTPS local o por Tailscale, `WEBAUTHN_ORIGIN`) siguen apuntando al puerto
anterior: las passkeys y el enlace de `/setup` dejarían de coincidir. Con HTTPS local, vuelve a
correr `sudo krakenos-setup tls local` (los reescribe con el puerto nuevo y conserva el certificado y
la CA) y luego reinicia el servicio. Con HTTPS por Tailscale haz lo mismo con
`sudo krakenos-setup tls tailscale`, y con `tls none` ajusta `WEB_ORIGIN` a mano.

El agente **nunca corre como root**. Los registros: `journalctl -u krakenos`.

## HTTPS

KrakenOS sirve por HTTPS por defecto: sin él el navegador no ofrece la app instalable, los avisos
push ni las passkeys. `krakenos-setup tls` acepta cuatro modos:

| Comando                             | Qué hace                                                                                                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sudo krakenos-setup tls auto`      | Usa `tailscale` si Tailscale está instalado y con sesión y MagicDNS; si no, `local`. Es lo que ejecuta la instalación.                                                                                                |
| `sudo krakenos-setup tls tailscale` | Certificado de Let's Encrypt emitido por Tailscale. El nombre queda publicado en los registros públicos de Certificate Transparency (no tu IP ni tus datos). Se renueva solo cada semana.                             |
| `sudo krakenos-setup tls local`     | CA propia de KrakenOS y certificado para `<equipo>.local`. **Cada dispositivo debe instalar una vez el certificado de la CA** (se descarga en `/api/system/ca-cert` o en Ajustes → Conexión segura). Se renueva solo. |
| `sudo krakenos-setup tls none`      | Sin HTTPS: la app instalable, los avisos push y las passkeys **no funcionan**. No quita un HTTPS ya activo: para desactivarlo, pon `HTTPS_ENABLED=false` en `krakenos.env` y reinicia.                                |

Con `--dry-run` imprime lo que haría sin ejecutarlo. Tras cambiar el modo, el comando dice si
reiniciar o habilitar el servicio.

**Ojo:** si Tailscale no está activo (sin sesión o sin MagicDNS) cuando corre `tls auto`, elige `local` y
**cambia el certificado** y la dirección de acceso. Para conservar Tailscale, actívalo antes o usa
`sudo krakenos-setup tls tailscale`.

### Si la instalación no pudo configurar HTTPS

En una instalación nueva, si `krakenos-setup tls auto` falla, el paquete **no arranca ni habilita el
servicio**: serviría HTTP plano y el enlace de `/setup` llevaría el token sin cifrar. El mensaje de
la instalación lo dice. Para terminar, corrige la causa (el mensaje de error de `tls auto` la
nombra) y ejecuta:

```bash
sudo krakenos-setup tls auto && sudo systemctl enable --now krakenos
sudo krakenos-setup setup-url
```

Si de verdad quieres HTTP sin cifrar:

```bash
sudo krakenos-setup tls none && sudo systemctl enable --now krakenos
```

Lo mismo vale si instalaste sin systemd: el paquete dejó HTTPS pendiente y, cuando haya systemd, el
primer comando es el de arriba.

Mientras no termines uno de los dos caminos, el paquete recuerda que HTTPS quedó pendiente y, si
instalas una versión nueva, vuelve a intentar `tls auto` y no arranca sin cifrar. Termina estos pasos
antes de actualizar.

## Helper privilegiado (opcional)

La VPN WireGuard, el firewall y la QoS necesitan operaciones de root. El paquete trae el helper
(`/usr/lib/krakenos/libexec/krakenos-helper`) **inactivo**: nada lo ejecuta hasta que lo activas.

```bash
sudo apt install sudo wireguard-tools iptables iproute2
sudo krakenos-setup --with-helper
```

Esto instala `/etc/sudoers.d/krakenos` (se valida con `visudo` antes de ponerla en su sitio), que
permite al usuario `krakenos` ejecutar **solo** ese helper, con su propia lista de operaciones
permitidas. También crea `/etc/wireguard` si falta y reinicia el servicio (si estaba en marcha), para
que pueda guardar ahí los peers de la VPN. Sin el helper, esas tres funciones no están disponibles.

## Actualizar

Construye (o consigue) el `.deb` nuevo e instálalo encima:

```bash
sudo apt install ./krakenos_<versión nueva>_amd64.deb
```

Los datos, las claves y el certificado se conservan, y el servicio se reinicia solo. **Tu
`/etc/krakenos/krakenos.env` no se toca**: el paquete solo lo crea si no existe y no es un archivo
de configuración de dpkg, así que `apt` no te pregunta nada. Si una versión nueva añade variables,
sin ellas rige su valor por defecto; la plantilla de referencia con todas queda en
`/usr/share/krakenos/krakenos.env`. Una actualización no vuelve a tocar el HTTPS ni los temporizadores
de renovación del certificado, salvo que HTTPS hubiera quedado pendiente de una instalación fallida:
entonces se reintenta (ver «Si la instalación no pudo configurar HTTPS»).

La actualización con un clic de **Ajustes → Sistema → Actualizaciones** **no está disponible** en
una instalación por paquete (ver [Actualizaciones](updates.md)). El aviso de versión nueva es
opcional: para activarlo, añade `UPDATE_CHECK_REPO=Flores-rivera-24/krakenos` a
`/etc/krakenos/krakenos.env` y reinicia el servicio.

## Integraciones y librerías

Los routers por SSH, MQTT/zigbee2mqtt, SNMP y el WebSocket usan `node-ssh`, `mqtt`, `net-snmp` y
`ws`: el paquete **las incluye**, así que esas integraciones funcionan sin instalar nada más.
Solo `tuyapi` (Tuya) y `@matter/main` (puente Matter) siguen siendo opcionales y el paquete
**no las incluye**: hoy no hay una forma soportada de instalarlas en él (el código es de root y el
paquete no trae pnpm).

## Quitar: `remove` frente a `purge`

| Comando                    | Servicio                 | Datos (`/var/lib/krakenos`) y configuración (`/etc/krakenos`)    | Usuario y regla de sudo                        |
| -------------------------- | ------------------------ | ---------------------------------------------------------------- | ---------------------------------------------- |
| `sudo apt remove krakenos` | se para y se deshabilita | **se conservan**                                                 | se conservan                                   |
| `sudo apt purge krakenos`  | se para y se deshabilita | **se borran**, con los certificados y las unidades de renovación | se borran (incluida `/etc/sudoers.d/krakenos`) |

Tras `remove`, volver a instalar el paquete recupera la instalación como estaba. `purge` **no se
puede deshacer**: antes, exporta una copia cifrada desde **Ajustes → Sistema → Copia de seguridad**
y guárdala fuera del servidor (ver [Recuperación](recovery.md)).

## Paquete de Arch (`pacman`)

Para Arch Linux y CachyOS, **x86_64**. No hay repositorio ni AUR. A partir de la próxima versión se adjunta a
la página de versiones (ver [Descargar y verificar](#descargar-y-verificar)); mientras una versión no
lo traiga, se construye desde el repositorio y se instala desde el archivo. El paquete hace lo mismo
que el `.deb` (usuario `krakenos`, HTTPS por defecto, servicio habilitado, enlace de `/setup`, la
misma carpeta de código, datos y configuración) y requiere **systemd**; sin él se instala, deja HTTPS
pendiente y el mensaje dice qué ejecutar.

**Construir.** Hace falta el repositorio clonado, Node 24.21.0, pnpm 9, `base-devel` y acceso a internet.
`makepkg` **no corre como root**:

```bash
pnpm package                                   # deja out/krakenos-<versión>-linux-x64/
pnpm package:arch out/krakenos-<versión>-linux-x64
cd out/krakenos-<versión>-arch
makepkg                                        # deja krakenos-<versión>-1-x86_64.pkg.tar.zst
```

(Una versión de prueba como `0.1.0-rc.1` queda como `0.1.0rc1`: pacman no admite `-` en la versión.)

**Instalar y actualizar** (el mismo comando; el paquete nuevo se instala encima):

```bash
sudo pacman -U krakenos-<versión>-1-x86_64.pkg.tar.zst
```

`pacman -U` resuelve las dependencias (`systemd`, `glibc`, `gcc-libs`, `ca-certificates`) pero **no
instala las opcionales**: `ffmpeg` (cámaras), `nss-mdns` y `avahi` (que `<equipo>.local` resuelva),
`wireguard-tools`, `sudo`, `iptables` e `iproute2` (el helper). Instálalas con `sudo pacman -S …` si las
necesitas. Como en el `.deb`, tu `/etc/krakenos/krakenos.env` no se toca al actualizar: el paquete no lo
trae (lo crea la instalación desde la plantilla), así que pacman no deja `.pacnew`.

**Para que `<equipo>.local` resuelva en Arch** no basta con instalar `avahi` y `nss-mdns`: hay que activar el
demonio y decirle a glibc que consulte mDNS.

```bash
sudo systemctl enable --now avahi-daemon
```

Y en `/etc/nsswitch.conf`, en la línea `hosts:`, añade `mdns_minimal [NOTFOUND=return]` **antes** de `resolve`
y de `dns`, por ejemplo: `hosts: mymachines mdns_minimal [NOTFOUND=return] resolve [!UNAVAIL=return] files myhostname dns`.

**Quitar.** pacman no tiene «purge»:

```bash
sudo pacman -R krakenos      # para el servicio; conserva datos, configuración, usuario y regla de sudo
```

Para borrar **todo** (no se puede deshacer; antes exporta una copia cifrada, ver
[Recuperación](recovery.md)):

```bash
sudo pacman -Rns krakenos
sudo rm -rf /var/lib/krakenos /etc/krakenos
sudo rm -f /etc/sudoers.d/krakenos /etc/systemd/system/krakenos-cert.service /etc/systemd/system/krakenos-cert.timer /etc/systemd/system/krakenos-cert-local.service /etc/systemd/system/krakenos-cert-local.timer
sudo userdel krakenos
sudo groupdel krakenos   # si userdel no lo quitó ya
sudo systemctl daemon-reload
```

## Pasar de `install.sh` al paquete

> **Paso manual.** No está automatizado ni se prueba en la integración continua. Hazlo con calma y
> **con una copia antes**: exporta una copia cifrada desde **Ajustes → Sistema → Copia de seguridad**
> y haz además una copia del directorio `/opt/krakenos/apps/agent` (ver [Recuperación](recovery.md)).

Los datos se copian al directorio del paquete; el árbol viejo no se toca, así que puedes volver
atrás. Supone la instalación por defecto (`/opt/krakenos`, servicio y usuario `krakenos`).

0. **Respalda la unidad y las reglas de sudo viejas**, que están fuera de `/opt/krakenos` y el
   paso 1 borra:

   ```bash
   RESPALDO=~/respaldo-krakenos
   mkdir -p "$RESPALDO"
   sudo cp -a /etc/systemd/system/krakenos*.service /etc/systemd/system/krakenos*.timer "$RESPALDO"/ 2>/dev/null || true
   sudo cp -a /etc/sudoers.d/krakenos /etc/sudoers.d/krakenos-update "$RESPALDO"/ 2>/dev/null || true
   ls "$RESPALDO"
   ```

   (Los archivos que no existan se ignoran: `krakenos-cert*` solo están si usabas HTTPS por
   Tailscale o con CA propia, y `sudoers.d/krakenos` solo si activaste el helper.)

1. **Para y retira el servicio viejo.** Su unidad está en `/etc/systemd/system/krakenos.service` y,
   al llamarse igual, **tiene prioridad sobre la del paquete**: si se queda, el paquete arrancaría el
   código viejo.

   ```bash
   sudo systemctl disable --now krakenos
   sudo rm /etc/systemd/system/krakenos.service
   sudo rm -f /etc/sudoers.d/krakenos-update   # la actualización con un clic no existe en el paquete
   sudo systemctl daemon-reload
   ```

2. **Copia el estado.** Con el servicio parado, la base queda consistente. El usuario `krakenos` ya
   existe y el paquete lo reutiliza.

   ```bash
   OLD=/opt/krakenos/apps/agent
   sudo install -d -o krakenos -g krakenos -m 0750 /var/lib/krakenos
   sudo mkdir -p /var/lib/krakenos/prisma
   sudo cp -a "$OLD"/prisma/*.db* /var/lib/krakenos/prisma/
   sudo cp -a "$OLD"/data "$OLD"/keys /var/lib/krakenos/
   [ -d "$OLD/certs" ] && sudo cp -a "$OLD/certs" /var/lib/krakenos/
   sudo chown -R krakenos: /var/lib/krakenos
   sudo ls -l /var/lib/krakenos/prisma /var/lib/krakenos/keys   # deben estar la base y las claves
   ```

   Solo se copian las bases (`*.db*`), no `prisma/migrations`: el código nuevo trae las suyas. Tampoco
   se copia `var/` (copias previas a migraciones y resultado de actualizaciones del árbol viejo).
   Si la copia de la base falla y sigues, el paquete arranca con una base vacía y pide `/setup`.

3. **Instala el paquete** (ver «Instalar», o «Paquete de Arch»). Si ya tenías HTTPS por `install.sh`, el certificado está
   en la misma ruta, `/etc/krakenos/tls`, y no se reemplaza si ya era de CA propia (si era por
   Tailscale, mira el aviso de la sección de HTTPS). Si tenías `tls none`, el paquete activa HTTPS
   local y cambia `WEB_ORIGIN`: las passkeys registradas con otro origen dejan de servir. Al final,
   la instalación espera 30 segundos y dice que no hay token de configuración: es lo esperado, tu
   administrador ya existe.

4. **Traslada tu configuración.** El `krakenos.env` del paquete es nuevo; el viejo no se copia solo.
   Revisa `/opt/krakenos/apps/agent/.env` y pasa a `/etc/krakenos/krakenos.env` lo que hubieras
   cambiado (`PORT`, `WEB_ORIGIN`, ajustes de TLS, `UPDATE_CHECK_REPO`…). No copies las líneas de
   rutas ni `KRAKENOS_DEPLOY_MODE`: el paquete las fija (aunque las copiaras, no tendrían efecto). Si usabas el helper, actívalo ahora: la
   regla de sudo vieja autoriza `/usr/local/bin/krakenos-helper`, y el paquete usa otra ruta, así que
   hasta entonces la VPN, el firewall y la QoS fallan.

   ```bash
   sudo apt install sudo wireguard-tools iptables iproute2
   sudo krakenos-setup --with-helper
   sudo systemctl restart krakenos
   ```

5. **Comprueba.** El servicio activo (`systemctl is-active krakenos`), entra con tu usuario de
   siempre, y verifica que tus dispositivos, integraciones y copias siguen ahí. Revisa en especial las
   que usaban SSH, MQTT, SNMP o WebSocket: el paquete incluye esas librerías (ver «Integraciones y
   librerías»).

6. **Retira lo viejo** cuando estés seguro: el árbol `/opt/krakenos`, `/usr/local/lib/krakenos` (la
   copia de root de la renovación del certificado local, si existe) y, si usabas el helper,
   `/usr/local/bin/krakenos-helper`.

### Volver atrás (antes del paso 6)

```bash
RESPALDO=~/respaldo-krakenos   # el mismo del paso 0
sudo systemctl disable --now krakenos
sudo apt remove krakenos
sudo cp -a "$RESPALDO"/krakenos*.service "$RESPALDO"/krakenos*.timer /etc/systemd/system/
sudo cp -a "$RESPALDO"/krakenos-update /etc/sudoers.d/
sudo cp -a "$RESPALDO"/krakenos /etc/sudoers.d/   # solo si usabas el helper
sudo systemctl daemon-reload
sudo systemctl enable --now krakenos
# solo los temporizadores de renovación que estaban en el respaldo
for t in krakenos-cert-local.timer krakenos-cert.timer; do
  [ -f "$RESPALDO/$t" ] && sudo systemctl enable --now "$t"
done
```

`/opt/krakenos` sigue intacto, pero lo que se haya guardado en el paquete después de la copia no
vuelve con la reversa. **No uses `apt purge`**: borraría `/etc/krakenos` (el certificado y la CA) y
el usuario `krakenos`, que la instalación vieja sigue usando. Al instalar el paquete, `tls auto`
reescribió las unidades de renovación del certificado para apuntar a `/usr/lib/krakenos` y
`apt remove` las deshabilitó: por eso se restauran de la copia y se vuelven a habilitar.
