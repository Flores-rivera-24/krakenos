# KrakenOS

Plataforma de gestión de red doméstica e IoT. Corre en un servidor local y se
accede remotamente vía VPN WireGuard gestionada por el propio sistema.

## Estructura (monorepo pnpm)

```
apps/
  agent/    Agente local — Fastify 4 + Prisma + SQLite + Socket.io
  web/      Frontend — React 18 + Vite + Tailwind + shadcn/ui + Zustand
packages/
  types/    Tipos TypeScript compartidos (@krakenos/types)
```

## Módulos del MVP

- **Auth** — JWT RS256 + bcrypt + refresh tokens con rotación/revocación.
- **Inventario** — barrido ARP/mDNS vía driver + actualizaciones en tiempo real (Socket.io).
- **WiFi** — SSID, contraseña y red de invitados vía drivers de hardware.

## Arquitectura del agente

- Los **drivers de hardware** (`apps/agent/src/drivers`) son adaptadores
  intercambiables (`mock`, `openwrt`, `pfsense`). El resto del agente sólo
  depende de la interfaz `HardwareDriver` de `@krakenos/types`.
- Las operaciones privilegiadas (WireGuard, iptables) se delegarán a un helper
  separado vía sudoers (pendiente de implementar).

## Puesta en marcha

Requisitos: Node.js ≥ 20, pnpm ≥ 9.

```bash
pnpm install

# Agente
cd apps/agent
cp .env.example .env
./scripts/gen-keys.sh          # genera el par RS256 en ./keys
pnpm prisma:generate
pnpm prisma:migrate            # crea la base SQLite
pnpm db:seed                   # usuario admin@krakenos.local / changeme123
cd ../..

# Levantar todo en paralelo
pnpm dev                       # agente en :3001, web en :5173
```

## Scripts raíz

| Script           | Acción                                  |
| ---------------- | --------------------------------------- |
| `pnpm dev`       | agent + web en paralelo                 |
| `pnpm build`     | build de todos los paquetes             |
| `pnpm typecheck` | typecheck de todo el monorepo           |
| `pnpm lint`      | ESLint                                  |
| `pnpm format`    | Prettier                                |
