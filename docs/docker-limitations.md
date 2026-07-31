# Limitaciones en Docker

La imagen oficial de KrakenOS (`ghcr.io/flores-rivera-24/krakenos`) es una imagen
**todo-en-uno, no root y mínima**: contiene el agente Node + la UI y poco más. Por diseño
**no** trae binarios de sistema ni privilegios elevados, así que algunas funciones que
dependen del host **no operan dentro del contenedor**. Esto es intencionado (superficie
pequeña, sin `root`), no un bug.

## Qué NO funciona en la imagen por defecto

El contenedor no incluye `sudo`, `wg`/`wg-quick`, `iptables`, `tc` ni `ffmpeg`, ni tiene las
capacidades de red del host. Por tanto:

| Función | Necesita | Por qué no va en Docker |
|---|---|---|
| **VPN WireGuard** (`VPN_KIND=wireguard`) | `wg`/`wg-quick` + `sudo` + `NET_ADMIN` | No hay helper sudoers ni el binario `wg` en la imagen; gestionar interfaces WG toca la pila de red del host. |
| **Firewall iptables** (`FIREWALL_KIND=iptables`) | `iptables` + `sudo` + `NET_ADMIN` | Sin el binario ni privilegios; las reglas se aplicarían al netns del contenedor, no al host. |
| **QoS tc** (`QOS_KIND=tc`) | `tc` (iproute2) + `sudo` + `NET_ADMIN` | Igual que el firewall: la jerarquía HTB debe vivir en las interfaces reales del host. |
| **Cámaras RTSP** (`CAMERAS_KIND=rtsp`) — vídeo en vivo HLS, movimiento y grabación | `ffmpeg` | El transcodificado RTSP→HLS, los fotogramas de movimiento y la grabación de clips se hacen con `ffmpeg`, que no está en la imagen. |
| **Auto-descubrimiento** (mDNS / SSDP) | Multicast UDP en la LAN del host | El bridge de red de Docker aísla el contenedor del multicast de la LAN, así que no llegan los anuncios de los dispositivos. |

> El resto de integraciones sí funcionan en Docker: drivers de red por SSH/REST (OpenWrt,
> pfSense, UniFi, MikroTik, Cisco…), IoT por API/MQTT local (Hue, Govee, Kasa/Tapo, Shelly,
> Meross, Tuya, zigbee2mqtt, Matter), DNS/Pi-hole por HTTP, copias de seguridad,
> usuarios, automatizaciones, energía, etc. — nada de eso depende de binarios del host.

## Cómo habilitarlas de todas formas

- **Recomendado — instalación bare-metal / systemd.** Instala en el host (Ubuntu/Debian)
  `wireguard-tools`, `iptables`, `iproute2` y `ffmpeg`, instala el **helper sudoers** con su
  allowlist y arranca con `pnpm prod` o el servicio systemd (`krakenos.service.example`). Es la
  vía soportada para VPN, firewall, QoS y cámaras. Ver el README (secciones *Producción → Sin
  Docker* y *Operaciones privilegiadas*).

- **Imagen a medida (avanzado).** Puedes construir una imagen propia que añada los binarios
  (`ffmpeg`, `iproute2`, `wireguard-tools`, `iptables`) y ejecutarla con los privilegios
  necesarios (`--cap-add=NET_ADMIN`, y para descubrimiento `--network=host`). Requiere entender
  las implicaciones de seguridad: das al contenedor control sobre la red del host y elevas su
  superficie. No es la configuración por defecto ni la que se publica en GHCR.

En cualquier caso, KrakenOS **degrada con honestidad**: si un `*_KIND` real está configurado pero
el binario/privilegio no está disponible, la operación falla de forma visible en su módulo en vez
de fingir que funcionó.
