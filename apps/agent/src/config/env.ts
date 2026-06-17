import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DriverKind } from '@krakenos/types';

/** Lee una variable obligatoria o lanza al arrancar. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno obligatoria: ${name}`);
  }
  return value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`La variable ${name} debe ser un entero, recibido: ${raw}`);
  }
  return parsed;
}

const driverKind = (process.env.DRIVER_KIND ?? 'mock') as DriverKind;

/**
 * TLS opcional. Si `HTTPS_ENABLED=true`, lee el cert/clave (genera con
 * scripts/gen-cert.sh). En desarrollo se deja en HTTP.
 */
const httpsEnabled = process.env.HTTPS_ENABLED === 'true';
const https = httpsEnabled
  ? {
      key: readFileSync(resolve(required('TLS_KEY_PATH')), 'utf8'),
      cert: readFileSync(resolve(required('TLS_CERT_PATH')), 'utf8'),
    }
  : null;

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: int('PORT', 3001),
  host: process.env.HOST ?? '0.0.0.0',
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',

  accessTokenTtl: int('ACCESS_TOKEN_TTL', 900),
  refreshTokenTtl: int('REFRESH_TOKEN_TTL', 2_592_000),

  /** Claves RS256 leídas desde disco al arrancar. */
  jwtPrivateKey: readFileSync(resolve(required('JWT_PRIVATE_KEY_PATH')), 'utf8'),
  jwtPublicKey: readFileSync(resolve(required('JWT_PUBLIC_KEY_PATH')), 'utf8'),

  driver: {
    kind: driverKind,
    host: process.env.DRIVER_HOST || undefined,
  },

  vpn: {
    kind: (process.env.VPN_KIND ?? 'mock') as 'mock' | 'wireguard',
    endpoint: process.env.VPN_ENDPOINT ?? 'vpn.krakenos.local',
    listenPort: int('VPN_LISTEN_PORT', 51820),
  },

  /** Config TLS (`{ key, cert }`) o `null` si el agente corre en HTTP. */
  https,
} as const;
