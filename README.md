# KrakenOS

[![CI](https://github.com/Flores-rivera-24/krakenos/actions/workflows/ci.yml/badge.svg)](https://github.com/Flores-rivera-24/krakenos/actions/workflows/ci.yml)

**El cerebro de red de tu hogar.** KrakenOS reúne en un solo producto **local** lo que ningún
otro tiene junto: **cobertura WiFi sobre el plano de tu casa**, **control parental de red de
verdad**, **presencia** sin geofence de nube, **bienestar digital** y **seguridad de red**
completa (inventario, DNS, VLAN/QoS/firewall, VPN WireGuard). Corre **en un servidor local propio**
(Raspberry Pi, mini PC) sin nube de terceros, y se accede de forma remota vía VPN WireGuard que el
propio sistema gestiona. Ningún puerto de la UI queda expuesto a internet.

> **Complemento de Home Assistant, no sustituto.** KrakenOS no compite con HA en amplitud —
> **convive** con él y le añade lo que HA no da (cobertura, planos, parental, presencia, seguridad
> de red). Ver [KrakenOS + Home Assistant](#krakenos--home-assistant) y el
> [ADR de posicionamiento](docs/adr-positioning.md).

> Todo arranca en modo **`mock`** (sin hardware), así que puedes clonar, correr y explorar
> la app entera en desarrollo. Las integraciones reales se conectan **desde la propia app**
> con un asistente guiado paso a paso (o por variable de entorno, para automatizar).
> → [Conectar dispositivos reales](#conectar-dispositivos-reales)

---

## Qué es

KrakenOS es **el cerebro de red del hogar**: un producto **local-first** que gana en la cuña que
nadie más reúne —red + planos + presencia + parental + seguridad— y **delega** en los mejores donde
existir best-in-class gratuito hace inútil competir (cámaras → Frigate, voz → Matter). Detalle en el
[ADR de posicionamiento](docs/adr-positioning.md).

### El núcleo — donde KrakenOS es único

- **Cobertura WiFi + planos inteligentes**: mapa de calor (heatmap RF) sobre el **plano real de tu
  casa**, con **importación del plano desde una foto, un PDF o un Word** y detección asistida de
  paredes. Nadie del ecosistema smart-home hace esto.
- **Control parental / horarios de acceso**: corta el internet de un dispositivo en ventanas
  recurrentes ("sin internet 21:00–07:00 de lunes a viernes") o **pausa su internet de un toque**
  (30 min / 1 h / 2 h, con auto-reanudación) — control de **red**, no un temporizador de enchufe.
- **Presencia y modos del hogar**: llegada/salida de personas por WiFi (sin geofence de nube) y
  modos (en casa / fuera / noche) que disparan automatizaciones.
- **Bienestar digital**: uso de internet por persona con su evolución, **con privacidad por rol**.
- **Seguridad de red**: inventario en tiempo real (ARP/mDNS, OUI, bloqueo), VPN WireGuard propia
  (con QR), firewall, VLANs, QoS y DNS/bloqueo con **listas por categoría** (publicidad, malware,
  rastreo). **Arquitectura por drivers**: el mismo código funciona con OpenWrt, pfSense, UniFi,
  MikroTik, Cisco… sin tocar la API ni el frontend.
- **Energía**: medición de consumo (W/kWh), panel con histórico y **coste estimado**, con alertas
  por potencia sostenida o consumo diario.

### Lo cotidiano del hogar — suficiente y honesto

- **Hogar inteligente**: **habitaciones** para agrupar dispositivos, **favoritos** de acceso
  rápido, **escenas** (varios aparatos con un toque), **horarios IoT** (por hora o por evento solar)
  y **automatizaciones** por frases ("si… entonces…").
- **Control IoT** unificado: luces, enchufes y sensores desde una sola interfaz.
- **Cámaras (básico integrado)**: **vídeo en vivo** (HLS), **detección de movimiento** con aviso y
  foto, **grabación** de clips con línea de tiempo y **modo alarma** del hogar (armar/desarmar con
  PIN). Para detección por objetos (persona/coche), pre-roll y NVR, KrakenOS se apoyará en
  **Frigate** en vez de reinventarlo.

### Ecosistemas e interoperabilidad

- **Puente Matter**: expone tus dispositivos a **Alexa / Google / Apple** en LAN, sin nube, y
  comisiona dispositivos Matter desde la app. Es la vía oficial de «funciona con Alexa/Google»
  (ver [ADR de voz](docs/adr-voice.md)).
- **Tokens de API + MQTT saliente**: publica el estado del hogar a un broker MQTT local para
  integrarlo con **Home Assistant** o Node-RED, con permisos acotados por scope.

### Operación

- **Conexión guiada desde la app**: un asistente paso a paso conecta routers, luces, enchufes y
  cámaras **sin editar ficheros ni leer documentación externa** — con guías internalizadas, ayuda en
  cada campo, prueba de conexión y recarga en caliente. Los secretos se **cifran en reposo**.
- **Multi-usuario y roles del hogar**: admin, miembro, menor, invitado y solo-lectura, con alta,
  edición, activar/deshabilitar, reset y cambio de contraseña propio.
- **Copias de seguridad cifradas** con tu contraseña (base de datos + claves + credenciales) e
  **informes CSV** (auditoría, inventario, tráfico) con alertas configurables por **push**/**email**/
  **Telegram**.

UI estilo UniFi (tema oscuro, sidebar colapsable, paneles slideover, PWA instalable), **bilingüe
es/en**, auth con JWT RS256 + refresh tokens rotatorios y **2FA opcional con passkeys (WebAuthn)**.

---

## Qué NO es

Un posicionamiento honesto declara también lo que no se es:

- **No es un sustituto de Home Assistant.** Es un **complemento**: le añade cobertura, planos,
  parental, presencia y seguridad de red, y le habla por MQTT. No persigue las ~2.800 integraciones
  de HA.
- **No es un NVR profesional.** El detector de movimiento propio es básico; para detección por
  objetos, pre-roll y grabación continua, la vía es **Frigate**.
- **No es una alarma certificada.** El modo alarma no tiene batería de respaldo ni conexión de
  emergencia por red móvil: si cae la luz o el servidor, deja de existir. No sustituye a una alarma
  con central receptora.
- **No es un asistente de voz de nube.** La voz va por el **puente Matter** (local); no hay skill de
  Alexa ni Action de Google (rompería «sin puertos expuestos» — ver [ADR de voz](docs/adr-voice.md)).
- **No es un producto de nube.** Cero telemetría por defecto, cero dependencias de nube de terceros:
  los datos no salen de tu red.

---

## KrakenOS + Home Assistant

KrakenOS y Home Assistant **conviven, no compiten**. HA es imbatible en amplitud de integraciones;
KrakenOS aporta lo que HA no tiene de serie:

| | Home Assistant | KrakenOS |
|---|---|---|
| Integraciones IoT (amplitud) | **~2.800**, comunidad enorme | las esenciales, guiadas |
| Cobertura WiFi + plano de la casa | — | **✓** (heatmap RF + import de plano) |
| Control parental de **red** | parcial (add-ons) | **✓** (por dispositivo, horarios, pausa) |
| Presencia + bienestar por persona | trackers | **✓** (WiFi local + privacidad por rol) |
| Seguridad de red (inventario/DNS/VLAN/QoS/firewall/VPN) | parcial | **✓** integrado |
| Automatizaciones avanzadas | **✓✓** (YAML/Node-RED) | básicas por frases |
| Cámaras con ML | vía Frigate | básico → **Frigate** (US-214) |

**Cómo conviven:** KrakenOS publica el estado del hogar (luces, enchufes, energía, modo, alarma) a
un broker MQTT local que HA descubre solo (MQTT Discovery, en camino con la Fase 6). Usas HA para lo
que HA hace mejor y KrakenOS para su cuña, sin elegir. Ver el
[ADR de posicionamiento](docs/adr-positioning.md).

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

**Requisitos del servidor:** Ubuntu/Debian (o similar) en **x86-64 o ARM64** (Raspberry Pi 4/5,
mini PC), **Node.js ≥ 20**, **~1 GB de RAM** y **~2 GB de disco** libres (la base SQLite crece con
el histórico de tráfico/energía y la retención acota su tamaño). Para las funciones privilegiadas
(VPN/firewall/QoS) y de cámara hacen falta `wireguard-tools`, `iptables`, `iproute2` y `ffmpeg` en
el host.

### Instalador de un comando (recomendado)

En un Debian/Ubuntu/Raspberry Pi OS (x86-64 o ARM64) limpio:

```bash
curl -fsSL https://raw.githubusercontent.com/Flores-rivera-24/krakenos/main/scripts/install.sh | sudo bash
```

Comprueba el sistema (SO/arquitectura/RAM/disco), instala Node 20 + pnpm (pinneado, sin
descargas en el arranque), clona la última versión, genera las claves, migra la base, construye,
crea el **servicio systemd** y te imprime la **URL de `/setup?token=` con QR** para crear el
administrador. Es **idempotente** (re-ejecutarlo actualiza sin tocar tu configuración) y ofrece
como **opcionales** el helper sudoers (VPN/firewall/QoS), `ffmpeg` (cámaras) y las dependencias
de integraciones. Después:

```bash
sudo bash /opt/krakenos/scripts/install.sh --update      # actualizar (orquestador con rollback)
sudo bash /opt/krakenos/scripts/install.sh --uninstall   # desinstalar (conserva DB/claves/datos)
```

> El smoke del instalador corre en CI sobre un Debian limpio en cada push. Las partes
> privilegiadas (VPN/firewall/QoS/cámaras) se verifican con hardware real.

### Bare-metal / systemd (manual)

La misma instalación, a mano: es la vía que opera **todas** las funciones, incluidas VPN
WireGuard, firewall, QoS, cámaras RTSP y auto-descubrimiento. En producción **el agente sirve
también el frontend** (API + UI en un único puerto), así que arranca con un comando:

```bash
pnpm prod          # = ./scripts/prod.sh
```

Encadena: instalar deps → generar claves JWT (si faltan) → crear `.env` (si falta) →
`prisma migrate deploy` → `pnpm build` → arrancar en `NODE_ENV=production` sirviendo
API+UI en `PORT` (por defecto `:3001`). El primer arranque imprime en el log una **URL de
configuración con QR** (token incrustado) y abre el wizard `/setup` para crear el administrador.

**Servicio persistente (systemd):** usa `apps/agent/scripts/krakenos.service.example`
(instrucciones en su cabecera), luego `systemctl enable --now krakenos`. Para las operaciones
privilegiadas, instala el helper sudoers (ver [Operaciones privilegiadas](#operaciones-privilegiadas-helper-sudoers)).

**HTTPS opcional en la LAN:**

```bash
cd apps/agent && ./scripts/gen-cert.sh   # cert autofirmado en ./certs
# en .env: HTTPS_ENABLED=true
```


### Docker (demo / evaluación rápida)

Docker es la vía más rápida para **probar** KrakenOS, pero **no** es una instalación de producción
completa: la imagen es mínima y no privilegiada, así que **varias funciones insignia no operan**
dentro del contenedor (ver aviso abajo). Para producción real, usa bare-metal/systemd.

```bash
docker compose up -d
```

Por defecto `docker-compose.yml` **construye la imagen localmente**. Para usar la imagen ya
publicada en **GHCR**, apunta el servicio a `ghcr.io/flores-rivera-24/krakenos:latest`
(descomenta la línea `image:` en el compose).

Levanta una imagen **todo-en-uno** (API + UI en `:3001`), como usuario **no root**, con
**todo el estado persistente** (base de datos, claves, credenciales) en el volumen
`krakenos-data`. Genera las claves y aplica las migraciones al arrancar. Al primer arranque,
`docker compose logs krakenos` imprime una **URL de configuración con un QR** (token ya
incrustado) para crear el administrador — ábrela o escanéala con el móvil en la misma red.

> El contenedor publica en `:3001` de la LAN (el modelo es LAN + WireGuard para remoto). Si el
> host es accesible desde internet, no expongas la UI directamente: bind a `127.0.0.1` y detrás
> de WireGuard o un proxy TLS. Ver comentarios en `docker-compose.yml`.

> ⚠️ **Limitaciones en Docker:** la imagen por defecto **no** incluye `sudo`/`wg`/`iptables`/`tc`/
> `ffmpeg`, así que la VPN WireGuard, el firewall, el QoS, el streaming/grabación de cámaras RTSP y
> el auto-descubrimiento por UDP (mDNS/SSDP) **no funcionan** dentro del contenedor. Para esas
> funciones usa una instalación bare-metal/systemd. Detalle en [`docs/docker-limitations.md`](docs/docker-limitations.md).

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