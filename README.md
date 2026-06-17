# KrakenOS

Plataforma de gestión de red doméstica e IoT. Corre en un servidor local y se
accede remotamente vía VPN WireGuard gestionada por el propio sistema.

> **Estado:** MVP funcional — auth con wizard de primer arranque, inventario en
> tiempo real con identificación automática y bloqueo, gestión de WiFi, dashboard
> y ajustes con auditoría. HTTPS opcional para la LAN.

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

## Scripts raíz

| Script           | Acción                                  |
| ---------------- | --------------------------------------- |
| `pnpm dev`       | agent + web en paralelo (dev, hot-reload) |
| `pnpm dev:agent` | solo agente en watch mode               |
| `pnpm dev:web`   | solo web en dev server (requiere agente) |
| `pnpm build`     | compilar/bundlear todos los paquetes    |
| `pnpm typecheck` | typecheck de todo el monorepo           |
| `pnpm lint`      | ESLint                                  |
| `pnpm format`    | Prettier (formatea en lugar)            |
| `pnpm clean`     | limpiar dist/, node_modules             |
