# Instalar KrakenOS con el paquete `.deb`

El paquete `.deb` instala KrakenOS en Debian, Ubuntu y derivados con **su propio Node.js**: no hace
falta instalar Node, pnpm ni clonar el repositorio. Es la alternativa a `scripts/install.sh`.

- Arquitecturas: **amd64** y **arm64**. El archivo se llama `krakenos_<versión>_<arquitectura>.deb`.
- Requiere **systemd**. Sin systemd el paquete se instala, pero no arranca el servicio.
- No hay repositorio apt ni firma del paquete: se descarga el `.deb` de la página de versiones del
  proyecto y se instala desde el archivo.

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
`avahi-daemon` y `libnss-mdns` (que el nombre `<equipo>.local` resuelva). `wireguard-tools` y `sudo`
solo hacen falta si activas el helper (ver más abajo).

## Abrir `/setup` y crear el administrador

El primer acceso crea al administrador desde `/setup`, con un token de un solo uso que genera el
servicio. Al final de la instalación se imprime el enlace completo:

```
Abre para crear el administrador: https://<equipo>.local:3001/setup?token=…
```

Si no lo viste (o la instalación no se hizo en una terminal), pídelo otra vez:

```bash
sudo krakenos-setup setup-url
```

Espera hasta 30 segundos a que el servicio escriba el token (`--wait N` cambia la espera). Si aún no
hay token, el comando lo dice y remite a `journalctl -u krakenos`. El enlace lleva el token: no lo
compartas.

## Dónde vive cada cosa

| Qué                                                              | Dónde                        |
| ---------------------------------------------------------------- | ---------------------------- |
| Código y Node.js incluido (de root; el servicio no los modifica) | `/usr/lib/krakenos/`         |
| Configuración (variables de entorno)                             | `/etc/krakenos/krakenos.env` |
| Certificado y clave HTTPS                                        | `/etc/krakenos/tls/`         |
| Clave de la CA propia (solo si usas HTTPS `local`; solo root)    | `/etc/krakenos/ca/`          |
| Estado: base de datos, claves de firma, datos de integraciones   | `/var/lib/krakenos/`         |
| Unidad de systemd                                                | `krakenos.service`           |
| Usuario de servicio                                              | `krakenos` (sin shell)       |
| Herramienta de administración                                    | `krakenos-setup`             |

`krakenos.env` lo lee systemd como root: el servicio no necesita poder leerlo, y el archivo no es
legible por otros usuarios. Para cambiar un ajuste (por ejemplo `PORT`), edítalo y reinicia:

```bash
sudo nano /etc/krakenos/krakenos.env
sudo systemctl restart krakenos
```

El agente **nunca corre como root**. Los registros: `journalctl -u krakenos`.

## HTTPS

KrakenOS sirve por HTTPS por defecto: sin él el navegador no ofrece la app instalable, los avisos
push ni las passkeys. `krakenos-setup tls` acepta cuatro modos:

