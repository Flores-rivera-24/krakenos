# KrakenOS — imagen todo-en-uno (agente API + UI en un puerto).
#
# Build multi-stage (US-117):
#   · `builder` trae el toolchain nativo (python3/make/g++) para compilar bcrypt y
#     genera el cliente de Prisma + construye web y agente.
#   · `runtime` parte de una base limpia SIN toolchain de compilación: hereda el
#     árbol `/app` ya construido (node_modules con el .node de bcrypt y el motor
#     nativo de Prisma ya compilados contra la MISMA libc — ambas etapas son
#     `node:20-bookworm-slim`, así que los binarios son compatibles). El resultado
#     no lleva compiladores en la imagen final (menor superficie + tamaño).
#
# Nota: se copia el árbol completo (no `pnpm deploy`) a propósito, por robustez:
# evita reconstruir node_modules y perder el cliente generado de Prisma (.prisma/client).

# ---------- Etapa 1: build ----------
FROM node:20-bookworm-slim AS builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @krakenos/agent exec prisma generate \
  && pnpm --filter @krakenos/web build \
  && pnpm --filter @krakenos/agent build

# ---------- Etapa 2: runtime ----------
FROM node:20-bookworm-slim AS runtime

# Solo runtime: openssl (claves/Prisma) + ca-certificates. Sin compiladores.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

WORKDIR /app

# Hereda el árbol ya construido (dist, node_modules con binarios nativos,
# cliente de Prisma generado, migraciones y build de la web).
COPY --from=builder /app /app

ENV NODE_ENV=production \
    SERVE_WEB=true \
    HOST=0.0.0.0 \
    PORT=3001 \
    DRIVER_KIND=mock \
    DATABASE_URL=file:/data/app.db \
    JWT_PRIVATE_KEY_PATH=/data/keys/jwt-private.pem \
    JWT_PUBLIC_KEY_PATH=/data/keys/jwt-public.pem \
    SECRETBOX_KEY_PATH=/data/keys/secretbox.key

EXPOSE 3001

# No corre como root (defensa en profundidad). El volumen /data guarda estado.
RUN useradd -r -u 10001 -m krakenos \
  && mkdir -p /data \
  && chown -R krakenos /app /data
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER krakenos
WORKDIR /app/apps/agent

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
