# KrakenOS

[![CI](https://github.com/Flores-rivera-24/krakenos/actions/workflows/ci.yml/badge.svg)](https://github.com/Flores-rivera-24/krakenos/actions/workflows/ci.yml)
[![Licencia: AGPL v3](https://img.shields.io/badge/licencia-AGPL--3.0--or--later-blue.svg)](LICENSE)

**KrakenOS es el cerebro de red del hogar.** Reúne en una sola aplicación local la cobertura WiFi sobre
el plano de la casa, el control parental de red, la presencia, el bienestar digital y la seguridad de
red (inventario, DNS, VLAN, QoS, cortafuegos y VPN). Corre en un servidor propio —una Raspberry Pi o
un mini PC— sin servicios de nube de terceros, y el acceso remoto va por una VPN WireGuard que
gestiona el propio sistema: ningún puerto de la interfaz queda expuesto a internet.

KrakenOS complementa a Home Assistant, no lo sustituye ([posicionamiento](docs/adr-positioning.md)).

## Funciones

- **Cobertura WiFi y planos.** Mapa de calor sobre el plano real de la casa, importado desde una foto,
  un PDF o un documento de Word, con detección asistida de paredes.
- **Control parental de red.** Horarios de acceso por dispositivo y pausa de internet de un toque, con
  reanudación automática.
- **Presencia y modos del hogar.** Llegadas y salidas por WiFi, sin geovallas en la nube, y modos
  (en casa, fuera, noche) que disparan automatizaciones.
- **Bienestar digital.** Uso de internet por persona, con privacidad por rol.
- **Seguridad de red.** Inventario en tiempo real, bloqueo, VPN WireGuard con QR, cortafuegos, VLAN,
  QoS y filtrado DNS por categorías. Un mismo código para OpenWrt, pfSense, UniFi, MikroTik, Omada y
  ASUS.
- **Hogar inteligente.** Luces, enchufes y sensores en una sola interfaz; habitaciones, escenas,
  horarios, automatizaciones y medición de energía con coste estimado.
- **Cámaras.** Vídeo en vivo, detección de movimiento, grabación de clips y modo alarma con PIN. Para
  detección de objetos y NVR, integra [Frigate](docs/frigate-setup.md).
- **Interoperabilidad.** Puente Matter hacia Alexa, Google y Apple en la red local; publicación por
  MQTT para Home Assistant y Node-RED; alta automática de lo que se anuncia por MQTT Discovery
  (ESPHome, Tasmota, zigbee2mqtt…).
- **Operación.** Asistente de conexión con prueba en vivo, roles del hogar, 2FA con passkeys, copias
  de seguridad cifradas, alertas por push, correo o Telegram, e interfaz en español e inglés.

### Lo que no es

- **No sustituye a Home Assistant:** no persigue su amplitud de integraciones; convive con él.
- **No es un NVR profesional:** para detección por objetos y grabación continua, Frigate.
- **No es una alarma certificada:** sin batería de respaldo ni central receptora.
- **No depende de la nube:** sin telemetría por defecto; los datos no salen de la red de la casa.

## KrakenOS y Home Assistant

|                                   | Home Assistant         | KrakenOS                             |
| --------------------------------- | ---------------------- | ------------------------------------ |
| Integraciones IoT                 | **~2.800**             | las esenciales, guiadas              |
| Cobertura WiFi sobre el plano     | —                      | **✓**                                |
| Control parental de red           | parcial (complementos) | **✓** por dispositivo y horario      |
| Presencia y bienestar por persona | rastreadores           | **✓** WiFi local, privacidad por rol |
| Seguridad de red                  | parcial                | **✓** integrada                      |
| Automatizaciones avanzadas        | **✓✓**                 | básicas                              |

KrakenOS publica el estado del hogar en un broker MQTT local que Home Assistant descubre solo, y añade
entidades que este no tiene: internet bloqueado por dispositivo, peor señal WiFi por habitación y
«pausar internet 30 min». Publicar, aceptar órdenes y permitir pausas son tres permisos separados,
desactivados por defecto. Detalle en [`docs/interop.md`](docs/interop.md).

## Instalación

**Requisitos del servidor:** Linux en x86-64 o ARM64, ~1 GB de RAM y ~2 GB de disco. La VPN, el
cortafuegos y el QoS necesitan `wireguard-tools`, `iptables` e `iproute2`; las cámaras, `ffmpeg`.

### Instalador (Debian, Ubuntu, Raspberry Pi OS)

```bash
curl -fsSL https://raw.githubusercontent.com/Flores-rivera-24/krakenos/main/scripts/install.sh \
  | sudo bash -s -- --with-all
```

Instala Node y pnpm en versiones fijadas, descarga la última versión publicada, crea el servicio
systemd y muestra una URL con QR para crear el administrador. Es idempotente: volver a ejecutarlo
actualiza sin tocar la configuración, las claves ni los datos.

| Bandera         | Habilita                                           |
| --------------- | -------------------------------------------------- |
| `--with-helper` | VPN WireGuard, cortafuegos y QoS (helper con sudo) |
| `--with-ffmpeg` | cámaras RTSP                                       |
| `--with-all`    | las dos anteriores                                 |

HTTPS va activado por defecto (`--tls auto`): con Tailscale, certificado de Let's Encrypt; sin él, una
CA local cuyo certificado se instala una vez en cada dispositivo. `--tls none` instala sobre HTTP,
pero sin HTTPS no funcionan la app instalable, las notificaciones push ni las passkeys.

```bash
sudo bash /opt/krakenos/scripts/install.sh --update      # actualizar, con vuelta atrás si falla
sudo bash /opt/krakenos/scripts/install.sh --uninstall   # desinstalar (conserva los datos)
```

Más en [`docs/updates.md`](docs/updates.md) y [`docs/recovery.md`](docs/recovery.md).

### Paquetes y portables de Linux

Paquetes con su propio Node, sin `git` ni pnpm en el servidor. A partir de la próxima versión se
adjuntan a la página de versiones, con `SHA256SUMS`; mientras tanto, se construyen desde este
repositorio.

| Sistema                   | Arquitectura  | Archivo                                 | Guía                                                                    |
| ------------------------- | ------------- | --------------------------------------- | ----------------------------------------------------------------------- |
| Debian, Ubuntu            | amd64 y arm64 | `krakenos_<versión>_<arq>.deb`          | [`install-linux-package.md`](docs/install-linux-package.md)             |
| Arch, CachyOS             | x86_64        | `krakenos-<versión>-*.pkg.tar.zst`      | [Paquete de Arch](docs/install-linux-package.md#paquete-de-arch-pacman) |
| Cualquier Linux (carpeta) | x64 y arm64   | `krakenos-<versión>-linux-<arq>.tar.gz` | [Paquete portable](#paquete-portable-carpeta)                           |

**Raspberry Pi:** guía en [`docs/install-raspberry-pi.md`](docs/install-raspberry-pi.md) (aún sin
verificar en hardware real).

### Windows

Instalador `KrakenOS-Setup-<versión>-x64.exe` (Windows x64), sin firmar: instala el servicio y la ventana
de escritorio. Guía, con el aviso de SmartScreen: [`docs/install-windows.md`](docs/install-windows.md)
(aún sin verificar en un equipo real). Sin servidor VPN, cortafuegos ni QoS propios, y sin
actualización automática.

### Paquete portable (carpeta)

Para probar KrakenOS sin instalar nada como administrador (solo Linux, por ahora):

1. Descomprime el `.tar.gz` de tu arquitectura y ejecuta `bin/krakenos`.
2. Los datos (`.env`, claves y base de datos) van **fuera** de la carpeta: en `KRAKENOS_DATA_DIR`, por
   defecto `~/.local/share/krakenos` (o `$XDG_DATA_HOME/krakenos` si lo tienes definido).
3. Se actualiza **reemplazando la carpeta** por la de la versión nueva: los datos se conservan.
4. No se actualiza desde la app: no tiene el helper de administrador ni gestor de paquetes.
5. Su integridad se comprueba con `SHA256SUMS` (detecta descargas rotas; no es una firma).

### Docker (evaluación)

```bash
docker compose up -d
docker compose logs krakenos   # URL con QR para crear el administrador
```

Imagen única (API e interfaz en `:3001`), sin privilegios y con el estado en el volumen
`krakenos-data`; también está publicada en `ghcr.io/flores-rivera-24/krakenos`. Dentro del contenedor
no funcionan la VPN, el cortafuegos, el QoS, las cámaras RTSP ni el descubrimiento por mDNS y SSDP
([limitaciones](docs/docker-limitations.md)).

### Instalación manual

En otros sistemas, o para controlar cada paso:

```bash
pnpm prod   # dependencias, claves, build, migraciones y arranque (API e interfaz en :3001)
```

- **Servicio:** `apps/agent/scripts/krakenos.service.example` (instrucciones en su cabecera), y
  `systemctl enable --now krakenos`.
- **Operaciones privilegiadas:** WireGuard, iptables y tc nunca se ejecutan desde el agente; pasan por
  un helper con lista de órdenes permitidas:

  ```bash
  sudo install -m 0755 apps/agent/scripts/krakenos-helper.sh /usr/local/bin/krakenos-helper
  sudo install -m 0440 apps/agent/scripts/krakenos.sudoers.example /etc/sudoers.d/krakenos
  ```

- **HTTPS:** `cd apps/agent && pnpm ca:local` y `HTTPS_ENABLED=true` en `.env`.

Para abrir KrakenOS como aplicación de escritorio, instala la interfaz como app desde Edge o Chrome
([opciones y límites](docs/adr-app-escritorio.md)). Acceso desde fuera de casa:
[`docs/remote-access.md`](docs/remote-access.md).

## Conectar dispositivos

Desde la app: **Conectar** (`/connect`) guía cada integración, prueba la conexión y la aplica en
caliente; las credenciales se guardan cifradas. Para automatizar, cada dominio se elige también con una
variable `*_KIND` en `apps/agent/.env` (por defecto `mock`, que funciona sin hardware); las variables de
cada integración están documentadas en `apps/agent/.env.example`.

| Dominio      | `*_KIND`                                                                                   | Guías                                                                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Router / red | `DRIVER_KIND`: `openwrt`, `pfsense`, `unifi`, `mikrotik`, `omada`, `asus`                  | [OpenWrt](docs/openwrt-ax21-setup.md) · [UniFi](docs/unifi-setup.md) · [MikroTik](docs/mikrotik-setup.md) · [Omada](docs/omada-setup.md) · [ASUS](docs/asus-setup.md)                                                                          |
| IoT          | `IOT_KIND`: `mqtt`, `zigbee`, `matter`, `hue`, `govee`, `tuya`, `kasa`, `shelly`, `meross` | [MQTT Discovery](docs/mqtt-discovery-setup.md) · [Hue](docs/hue-setup.md) · [Govee](docs/govee-setup.md) · [Tuya](docs/tuya-setup.md) · [Kasa/Tapo](docs/kasa-tapo-setup.md) · [Shelly](docs/shelly-setup.md) · [Meross](docs/meross-setup.md) |
| VPN          | `VPN_KIND=wireguard`                                                                       | requiere el helper                                                                                                                                                                                                                             |
| Cortafuegos  | `FIREWALL_KIND=iptables`                                                                   | requiere el helper                                                                                                                                                                                                                             |
| QoS          | `QOS_KIND=tc`                                                                              | requiere el helper                                                                                                                                                                                                                             |
| DNS          | `DNS_KIND=pihole`                                                                          | Pi-hole v6                                                                                                                                                                                                                                     |
| VLAN         | `VLAN_KIND=switch`                                                                         | cualquier switch con SNMP (802.1Q)                                                                                                                                                                                                             |
| Cámaras      | `CAMERAS_KIND`: `rtsp`, `frigate`                                                          | [Frigate](docs/frigate-setup.md)                                                                                                                                                                                                               |

`IOT_KIND` admite una lista para combinar ecosistemas (`hue,govee,kasa`;
[detalle](docs/composite-iot-setup.md)). pfSense no gestiona WiFi. Tuya necesita además `tuyapi`
instalado en el servidor; el resto de las integraciones no requiere dependencias adicionales.

## Desarrollo

Requisitos: Node.js 24 y pnpm 9.

```bash
pnpm install
cd apps/agent && cp .env.example .env && pnpm keys:gen
pnpm prisma:migrate && pnpm db:seed   # admin@krakenos.local / changeme123 (opcional)
cd ../.. && pnpm dev                  # agente en :3001 y web en :5173
```

Sin `db:seed`, la primera visita abre el asistente `/setup` para crear el administrador.

| Ruta             | Contenido                                                |
| ---------------- | -------------------------------------------------------- |
| `apps/agent`     | agente local: Fastify 5, Prisma, SQLite, Socket.io       |
| `apps/web`       | interfaz: React 19, Vite, Tailwind 4, shadcn/ui, Zustand |
| `apps/window`    | ventana de escritorio para Windows (Tauri 2)             |
| `packages/types` | tipos compartidos (`@krakenos/types`)                    |
| `e2e`            | pruebas de extremo a extremo con Playwright              |

```bash
pnpm test          # Vitest, agente y web
pnpm typecheck
pnpm lint
pnpm format        # la CI comprueba el formato con pnpm format:check
```

La CI ejecuta en cada cambio lint, tipos, build, tests con cobertura, la suite en Windows, presupuesto
de bundle, e2e, construcción de los paquetes, prueba del instalador en un Debian limpio, auditoría de
dependencias (OSV), detección de secretos (gitleaks) y análisis estático (semgrep y CodeQL). Más en
[`docs/qa.md`](docs/qa.md) y [`docs/e2e.md`](docs/e2e.md).

### Arquitectura

- Los **drivers** son adaptadores intercambiables detrás de la interfaz `HardwareDriver`; VPN, IoT,
  cámaras, cortafuegos, VLAN, QoS y DNS siguen el mismo patrón, con una implementación `mock` para
  desarrollar sin hardware.
- La configuración hecha desde la interfaz se guarda en la base de datos, cifrada, prevalece sobre
  `.env` y se recarga sin reiniciar.
- El agente **no corre como root**: lo privilegiado pasa por el helper.
- Toda petición saliente pasa por una política de egress común.

Modelo de amenazas en [`docs/threat-model.md`](docs/threat-model.md).

## Licencia

Copyright © 2026 Jose Luis Flores. Publicado bajo la
[GNU Affero General Public License v3.0 o posterior](LICENSE) (`AGPL-3.0-or-later`).

- **Uso doméstico sin obligaciones.** El copyleft solo aplica si se distribuye el programa o se ofrece
  una versión modificada a otras personas a través de la red.
- **Libre para estudiar, modificar y compartir.** Quien distribuya su versión, o la ofrezca por red,
  debe publicar su código bajo la misma licencia (§13 de la AGPL).
- **La app lo cumple de serie:** Ajustes → Sistema → _Acerca de_ muestra la licencia y el enlace al
  código fuente a cualquier usuario.

Las dependencias de terceros conservan sus licencias, todas compatibles con la AGPL. Razones y
alcance de la elección en el [ADR de licencia](docs/adr-licencia.md).
