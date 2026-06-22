import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

interface WriteEndpoint {
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  /** Payload VÁLIDO: la validación de schema corre antes del preHandler de rol, así
   * que un cuerpo inválido daría 400 y no llegaríamos a comprobar la autorización. */
  payload?: Record<string, unknown>;
}

/**
 * TODAS las rutas mutantes que exigen rol **admin** (escritura de red/sistema),
 * enumeradas de forma exhaustiva por módulo (US-89; antes solo se probaba una por
 * módulo, US-61). Cada una debe: 403 para un viewer y 401 sin token.
 *
 * Excluidas por diseño: las públicas (auth/setup/login/refresh y webauthn
 * authenticate/* + backup-codes/verify, ver US-88) y las de auto-servicio de
 * cualquier usuario autenticado (ver `AUTHED_WRITES`).
 */
const ADMIN_WRITES: WriteEndpoint[] = [
  // inventory
  { method: 'PATCH', url: '/api/inventory/devices/x', payload: { label: 'Salón' } },
  { method: 'POST', url: '/api/inventory/devices/x/block' },
  { method: 'DELETE', url: '/api/inventory/devices/x/block' },
  { method: 'PUT', url: '/api/inventory/devices/x/vlan', payload: { tag: 100 } },
  // wifi
  { method: 'PUT', url: '/api/wifi', payload: { ssid: 'MiWifi', password: 'secure123' } },
  { method: 'PUT', url: '/api/wifi/guest', payload: { enabled: true } },
  { method: 'PUT', url: '/api/wifi/networks/x', payload: { ssid: 'Red2' } },
  // vpn
  { method: 'POST', url: '/api/vpn/peers', payload: { name: 'Peer' } },
  { method: 'DELETE', url: '/api/vpn/peers/x' },
  // firewall
  { method: 'POST', url: '/api/firewall/rules', payload: { name: 'Regla', action: 'deny' } },
  { method: 'PATCH', url: '/api/firewall/rules/x', payload: { enabled: false } },
  { method: 'DELETE', url: '/api/firewall/rules/x' },
  // qos
  { method: 'POST', url: '/api/qos/rules', payload: { name: 'Regla', target: '192.168.1.10' } },
  { method: 'PATCH', url: '/api/qos/rules/x', payload: { priority: 'high' } },
  { method: 'DELETE', url: '/api/qos/rules/x' },
  // vlan
  { method: 'POST', url: '/api/vlans', payload: { tag: 100, name: 'Invitados' } },
  { method: 'PATCH', url: '/api/vlans/x', payload: { name: 'Renombrada' } },
  { method: 'DELETE', url: '/api/vlans/x' },
  // dns
  { method: 'POST', url: '/api/dns/blocklist', payload: { domain: 'ads.example.com' } },
  { method: 'DELETE', url: '/api/dns/blocklist/x' },
  // iot
  { method: 'PATCH', url: '/api/iot/devices/x', payload: { on: true } },
  // iot tuya (config de credenciales)
  {
    method: 'POST',
    url: '/api/iot/tuya/devices',
    payload: { deviceId: 'd1', localKey: 'k1', ip: '192.168.1.5', name: 'Enchufe' },
  },
  { method: 'PATCH', url: '/api/iot/tuya/devices/d1', payload: { name: 'Nuevo' } },
  { method: 'DELETE', url: '/api/iot/tuya/devices/d1' },
  // system
  { method: 'PATCH', url: '/api/system/settings', payload: { key: 'homeName', value: 'Hogar' } },
  { method: 'POST', url: '/api/system/connectivity-test' },
  { method: 'POST', url: '/api/system/regen-keys' },
];

/**
 * Rutas mutantes de **auto-servicio**: cualquier usuario autenticado (incluido un
 * viewer) puede usarlas para gestionar lo suyo, o son acciones de refresco. Deben:
 * exigir token (401 sin él) pero **no** bloquear a un viewer por rol (≠ 401 y ≠ 403).
 */
const AUTHED_WRITES: WriteEndpoint[] = [
  // refresco de inventario (equivalente al evento de socket `inventory:rescan`)
  { method: 'POST', url: '/api/inventory/rescan' },
  // push: gestionar la propia suscripción (US-45)
  {
    method: 'POST',
    url: '/api/push/subscribe',
    payload: { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } },
  },
  { method: 'DELETE', url: '/api/push/subscribe', payload: { endpoint: 'https://push.example/abc' } },
  // webauthn: gestionar las propias passkeys / códigos (US-50/US-59)
  { method: 'POST', url: '/api/webauthn/register/options' },
  { method: 'POST', url: '/api/webauthn/register/verify', payload: { response: { id: 'x' }, name: 'Llave' } },
  { method: 'POST', url: '/api/webauthn/backup-codes' },
  { method: 'PATCH', url: '/api/webauthn/credentials/x', payload: { name: 'Nuevo' } },
  { method: 'DELETE', url: '/api/webauthn/credentials/x' },
  // auth: gestionar las propias sesiones (US-41)
  { method: 'DELETE', url: '/api/auth/sessions/x' },
  // Body {} válido: la ruta valida un objeto antes de autenticar; sin cuerpo daría 400.
  { method: 'DELETE', url: '/api/auth/sessions', payload: {} },
];

describe('autorización exhaustiva de escritura (US-89)', () => {
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

  describe('rutas admin-only', () => {
    it.each(ADMIN_WRITES)('$method $url → 403 para un viewer', async ({ method, url, payload }) => {
      const res = await app.inject({ method, url, headers: authHeader(viewerToken), payload });
      expect(res.statusCode).toBe(403);
    });

    it.each(ADMIN_WRITES)('$method $url → 401 sin token', async ({ method, url, payload }) => {
      const res = await app.inject({ method, url, payload });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('rutas de auto-servicio (cualquier usuario autenticado)', () => {
    it.each(AUTHED_WRITES)('$method $url → 401 sin token', async ({ method, url, payload }) => {
      const res = await app.inject({ method, url, payload });
      expect(res.statusCode).toBe(401);
    });

    it.each(AUTHED_WRITES)(
      '$method $url NO bloquea a un viewer por rol (≠401, ≠403)',
      async ({ method, url, payload }) => {
        const res = await app.inject({ method, url, headers: authHeader(viewerToken), payload });
        expect(res.statusCode).not.toBe(401);
        expect(res.statusCode).not.toBe(403);
      },
    );
  });
});
