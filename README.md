# KrakenOS

[![CI](https://github.com/Flores-rivera-24/krakenos/actions/workflows/ci.yml/badge.svg)](https://github.com/Flores-rivera-24/krakenos/actions/workflows/ci.yml)

Plataforma de gestión de red doméstica e IoT que corre **en un servidor local propio**
(Raspberry Pi, mini PC) sin nube de terceros, y se accede de forma remota vía VPN
WireGuard que el propio sistema gestiona. Ningún puerto de la UI queda expuesto a internet.

> Todo arranca en modo **`mock`** (sin hardware), así que puedes clonar, correr y explorar
> la app entera en desarrollo. Las integraciones reales se conectan **desde la propia app**
> con un asistente guiado paso a paso (o por variable de entorno, para automatizar).
> → [Conectar dispositivos reales](#conectar-dispositivos-reales)

---

## Qué es

- **Inventario en tiempo real** de los dispositivos de tu red (descubrimiento ARP/mDNS,
  identificación por OUI, bloqueo, edición).
- **Control de red**: WiFi, VPN WireGuard (con QR), firewall, VLANs, QoS y DNS/bloqueo (con
  **feeds de categoría**: publicidad, malware, rastreo).
- **Control IoT** unificado: luces, enchufes, sensores y cámaras desde una sola interfaz.
- **Arquitectura por drivers**: el mismo código funciona con distintas marcas de hardware
  (OpenWrt, pfSense, UniFi, MikroTik, Cisco…) sin tocar la API ni el frontend.
- **Hogar inteligente**: **habitaciones** para agrupar dispositivos, **favoritos** de acceso
  rápido, **escenas** (varios aparatos con un toque), **horarios IoT** (por hora o por evento
  solar) y **automatizaciones** por frases ("si… entonces…").
- **Cobertura WiFi**: mapa de calor (heatmap RF) sobre el plano de tu casa, con **importación del
  plano desde una foto, un PDF o un Word** y detección de paredes.
- **Cámaras**: **vídeo en vivo** (HLS), **detección de movimiento** con aviso y foto,
  **grabación** de clips con línea de tiempo y **modo alarma** del hogar (armar/desarmar con PIN).
- **Energía**: medición de consumo (W/kWh), panel con histórico y **coste estimado**, con alertas
  por potencia sostenida o consumo diario.
- **Presencia y modos del hogar**: llegada/salida de personas y modos (en casa / fuera) que
  disparan automatizaciones.
- **Ecosistemas y voz**: **puente Matter** para exponer tus dispositivos a Alexa / Google / Apple,
  comisionado de dispositivos Matter desde la app, y **tokens de API + MQTT** para interoperar con
  otros sistemas.
- **Conexión guiada desde la app**: un asistente paso a paso conecta routers, luces, enchufes
  y cámaras **sin editar ficheros ni leer documentación externa** — con guías internalizadas,
  ayuda en cada campo, prueba de conexión y recarga en caliente. Los secretos se **cifran en reposo**.
- **Multi-usuario y roles**: da acceso a tu familia o a tu equipo — varios usuarios con rol
  **admin** (gestiona todo) o **solo lectura**, con alta, edición, activar/deshabilitar, reset y
  cambio de contraseña propio, desde **Ajustes → Usuarios**.
- **Copias de seguridad cifradas**: descarga y restaura un backup **cifrado con tu contraseña**
  (base de datos + claves + credenciales de integración) desde **Ajustes → Sistema**.
- **Control parental / horarios de acceso**: corta el internet de un dispositivo en ventanas
  recurrentes ("sin internet 21:00–07:00 de lunes a viernes") o **pausa su internet de un toque**
  (30 min / 1 h / 2 h, con auto-reanudación), desde su ficha en Dispositivos.
- **Informes CSV y alertas configurables**: exporta auditoría, inventario y tráfico a CSV (para una
  revisión o un auditor); eliges **qué eventos de seguridad te avisan y por qué canal** — **push**
  y/o **email**.

UI estilo UniFi (tema oscuro, sidebar colapsable, paneles slideover, PWA instalable),
auth con JWT RS256 + refresh tokens rotatorios y **2FA opcional con passkeys (WebAuthn)**.

---

## Estructura (monorepo pnpm)

```
apps/
  agent/    Agente local — Fastify 5 + Prisma + SQLite + Socket.io
  web/      Frontend — React 18 + Vite + Tailwind + shadcn/ui + Zustand
packages/
  types/    Tipos TypeScript compartidos (@krakenos/types)
```

---

## Arranque rápido (desarrollo)

Requisitos: **Node.js ≥ 20** y **pnpm ≥ 9**.

```bash
pnpm install

# Agente: claves RS256 + base de datos
cd apps/agent
cp .env.example .env
./scripts/gen-keys.sh          # genera el par RS256 en ./keys
pnpm prisma:generate
pnpm prisma:migrate            # crea la base SQLite
pnpm db:seed                   # opcional: admin@krakenos.local / changeme123
cd ../..

# Levantar agente (:3001) + web (:5173) con hot-reload
pnpm dev
```

> Si omites `db:seed`, la primera vez que abras la web verás el **wizard `/setup`**
> para crear el administrador.

Arrancar solo uno:

```bash
pnpm dev:agent     # solo agente
pnpm dev:web       # solo web (requiere el agente en :3001)
```

---

## Producción

### Docker (la vía más simple)

```bash
docker compose up -d
```

Por defecto `docker-compose.yml` **construye la imagen localmente**. Para usar la imagen ya
publicada en **GHCR**, apunta el servicio a `ghcr.io/flores-rivera-24/krakenos:latest`
(descomenta la línea `image:` en el compose).

Levanta una imagen **todo-en-uno** (API + UI en `:3001`), como usuario **no root**, con
**todo el estado persistente** (base de datos, claves, credenciales) en el volumen
`krakenos-data`. Genera las claves y aplica las migraciones al arrancar. Conecta tu hardware
**desde la app** (no hace falta editar variables). Al primer arranque,
`docker compose logs krakenos` imprime una **URL de configuración con un QR** (token ya
incrustado) para crear el administrador — ábrela o escanéala con el móvil en la misma red.

> El contenedor publica en `:3001` de la LAN (el modelo es LAN + WireGuard para remoto). Si el
> host es accesible desde internet, no expongas la UI directamente: bind a `127.0.0.1` y detrás
> de WireGuard o un proxy TLS. Ver comentarios en `docker-compose.yml`.

> ⚠️ **Limitaciones en Docker:** la imagen por defecto **no** incluye `sudo`/`wg`/`iptables`/`tc`/
> `ffmpeg`, así que la VPN WireGuard, el firewall, el QoS, el streaming/grabación de cámaras RTSP y
> el auto-descubrimiento por UDP (mDNS/SSDP) **no funcionan** dentro del contenedor. Para esas
> funciones usa una instalación bare-metal/systemd. Detalle en [`docs/docker-limitations.md`](docs/docker-limitations.md).

### Sin Docker (Node)

En producción **el agente sirve también el frontend** (API + UI en un único puerto),
así que todo cabe en un comando:

```bash
pnpm prod          # = ./scripts/prod.sh
```

Encadena: instalar deps → generar claves JWT (si faltan) → crear `.env` (si falta) →
`prisma migrate deploy` → `pnpm build` → arrancar en `NODE_ENV=production` sirviendo
API+UI en `PORT` (por defecto `:3001`). El primer arranque imprime en el log una **URL de
configuración con QR** (token incrustado) y abre el wizard `/setup` para crear el administrador.

**Servicio persistente (systemd):** usa `apps/agent/scripts/krakenos.service.example`
(instrucciones en su cabecera), luego `systemctl enable --now krakenos`.

**HTTPS opcional en la LAN:**

```bash
cd apps/agent && ./scripts/gen-cert.sh   # cert autofirmado en ./certs
# en .env: HTTPS_ENABLED=true
```

---

## Conectar dispositivos reales

**Desde la app (recomendado):** entra en **Conectar** (`/connect`) y sigue el asistente —
elige qué quieres conectar (router, luces, enchufes, cámaras…), rellena los datos con ayuda
en cada campo, **prueba la conexión** y guarda. Se aplica en caliente, sin reiniciar, y las
credenciales se guardan **cifradas**. No necesitas editar `.env` ni leer estos docs.

**Por variable de entorno (alternativa / automatización):** cada integración también se
selecciona con una variable `*_KIND` (por defecto `mock`); cámbiala por la integración real y
añade sus variables en `apps/agent/.env`. Hay una **guía por integración en `docs/`** (las
mismas guías están internalizadas en la app).

> **Dependencias nativas.** Algunas integraciones necesitan una dep opcional que **no está
> en `package.json`** (CI con lockfile congelado) y se instala solo en el servidor:
> `node-ssh`, `mqtt`, `net-snmp`, `ws` o `tuyapi`. Se cargan con import perezoso.

### Drivers de red (`DRIVER_KIND`)

Gobiernan inventario, tráfico, bloqueo y WiFi del router/switch.

| `DRIVER_KIND` | Hardware | Variables clave | Dep | Guía |
|---|---|---|---|---|
| `mock` | — (desarrollo) | — | — | — |
| `openwrt` | OpenWrt (SSH+UCI) | `DRIVER_HOST`, `OPENWRT_*` | `node-ssh` | `docs/openwrt-ax21-setup.md` |
| `pfsense` | pfSense (REST API v2) | `DRIVER_HOST`, `PFSENSE_API_KEY` | — | — |
| `cisco-ios` | Catalyst (SSH+CLI) | `DRIVER_HOST`, `CISCO_*` | `node-ssh` | `docs/cisco-ios-setup.md` |
| `cisco-netconf` | IOS-XE 16.6+ (NETCONF) | `CISCO_NETCONF_*` | `node-ssh` | `docs/cisco-netconf-setup.md` |
| `unifi` | Ubiquiti UniFi (REST local) | `UNIFI_URL`, `UNIFI_USERNAME`, `UNIFI_PASSWORD` | — | `docs/unifi-setup.md` |
| `mikrotik` | RouterOS 7 (REST o SSH) | `MIKROTIK_HOST`, `MIKROTIK_USER`, `MIKROTIK_PASSWORD` | `node-ssh` (SSH) | `docs/mikrotik-setup.md` |
| `omada` | TP-Link Omada (Controller local) | `OMADA_URL`, `OMADA_USERNAME`, `OMADA_PASSWORD` | — | `docs/omada-setup.md` |
| `asus` | ASUS / Merlin (`appGet.cgi`) | `ASUS_HOST`, `ASUS_USERNAME`, `ASUS_PASSWORD` | — | `docs/asus-setup.md` |

> pfSense y Cisco no gestionan WiFi (los AP van aparte). Las VLANs en Cisco usan
> `VLAN_KIND=cisco` (reusa el transporte SSH del driver).

### IoT (`IOT_KIND`)

Luces, enchufes y sensores. Admite **lista** para combinar ecosistemas: `IOT_KIND=hue,govee,kasa`.

| `IOT_KIND` | Ecosistema | Variables clave | Dep | Guía |
|---|---|---|---|---|
| `zigbee` | zigbee2mqtt (MQTT) | `ZIGBEE2MQTT_URL` | `mqtt` | — |
| `matter` | python-matter-server (WS) | `MATTER_SERVER_URL` | `ws` | — |
| `hue` | Philips Hue (CLIP v2 local) | `HUE_BRIDGE_URL`, `HUE_APP_KEY` | — | `docs/hue-setup.md` |
| `govee` | Govee (API LAN/UDP) | `GOVEE_LISTEN_PORT` | — | `docs/govee-setup.md` |
| `tuya` | Tuya local (TCP+AES) | `TUYA_CONFIG_PATH` | `tuyapi` | `docs/tuya-setup.md` |
| `kasa` | TP-Link Kasa/Tapo (local) | `KASA_DEVICES`, `TAPO_EMAIL`, `TAPO_PASSWORD` | — | `docs/kasa-tapo-setup.md` |
| `shelly` | Shelly (REST Gen1 / RPC Gen2) | `SHELLY_DEVICES` | — | `docs/shelly-setup.md` |
| `meross` | Meross (MQTT local) | `MEROSS_BROKER_HOST`, `MEROSS_DEVICES` | `mqtt` | `docs/meross-setup.md` |
| `switchbot` | SwitchBot Hub (REST local) | `SWITCHBOT_HUB_HOST`, `SWITCHBOT_TOKEN` | — | `docs/switchbot-setup.md` |

> Los focos Tuya se registran (deviceId/localKey por foco) desde **Ajustes → Integraciones**;
> el `localKey` nunca se devuelve en un GET.

### Servicios de red

| Servicio | Activar (`.env`) | Vía | Notas |
|---|---|---|---|
| VPN WireGuard | `VPN_KIND=wireguard` + `WG_*` | helper sudoers | requiere `wg`/`wg-quick` |
| Firewall | `FIREWALL_KIND=iptables` + `FW_*` | helper sudoers | cadena dedicada `KRAKENOS` |
| QoS | `QOS_KIND=tc` + `TC_*` | helper sudoers | jerarquía HTB |
| DNS / Pi-hole | `DNS_KIND=pihole` + `PIHOLE_URL`, `PIHOLE_PASSWORD` | HTTP (REST v6) | sin helper |
| VLANs (switch) | `VLAN_KIND=switch` + `VLAN_SWITCH_*` | SNMP | `net-snmp`; o `VLAN_KIND=cisco` |
| Cámaras | `CAMERAS_KIND=rtsp` + `CAMERAS_CONFIG` | ffmpeg | inventario + snapshot |

### Operaciones privilegiadas (helper sudoers)

WireGuard, iptables y tc **no** se ejecutan directamente: van por un helper con allowlist
estricta invocado con `sudo -n`. Para habilitarlo en el servidor:

```bash
sudo install -m 0755 apps/agent/scripts/krakenos-helper.sh /usr/local/bin/krakenos-helper
sudo install -m 0440 apps/agent/scripts/krakenos.sudoers.example /etc/sudoers.d/krakenos
```

---

## Arquitectura (en breve)

- Los **drivers** (`apps/agent/src/drivers`) son adaptadores intercambiables. El resto del
  agente solo depende de la interfaz `HardwareDriver` de `@krakenos/types` — nunca sabe qué
  driver concreto está activo.
- Las integraciones de IoT, VPN, cámaras, firewall, VLANs, QoS y DNS siguen el mismo patrón:
  una factory construye el `mock` en desarrollo o la integración real según el `*_KIND`.
- El proceso Node **no corre como root**: las operaciones privilegiadas se delegan al helper.
- **La config puesta desde la UI precede a `.env`** (DB-sobre-env): el `kind` y las credenciales
  de cada integración pueden venir de la base de datos (cifradas en reposo) y **recargarse en
  caliente** sin reiniciar; `.env` queda como fallback.

> Las integraciones reales están entregadas como código + unit tests del contrato. La
> verificación end-to-end se hace en el despliegue con hardware.

---

## Tests y CI

Suite con **Vitest** en ambos paquetes; usa una base SQLite aislada (`prisma/test.db`),
nunca `dev.db`.

```bash
pnpm test                              # toda la suite (agente + web)
pnpm --filter @krakenos/agent test     # solo el agente
pnpm --filter @krakenos/web test:watch # web en watch
```

Además hay una **suite end-to-end con Playwright** (carpeta `e2e/`) que arranca la app construida
con mocks y recorre los flujos clave por la UI; corre en su propio job de CI (ver `docs/e2e.md`).

**CI** (GitHub Actions): en cada push a `main` y cada PR, dos jobs en paralelo:

- **build-test** → install → claves JWT + Prisma Client → `lint` → `typecheck` → `build` →
  `test` (coverage) → `audit` de dependencias (informativo, no bloquea).
- **security** → **secret scanning con gitleaks** (escanea todo el historial; **bloquea** el
  build ante un secreto o un fichero sensible commiteado: `keys/`, `.env`, `*.db`) + **SAST con
  semgrep** (reglas por defecto + JS/TS, acotado a `src/`; **bloquea** ante hallazgos).

Además: **CodeQL** (análisis semántico de seguridad) en cada push, y un workflow **Docker** que
construye la imagen y hace un *smoke test* de `/health` cuando cambia el empaquetado.

---

## Scripts raíz

| Script | Acción |
|---|---|
| `pnpm dev` | agente + web en paralelo (hot-reload) |
| `pnpm dev:agent` | solo agente en watch |
| `pnpm dev:web` | solo web (requiere el agente) |
| `pnpm build` | compilar/bundlear todos los paquetes |
| `pnpm prod` | producción en un comando (build + migrar + arrancar API+UI) |
| `pnpm test` | tests (Vitest) de agente y web |
| `pnpm typecheck` | typecheck de todo el monorepo |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier (formatea en lugar) |
| `pnpm clean` | limpiar dist/, node_modules |