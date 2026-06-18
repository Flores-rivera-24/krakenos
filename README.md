# KrakenOS

[![CI](https://github.com/Flores-rivera-24/krakenos/actions/workflows/ci.yml/badge.svg)](https://github.com/Flores-rivera-24/krakenos/actions/workflows/ci.yml)

Plataforma de gestión de red doméstica e IoT. Corre en un servidor local y se
accede remotamente vía VPN WireGuard gestionada por el propio sistema.

> **Estado:** MVP funcional — auth con wizard de primer arranque, inventario en
> tiempo real con identificación automática y bloqueo, gestión de WiFi, dashboard
> y ajustes con auditoría. HTTPS opcional para la LAN. **Fase 2 completa:** VPN
> WireGuard, control IoT, cámaras, monitor de tráfico y WiFi multi-AP.
> **Fase 3 completa:** estadísticas históricas de tráfico, firewall, VLANs, QoS y
> DNS/bloqueo. Todo con el patrón **mock-first**.

## Estructura (monorepo pnpm)

```
apps/
  agent/    Agente local — Fastify 4 + Prisma + SQLite + Socket.io
  web/      Frontend — React 18 + Vite + Tailwind + shadcn/ui + Zustand
packages/
  types/    Tipos TypeScript compartidos (@krakenos/types)
```

## Módulos del MVP

- **Auth** — JWT RS256 + bcrypt + refresh tokens con rotación/revocación. Wizard de
  primer arranque para crear el administrador.
- **Inventario** — barrido ARP/mDNS vía driver + actualizaciones en tiempo real (Socket.io).
- **WiFi** — SSID, contraseña y red de invitados vía drivers de hardware.
- **Dashboard** — resumen de la red, estado del sistema (uptime/CPU/RAM) y actividad
  en tiempo real.

## Fase 2

Implementada con el patrón **mock-first** (abstracción intercambiable + mock en memoria),
de modo que todo funciona en desarrollo sin hardware real:

- **VPN WireGuard** — gestión de peers + QR/config del cliente (claves X25519 reales).
- **Control IoT** — luces, enchufes y sensores desde la UI.
- **Cámaras** — inventario y snapshots de cámaras IP.
- **Monitor de tráfico** — uso de la WAN en tiempo real.
- **WiFi multi-AP** — access points, redes por AP y clientes conectados.

## Fase 3

Red avanzada, también **mock-first**:

- **Estadísticas históricas** — rollups periódicos del tráfico WAN persistidos en SQLite,
  con consultas por rango (1h/24h/7d) y total de datos consumidos.
- **Firewall** — reglas allow/deny por origen, destino, protocolo y puerto.
- **VLANs** — segmentación 802.1Q y asignación de dispositivos a cada segmento.
- **QoS** — prioridad (alta/normal/baja) y límites de ancho de banda por dispositivo o servicio.
- **DNS / Pi-hole** — bloqueo de dominios (anuncios/rastreadores) y estadísticas de consultas.

> En producción, las integraciones reales sustituyen a los mocks: WireGuard/iptables/tc vía
> helper con sudoers, switch gestionado para VLANs, Pi-hole para DNS, IoT (Zigbee/Matter) y
> RTSP transcodificado (HLS/WebRTC) para cámaras.

## Arquitectura del agente

- Los **drivers de hardware** (`apps/agent/src/drivers`) son adaptadores
  intercambiables (`mock`, `openwrt`, `pfsense`). El resto del agente sólo
  depende de la interfaz `HardwareDriver` de `@krakenos/types`.
- Las integraciones de Fase 2/3 siguen el mismo patrón: cada una (`VpnManager`,
  `IotManager`, `CameraManager`, `FirewallManager`, `VlanManager`, `QosManager`,
  `DnsManager`) se construye con una factory e inyecta su mock en desarrollo.
- Las operaciones privilegiadas (WireGuard, iptables, tc) se delegan a un **helper
  separado** (`apps/agent/scripts/krakenos-helper.sh`, con allowlist estricta) invocado
  con `sudo -n` desde `SudoHelperRunner`. El agente nunca llama esos binarios directamente.

## Producción (integraciones reales)

Sustitución incremental de los mocks por integraciones reales, seleccionadas por
variable de entorno (`VPN_KIND`, `FIREWALL_KIND`, `DRIVER_KIND`, …). Ya implementados:

- **WireGuard real** (`VPN_KIND=wireguard`) — aplica peers con `wg`/`wg-quick` vía el
  helper sudoers y persiste su registro en un fichero JSON.
- **Firewall iptables real** (`FIREWALL_KIND=iptables`) — reconstruye una cadena dedicada
  (`KRAKENOS`) desde el registro de reglas en cada cambio, también vía el helper.
- **QoS tc real** (`QOS_KIND=tc`) — moldea el tráfico (jerarquía HTB) de una interfaz desde el
  registro de reglas. Esquema baseline (egress, objetivos por IP) que se afina en el despliegue.
- **DNS Pi-hole real** (`DNS_KIND=pihole`) — gestiona la blocklist y lee las estadísticas/consultas
  contra la **API REST de Pi-hole (v6)**, autenticando por sesión. Es HTTP, así que no usa el helper.
- **Driver OpenWrt real** (`DRIVER_KIND=openwrt`) — inventario, tráfico, bloqueo y WiFi reales contra
  un router OpenWrt vía **SSH+UCI** (`node-ssh`). Descubre por ARP/mDNS/leases, muestrea
  `/proc/net/dev`, bloquea por regla `iptables` de MAC y opera la WiFi con `uci`/`iwinfo`.
- **Driver pfSense real** (`DRIVER_KIND=pfsense`) — inventario, tráfico y bloqueo reales contra un
  pfSense vía su **REST API v2** (paquete pfSense API). Descubre por ARP + leases DHCP, muestrea los
  contadores de la WAN y bloquea creando una regla de firewall. El WiFi se gestiona en los AP aparte.
- **IoT zigbee2mqtt real** (`IOT_KIND=zigbee`) — luces, enchufes y sensores Zigbee vía **zigbee2mqtt**
  sobre MQTT: descubre los dispositivos del bridge, sigue su estado por topics y los controla
  publicando en `<base>/<id>/set`. El monitor de tráfico usa contadores WAN reales con un driver real.
- **Cámaras RTSP reales** (`CAMERAS_KIND=rtsp`) — inventario por config (`CAMERAS_CONFIG`, sin exponer
  la URL RTSP) y snapshot capturando un fotograma del stream con **ffmpeg**.
- **VLANs por switch reales** (`VLAN_KIND=switch`) — crea/borra VLANs 802.1Q en un switch gestionado vía
  **SNMP** (Q-BRIDGE-MIB), con los metadatos (nombre/subred/aislamiento) persistidos en un fichero.

Para habilitar las integraciones por helper (WireGuard/iptables/tc) en un servidor real:

```bash
sudo install -m 0755 apps/agent/scripts/krakenos-helper.sh /usr/local/bin/krakenos-helper
sudo install -m 0440 apps/agent/scripts/krakenos.sudoers.example /etc/sudoers.d/krakenos
# en apps/agent/.env: VPN_KIND=wireguard / FIREWALL_KIND=iptables / QOS_KIND=tc + sus variables WG_*/FW_*/TC_*
# DNS Pi-hole (sin helper): DNS_KIND=pihole + PIHOLE_URL/PIHOLE_PASSWORD
# Driver OpenWrt (sin helper, vía SSH): DRIVER_KIND=openwrt + DRIVER_HOST/OPENWRT_* (requiere node-ssh)
# Driver pfSense (sin helper, vía REST): DRIVER_KIND=pfsense + DRIVER_HOST/PFSENSE_API_KEY
# IoT Zigbee (vía MQTT): IOT_KIND=zigbee + ZIGBEE2MQTT_URL (requiere mqtt y un zigbee2mqtt)
# Cámaras RTSP (vía ffmpeg): CAMERAS_KIND=rtsp + CAMERAS_CONFIG (requiere el binario ffmpeg)
# VLANs por switch (vía SNMP): VLAN_KIND=switch + VLAN_SWITCH_HOST (requiere net-snmp)
```

> El resto de integraciones reales (IoT Matter) están en el backlog y reutilizan el mismo patrón
> de transporte inyectable.

## Puesta en marcha

Requisitos: Node.js ≥ 20, pnpm ≥ 9.

### Setup inicial (una sola vez)

```bash
pnpm install

# Agente: generar claves RS256 y base de datos
cd apps/agent
cp .env.example .env
./scripts/gen-keys.sh          # genera el par RS256 en ./keys
pnpm prisma:generate
pnpm prisma:migrate            # crea la base SQLite
pnpm db:seed                   # opcional: admin@krakenos.local / changeme123
cd ../..
```

> Si omites `db:seed`, al abrir la web por primera vez aparece el **wizard de
> configuración** (`/setup`) para crear el administrador.

### Desarrollo

```bash
# Levantar agente (:3001) y web (:5173) en paralelo, con hot-reload
pnpm dev

# O arrancar solo uno
pnpm dev:agent                 # solo agente
pnpm dev:web                   # solo web (requiere agente en :3001)
```

### Producción

```bash
# Build de todos los paquetes (crea dist/)
pnpm build

# Arrancar agente desde el bundle
cd apps/agent
node dist/index.js             # requiere .env y keys/ en el directorio

# (Opcional) Servir el agente por HTTPS en la LAN:
./scripts/gen-cert.sh          # cert autofirmado en ./certs (SAN: localhost + IP de LAN)
# luego en .env: HTTPS_ENABLED=true   (en desarrollo se deja en HTTP)

# Servir frontend en producción
cd ../web
pnpm preview                   # servidor local en :4173 (para probar)
# en producción: servir web/dist/ con nginx o similar
```

## Tests y CI

Suite con **Vitest** en ambos paquetes (`pnpm test` en la raíz corre todo):

- **Agente** (`apps/agent`) — funciones puras, driver `mock`, factory de drivers,
  servicios (`AuthService`/`InventoryService`), rutas HTTP vía `app.inject()`
  (guards, roles, validación, rate-limit) y eventos WebSocket reales. Las pruebas
  usan una base SQLite **aislada** (`prisma/test.db`), nunca `dev.db`.
- **Web** (`apps/web`) — libs puras, cliente API (refresh automático en 401),
  stores Zustand, componentes y páginas (jsdom + Testing Library).

```bash
pnpm test                              # toda la suite
pnpm --filter @krakenos/agent test     # solo el agente
pnpm --filter @krakenos/web test:watch # web en modo watch
```

**CI** (GitHub Actions, `.github/workflows/ci.yml`): en cada push a `main` y en
cada PR ejecuta install → genera claves JWT y el Prisma Client → `lint` →
`typecheck` → `test`.

## Scripts raíz

| Script           | Acción                                  |
| ---------------- | --------------------------------------- |
| `pnpm dev`       | agent + web en paralelo (dev, hot-reload) |
| `pnpm dev:agent` | solo agente en watch mode               |
| `pnpm dev:web`   | solo web en dev server (requiere agente) |
| `pnpm build`     | compilar/bundlear todos los paquetes    |
| `pnpm test`      | tests (Vitest) de agente y web          |
| `pnpm typecheck` | typecheck de todo el monorepo           |
| `pnpm lint`      | ESLint                                  |
| `pnpm format`    | Prettier (formatea en lugar)            |
| `pnpm clean`     | limpiar dist/, node_modules             |