| Comando                             | Qué hace                                                                                                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sudo krakenos-setup tls auto`      | Usa `tailscale` si Tailscale está instalado y con sesión y MagicDNS; si no, `local`. Es lo que ejecuta la instalación.                                                                                                |
| `sudo krakenos-setup tls tailscale` | Certificado de Let's Encrypt emitido por Tailscale. El nombre queda publicado en los registros públicos de Certificate Transparency (no tu IP ni tus datos). Se renueva solo cada semana.                             |
| `sudo krakenos-setup tls local`     | CA propia de KrakenOS y certificado para `<equipo>.local`. **Cada dispositivo debe instalar una vez el certificado de la CA** (se descarga en `/api/system/ca-cert` o en Ajustes → Conexión segura). Se renueva solo. |
| `sudo krakenos-setup tls none`      | Sin HTTPS: la app instalable, los avisos push y las passkeys **no funcionan**.                                                                                                                                        |

Con `--dry-run` imprime lo que haría sin ejecutarlo. Tras cambiar el modo, el comando dice si
reiniciar o habilitar el servicio.

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

## Helper privilegiado (opcional)

La VPN WireGuard, el firewall y la QoS necesitan operaciones de root. El paquete trae el helper
(`/usr/lib/krakenos/libexec/krakenos-helper`) **inactivo**: nada lo ejecuta hasta que lo activas.

```bash
sudo apt install sudo wireguard-tools
sudo krakenos-setup --with-helper
```

Esto instala `/etc/sudoers.d/krakenos` (se valida con `visudo` antes de ponerla en su sitio), que
permite al usuario `krakenos` ejecutar **solo** ese helper, con su propia lista de operaciones
permitidas. Sin el helper, esas tres funciones no están disponibles.

## Actualizar

Descarga el `.deb` nuevo e instálalo encima:

```bash
sudo apt install ./krakenos_<versión nueva>_amd64.deb
```

Los datos, las claves y el certificado se conservan, y el servicio se reinicia solo. **Un
`/etc/krakenos/krakenos.env` que hayas editado se conserva**: si la versión nueva trajera otro,
`apt` te preguntaría qué hacer. Una actualización no vuelve a tocar el HTTPS ni los temporizadores
de renovación del certificado.

La actualización con un clic de **Ajustes → Sistema → Actualizaciones** **no está disponible** en
una instalación por paquete (ver [Actualizaciones](updates.md)); el aviso de versión nueva sí.

## Quitar: `remove` frente a `purge`

| Comando                    | Servicio                 | Datos (`/var/lib/krakenos`) y configuración (`/etc/krakenos`)    | Usuario y regla de sudo                        |
| -------------------------- | ------------------------ | ---------------------------------------------------------------- | ---------------------------------------------- |
| `sudo apt remove krakenos` | se para y se deshabilita | **se conservan**                                                 | se conservan                                   |
| `sudo apt purge krakenos`  | se para y se deshabilita | **se borran**, con los certificados y las unidades de renovación | se borran (incluida `/etc/sudoers.d/krakenos`) |

Tras `remove`, volver a instalar el paquete recupera la instalación como estaba. `purge` **no se
puede deshacer**: antes, exporta una copia cifrada desde **Ajustes → Sistema → Copia de seguridad**
y guárdala fuera del servidor (ver [Recuperación](recovery.md)).

## Pasar de `install.sh` al paquete

> **Paso manual.** No está automatizado ni se prueba en la integración continua. Hazlo con calma y
> **con una copia antes**: exporta una copia cifrada desde **Ajustes → Sistema → Copia de seguridad**
> y haz además una copia del directorio `/opt/krakenos/apps/agent` (ver [Recuperación](recovery.md)).

Los datos se copian al directorio del paquete; el árbol viejo no se toca, así que puedes volver
atrás. Supone la instalación por defecto (`/opt/krakenos`, servicio y usuario `krakenos`).

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
   ```

   Solo se copian las bases (`*.db*`), no `prisma/migrations`: el código nuevo trae las suyas.

3. **Instala el paquete** (ver «Instalar»). Si ya tenías HTTPS por `install.sh`, el certificado está
   en la misma ruta, `/etc/krakenos/tls`. Si te piden el enlace de `/setup`, ignóralo: tu
   administrador ya existe.

4. **Traslada tu configuración.** El `krakenos.env` del paquete es nuevo; el viejo no se copia solo.
   Revisa `/opt/krakenos/apps/agent/.env` y pasa a `/etc/krakenos/krakenos.env` lo que hubieras
   cambiado (`PORT`, `WEB_ORIGIN`, ajustes de TLS…). No copies las líneas de rutas ni
   `KRAKENOS_DEPLOY_MODE`: el paquete las fija. Después, `sudo systemctl restart krakenos`.

5. **Comprueba.** El servicio activo (`systemctl is-active krakenos`), entra con tu usuario de
   siempre, y verifica que tus dispositivos, integraciones y copias siguen ahí.

6. **Retira lo viejo** cuando estés seguro: el árbol `/opt/krakenos` y, si usabas el helper,
   `/usr/local/bin/krakenos-helper` (el del paquete se activa con
   `sudo krakenos-setup --with-helper`, que reemplaza la regla de sudo vieja).

Si algo sale mal antes del paso 6: `sudo apt remove krakenos`, restaura la unidad vieja desde tu
copia y vuelve a arrancarla; `/opt/krakenos` sigue intacto.
