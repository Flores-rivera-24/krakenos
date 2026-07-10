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
  { method: 'PATCH', url: '/api/dns/feeds/ads', payload: { enabled: true } },
  // access schedules / control parental (US-108)
  {
    method: 'POST',
    url: '/api/access/schedules',
    payload: { name: 'Noche', mac: 'aa:bb:cc:dd:ee:ff', days: [1], startMinute: 1260, endMinute: 420 },
  },
  { method: 'PATCH', url: '/api/access/schedules/x', payload: { enabled: false } },
  { method: 'DELETE', url: '/api/access/schedules/x' },
  { method: 'POST', url: '/api/access/pause', payload: { mac: 'aa:bb:cc:dd:ee:ff', minutes: 30 } },
  { method: 'POST', url: '/api/access/resume', payload: { mac: 'aa:bb:cc:dd:ee:ff' } },
  // reglas de alerta (US-112)
  { method: 'PATCH', url: '/api/alerts/rules/device.block', payload: { email: true } },

  // habitaciones y grupos (US-165)
  { method: 'POST', url: '/api/rooms', payload: { name: 'Salón' } },
  { method: 'PATCH', url: '/api/rooms/x', payload: { name: 'Salón' } },
  { method: 'DELETE', url: '/api/rooms/x' },
  { method: 'PUT', url: '/api/rooms/assign', payload: { kind: 'iot', ref: 'light-salon', roomId: null } },
  { method: 'POST', url: '/api/rooms/x/action', payload: { on: false } },

  // escenas (US-166)
  { method: 'POST', url: '/api/scenes', payload: { name: 'Noche', actions: [] } },
  { method: 'PATCH', url: '/api/scenes/x', payload: { name: 'Noche' } },
  { method: 'DELETE', url: '/api/scenes/x' },
  { method: 'POST', url: '/api/scenes/x/run' },

  // horarios IoT (US-168)
  {
    method: 'POST',
    url: '/api/iot-schedules',
    payload: {
      name: 'Riego',
      days: [1],
      time: { kind: 'fixed', minute: 420 },
      target: { type: 'device', deviceId: 'plug-cafetera', on: true },
    },
  },
  { method: 'PATCH', url: '/api/iot-schedules/x', payload: { enabled: false } },
  { method: 'DELETE', url: '/api/iot-schedules/x' },
  // automatizaciones (US-167)
  {
    method: 'POST',
    url: '/api/automations',
    payload: {
      name: 'Regla',
      trigger: { type: 'device-new' },
      actions: [{ type: 'notify', message: 'x' }],
    },
  },
  { method: 'PATCH', url: '/api/automations/x', payload: { enabled: false } },
  { method: 'DELETE', url: '/api/automations/x' },
  // auto-descubrimiento (US-175)
  { method: 'POST', url: '/api/discovery/scan' },
  { method: 'DELETE', url: '/api/discovery/suggestions/hue%3A192.168.1.2' },
  // iot
  { method: 'PATCH', url: '/api/iot/devices/x', payload: { on: true } },
  // comisionado Matter (US-172): admin-only (el mock no lo soporta → 409, no 403)
  { method: 'POST', url: '/api/iot/matter/commission', payload: { code: 'MT:ABC123XYZ' } },
  // iot tuya (config de credenciales)
  {
    method: 'POST',
    url: '/api/iot/tuya/devices',
    payload: { deviceId: 'd1', localKey: 'k1', ip: '192.168.1.5', name: 'Enchufe' },
  },
  { method: 'PATCH', url: '/api/iot/tuya/devices/d1', payload: { name: 'Nuevo' } },
  { method: 'DELETE', url: '/api/iot/tuya/devices/d1' },
  // energía (US-182): precio del kWh / moneda del hogar
  { method: 'PUT', url: '/api/energy/config', payload: { pricePerKwh: 0.15 } },
  // alertas de energía (US-183)
  {
    method: 'POST',
    url: '/api/energy/alerts',
    payload: { deviceId: 'plug-tv', metric: 'sustained-power', threshold: 500 },
  },
  { method: 'PATCH', url: '/api/energy/alerts/x', payload: { enabled: false } },
  { method: 'DELETE', url: '/api/energy/alerts/x' },
  // puente Matter (US-171)
  { method: 'PUT', url: '/api/matter-bridge', payload: { enabled: false } },
  // system
  { method: 'PATCH', url: '/api/system/settings', payload: { key: 'homeName', value: 'Hogar' } },
  { method: 'POST', url: '/api/system/connectivity-test' },
  { method: 'POST', url: '/api/system/regen-keys' },
  { method: 'POST', url: '/api/system/backup', payload: { passphrase: 'passphrase-123' } },
  { method: 'POST', url: '/api/system/restore', payload: { passphrase: 'passphrase-123', data: 'AAAA' } },
  // users (US-101)
  {
    method: 'POST',
    url: '/api/users',
    payload: { email: 'nuevo@krakenos.test', displayName: 'Nuevo', password: 'password123', role: 'viewer' },
  },
  { method: 'PATCH', url: '/api/users/x', payload: { displayName: 'Cambiado' } },
  { method: 'POST', url: '/api/users/x/password', payload: { password: 'password123' } },
  { method: 'DELETE', url: '/api/users/x' },
];

/**
 * Rutas mutantes de **auto-servicio**: cualquier usuario autenticado (incluido un
 * viewer) puede usarlas para gestionar lo suyo, o son acciones de refresco. Deben:
 * exigir token (401 sin él) pero **no** bloquear a un viewer por rol (≠ 401 y ≠ 403).
 */
const AUTHED_WRITES: WriteEndpoint[] = [
  // refresco de inventario (equivalente al evento de socket `inventory:rescan`)
  { method: 'POST', url: '/api/inventory/rescan' },
  // captura del estado IoT actual para el editor de escenas (solo lee, US-166)
  { method: 'POST', url: '/api/scenes/capture', payload: { deviceIds: ['light-salon'] } },
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
  // favoritos: gestionar los propios (US-170)
  { method: 'POST', url: '/api/favorites', payload: { kind: 'iot', ref: 'light-salon' } },
  { method: 'DELETE', url: '/api/favorites/x' },
  { method: 'PUT', url: '/api/favorites/order', payload: { ids: [] } },
  // auth: gestionar las propias sesiones (US-41)
  { method: 'DELETE', url: '/api/auth/sessions/x' },
  // Body {} válido: la ruta valida un objeto antes de autenticar; sin cuerpo daría 400.
  { method: 'DELETE', url: '/api/auth/sessions', payload: {} },
  // auth: cambiar la propia contraseña (US-101). La contraseña actual coincide con
  // la del viewer sembrado (seedUser → 'password123'), así el viewer no se bloquea.
  {
    method: 'POST',
    url: '/api/auth/change-password',
    payload: { currentPassword: 'password123', newPassword: 'nuevaClave123' },
  },
  // auth: cambiar el propio modo de interfaz (US-176)
  { method: 'PATCH', url: '/api/auth/ui-mode', payload: { uiMode: 'simple' } },
  // auth: cambiar el propio idioma de interfaz (US-177)
  { method: 'PATCH', url: '/api/auth/locale', payload: { locale: 'en' } },
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
