# KrakenOS

[![CI](https://github.com/Flores-rivera-24/krakenos/actions/workflows/ci.yml/badge.svg)](https://github.com/Flores-rivera-24/krakenos/actions/workflows/ci.yml)

Plataforma de gestión de red doméstica e IoT. Corre en un servidor local y se
accede remotamente vía VPN WireGuard gestionada por el propio sistema.

> **Estado:** MVP funcional — auth con wizard de primer arranque, inventario en
> tiempo real con identificación automática y bloqueo, gestión de WiFi, dashboard
> y ajustes con auditoría. HTTPS opcional para la LAN. **Fase 2 en curso:** VPN
> WireGuard (gestión de peers + QR).

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

## Fase 2 (en curso)

- **VPN WireGuard** — el agente gestiona peers y genera el QR/config del cliente. En
  desarrollo usa un gestor `mock` (claves X25519 reales, sin `wg` instalado); en
  producción las operaciones privilegiadas van en un helper vía sudoers.

## Arquitectura del agente

- Los **drivers de hardware** (`apps/agent/src/drivers`) son adaptadores
  intercambiables (`mock`, `openwrt`, `pfsense`). El resto del agente sólo
  depende de la interfaz `HardwareDriver` de `@krakenos/types`.
- Las operaciones privilegiadas (WireGuard, iptables) se delegarán a un helper
  separado vía sudoers (pendiente de implementar).

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
