# KrakenOS

[![CI](https://github.com/Flores-rivera-24/krakenos/actions/workflows/ci.yml/badge.svg)](https://github.com/Flores-rivera-24/krakenos/actions/workflows/ci.yml)

Plataforma de gestión de red doméstica e IoT que corre **en un servidor local propio**
(Raspberry Pi, mini PC) sin nube de terceros, y se accede de forma remota vía VPN
WireGuard que el propio sistema gestiona. Ningún puerto de la UI queda expuesto a internet.

> Todo arranca en modo **`mock`** (sin hardware), así que puedes clonar, correr y explorar
> la app entera en desarrollo. Las integraciones reales se activan una a una por variable
> de entorno. → [Conectar dispositivos reales](#conectar-dispositivos-reales)

---

## Qué es

- **Inventario en tiempo real** de los dispositivos de tu red (descubrimiento ARP/mDNS,
  identificación por OUI, bloqueo, edición).
- **Control de red**: WiFi, VPN WireGuard (con QR), firewall, VLANs, QoS y DNS/bloqueo.
- **Control IoT** unificado: luces, enchufes, sensores y cámaras desde una sola interfaz.
- **Arquitectura por drivers**: el mismo código funciona con distintas marcas de hardware
  (OpenWrt, pfSense, UniFi, MikroTik, Cisco…) sin tocar la API ni el frontend.

UI estilo UniFi (tema oscuro, sidebar colapsable, paneles slideover, PWA instalable),
auth con JWT RS256 + refresh tokens rotatorios y **2FA opcional con passkeys (WebAuthn)**.

---

## Estructura (monorepo pnpm)

```
apps/
  agent/    Agente local — Fastify 4 + Prisma + SQLite + Socket.io
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

En producción **el agente sirve también el frontend** (API + UI en un único puerto),
así que todo cabe en un comando:

```bash
pnpm prod          # = ./scripts/prod.sh
```

Encadena: instalar deps → generar claves JWT (si faltan) → crear `.env` (si falta) →
`prisma migrate deploy` → `pnpm build` → arrancar en `NODE_ENV=production` sirviendo
API+UI en `PORT` (por defecto `:3001`). El primer arranque muestra el wizard `/setup`.

**Servicio persistente (systemd):** usa `apps/agent/scripts/krakenos.service.example`
(instrucciones en su cabecera), luego `systemctl enable --now krakenos`.

**HTTPS opcional en la LAN:**

```bash
cd apps/agent && ./scripts/gen-cert.sh   # cert autofirmado en ./certs
# en .env: HTTPS_ENABLED=true
```

---

## Conectar dispositivos reales

Cada integración se selecciona con una variable `*_KIND` (por defecto `mock`). Cámbiala
por la integración real y añade sus variables en `apps/agent/.env`. Hay una **guía por
integración en `docs/`**.

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

> Las integraciones reales están entregadas como código + unit tests del contrato. La
> verificación end-to-end se hace en el despliegue con hardware. Lo único fuera del contrato
> actual es el streaming continuo de cámaras (HLS/WebRTC).

---

## Tests y CI

Suite con **Vitest** en ambos paquetes; usa una base SQLite aislada (`prisma/test.db`),
nunca `dev.db`.

```bash
pnpm test                              # toda la suite (agente + web)
pnpm --filter @krakenos/agent test     # solo el agente
pnpm --filter @krakenos/web test:watch # web en watch
```

**CI** (GitHub Actions): en cada push a `main` y cada PR, dos jobs en paralelo:

- **build-test** → install → claves JWT + Prisma Client → `lint` → `typecheck` → `build` →
  `test` (coverage) → `audit` de dependencias (informativo, no bloquea).
- **security** → **secret scanning con gitleaks** (escanea todo el historial; **bloquea** el
  build ante un secreto o un fichero sensible commiteado: `keys/`, `.env`, `*.db`) + **SAST con
  semgrep** (reglas por defecto + JS/TS, acotado a `src/`; **bloquea** ante hallazgos).

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