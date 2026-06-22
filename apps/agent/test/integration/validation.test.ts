import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

interface InvalidCase {
  name: string;
  method: 'POST' | 'PATCH' | 'PUT';
  url: string;
  payload: Record<string, unknown>;
}

/**
 * Payloads que el JSON Schema debe rechazar con 400 (US-61). Se usan con token de
 * admin: la validación corre antes del preHandler de rol, así que un 400 confirma
 * que el schema atajó la entrada inválida (no un 403/401).
 */
const INVALID_CASES: InvalidCase[] = [
  { name: 'wifi: contraseña demasiado corta', method: 'PUT', url: '/api/wifi', payload: { password: 'short' } },
  {
    name: 'inventory: VLAN tag fuera de rango',
    method: 'PUT',
    url: '/api/inventory/devices/x/vlan',
    payload: { tag: 0 },
  },
  {
    name: 'firewall: puerto fuera de rango',
    method: 'POST',
    url: '/api/firewall/rules',
    payload: { name: 'Regla', action: 'deny', port: 0 },
  },
  {
    name: 'firewall: IP/CIDR mal formada',
    method: 'POST',
    url: '/api/firewall/rules',
    payload: { name: 'Regla', action: 'deny', source: 'no-es-ip' },
  },
  {
    name: 'qos: ancho de banda fuera de rango',
    method: 'POST',
    url: '/api/qos/rules',
    payload: { name: 'Regla', target: 'x', uploadKbps: 20_000_000 },
  },
  { name: 'vlan: tag fuera de rango', method: 'POST', url: '/api/vlans', payload: { tag: 5000, name: 'V' } },
  // Anti-inyección en argumentos que alcanzan operaciones privilegiadas (US-73):
  // el schema rechaza con 400 ANTES de llegar al servicio / a cualquier exec.
  {
    name: 'qos: objetivo con metacaracteres de shell',
    method: 'POST',
    url: '/api/qos/rules',
    payload: { name: 'Regla', target: '10.0.0.5; reboot' },
  },
  {
    name: 'qos: objetivo con inyección de bandera',
    method: 'POST',
    url: '/api/qos/rules',
    payload: { name: 'Regla', target: '--match' },
  },
  {
    name: 'vlan: nombre con salto de línea (inyección de comando IOS)',
    method: 'POST',
    url: '/api/vlans',
    payload: { tag: 50, name: 'IoT\nno vlan 1' },
  },
  {
    name: 'vlan: nombre con espacios/metacaracteres',
    method: 'POST',
    url: '/api/vlans',
    payload: { tag: 51, name: 'mi vlan; reload' },
  },
  {
    name: 'dns: dominio inválido (sin TLD)',
    method: 'POST',
    url: '/api/dns/blocklist',
    payload: { domain: 'sin-tld' },
  },
  {
    name: 'iot: brillo fuera de rango',
    method: 'PATCH',
    url: '/api/iot/devices/x',
    payload: { brightness: 150 },
  },
  {
    name: 'tuya: deviceId vacío',
    method: 'POST',
    url: '/api/iot/tuya/devices',
    payload: { deviceId: '', localKey: 'k', ip: '1.2.3.4', name: 'D' },
  },
];

describe('validación de payloads (US-61)', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    const admin = await seedUser(app, { email: 'admin@krakenos.test', role: 'admin' });
    adminToken = signAccess(app, admin);
  });

  it.each(INVALID_CASES)('$name → 400', async ({ method, url, payload }) => {
    const res = await app.inject({ method, url, headers: authHeader(adminToken), payload });
    expect(res.statusCode).toBe(400);
  });
});
