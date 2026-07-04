# KrakenOS — imagen todo-en-uno (agente API + UI en un puerto).
# Imagen única (build + runtime) por robustez: evita copiar entre etapas el motor
# nativo de Prisma y bcrypt. Optimización multi-stage: pendiente.
FROM node:20-bookworm-slim

# Dependencias de build (bcrypt nativo) + runtime (openssl para claves/Prisma).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

WORKDIR /app

# Instala dependencias y construye agente + web.
COPY . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @krakenos/agent exec prisma generate \
  && pnpm --filter @krakenos/web build \
  && pnpm --filter @krakenos/agent build

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
