import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

interface WriteEndpoint {
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  payload?: Record<string, unknown>;
}

/**
 * Un endpoint de escritura representativo por módulo (US-61). El payload es válido
 * para que la petición supere la validación de schema y llegue al chequeo de rol
 * (un payload inválido daría 400 antes de evaluar la autorización).
 */
const WRITE_ENDPOINTS: WriteEndpoint[] = [
  { method: 'PUT', url: '/api/wifi', payload: { ssid: 'MiWifi', password: 'secure123' } },
  { method: 'POST', url: '/api/inventory/devices/x/block' },
  { method: 'POST', url: '/api/vpn/peers', payload: { name: 'Peer' } },
  { method: 'POST', url: '/api/firewall/rules', payload: { name: 'Regla', action: 'deny' } },
  { method: 'POST', url: '/api/vlans', payload: { tag: 100, name: 'Invitados' } },
  { method: 'POST', url: '/api/qos/rules', payload: { name: 'Regla', target: '192.168.1.10' } },
  { method: 'POST', url: '/api/dns/blocklist', payload: { domain: 'ads.example.com' } },
  { method: 'PATCH', url: '/api/iot/devices/x', payload: { on: true } },
  {
    method: 'POST',
    url: '/api/iot/tuya/devices',
    payload: { deviceId: 'd1', localKey: 'k1', ip: '192.168.1.5', name: 'Enchufe' },
  },
  { method: 'PATCH', url: '/api/system/settings', payload: { key: 'homeName', value: 'Hogar' } },
];

describe('autorización de escritura (US-61)', () => {
  let app: FastifyInstance;
  let viewerToken: string;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    const viewer = await seedUser(app, { email: 'viewer@krakenos.test', role: 'viewer' });
    viewerToken = signAccess(app, viewer);
  });

  it.each(WRITE_ENDPOINTS)('$method $url → 403 para un viewer', async ({ method, url, payload }) => {
    const res = await app.inject({ method, url, headers: authHeader(viewerToken), payload });
    expect(res.statusCode).toBe(403);
  });

  it.each(WRITE_ENDPOINTS)('$method $url → 401 sin token', async ({ method, url, payload }) => {
    const res = await app.inject({ method, url, payload });
    expect(res.statusCode).toBe(401);
  });
});
