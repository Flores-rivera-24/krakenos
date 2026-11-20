# Instalar KrakenOS en una Raspberry Pi

> **Esta guía no se ha probado en una Raspberry Pi real.** Lo que sí se verifica en cada cambio: que el
> paquete `arm64` se construye, pasa `lintian` y su ciclo de vida (instalar, actualizar, desinstalar)
> en un servidor ARM64 de la integración continua, que no es una Pi.

En una Raspberry Pi se instala el mismo paquete `.deb` de `arm64` que en cualquier otro servidor
Debian o Ubuntu. Esta guía solo reúne los pasos; lo compartido (dónde vive cada cosa, HTTPS, el
helper, actualizar y quitar) está en [Instalar con el paquete `.deb` o el de Arch](install-linux-package.md)
y no se repite aquí.

## Requisitos

- Un sistema de **64 bits** (`arm64`, por ejemplo Raspberry Pi OS de 64 bits). No hay paquete de 32 bits.
- **systemd**. Sin él el paquete se instala, pero no configura HTTPS ni arranca el servicio.
- ~1 GB de RAM y ~2 GB de disco libres.
- No hace falta instalar Node: el paquete trae el suyo.

## Pasos

1. Descarga `krakenos_<versión>_arm64.deb` y `SHA256SUMS` de la página de versiones y verifica la suma,
   como en [Descargar y verificar](install-linux-package.md#descargar-y-verificar) (ahí el ejemplo usa
   `amd64`; cambia el nombre del archivo por el de `arm64`).
2. Instala el paquete:

   ```bash
   sudo apt install ./krakenos_<versión>_arm64.deb
   ```

3. Abre el enlace de `/setup` que imprime la instalación y crea el administrador (ver
   [Abrir `/setup` y crear el administrador](install-linux-package.md#abrir-setup-y-crear-el-administrador)).
4. HTTPS se configura durante la instalación; las opciones están en
   [HTTPS](install-linux-package.md#https).
5. Para que el nombre `<equipo>.local` resuelva desde otros equipos hace falta `avahi-daemon` y
   `libnss-mdns`, que el paquete recomienda pero no impone (ver
   [Instalar](install-linux-package.md#instalar)).
6. Para las cámaras hace falta `ffmpeg`, también recomendado (mismo apartado).
7. La VPN, el firewall y la QoS necesitan el helper, que viene inactivo: ver
   [Helper privilegiado](install-linux-package.md#helper-privilegiado-opcional).

## Lo que falta por comprobar

Nada de esto se ha ejecutado en una Pi, así que no se afirma:

- La instalación real del `.deb` en Raspberry Pi OS de 64 bits.
- Que el servicio arranque tras un reinicio sin ninguna sesión abierta.
- Que `<equipo>.local` resuelva con el `avahi` de Raspberry Pi OS.
- Que el helper pueda usar `wg` con el kernel de Raspberry Pi OS.

Tampoco hay mediciones de rendimiento, consumo ni temperatura, ni una recomendación entre tarjeta SD y
disco SSD.
