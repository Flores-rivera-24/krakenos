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
  // inventory
  {
    name: 'inventory: tipo de dispositivo fuera del enum',
    method: 'PATCH',
    url: '/api/inventory/devices/x',
    payload: { type: 'no-existe' },
  },
  {
    name: 'inventory: VLAN tag fuera de rango',
    method: 'PUT',
    url: '/api/inventory/devices/x/vlan',
    payload: { tag: 0 },
  },
  // wifi
  { name: 'wifi: contraseña demasiado corta', method: 'PUT', url: '/api/wifi', payload: { password: 'short' } },
  {
    name: 'wifi guest: ancho de banda fuera de rango',
    method: 'PUT',
    url: '/api/wifi/guest',
    payload: { bandwidthLimitMbps: 0 },
  },
  { name: 'wifi network: SSID vacío', method: 'PUT', url: '/api/wifi/networks/x', payload: { ssid: '' } },
  // vpn
  { name: 'vpn: nombre de peer vacío', method: 'POST', url: '/api/vpn/peers', payload: { name: '' } },
  // firewall
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
    name: 'firewall (patch): source con inyección',
    method: 'PATCH',
    url: '/api/firewall/rules/x',
    payload: { source: '1.2.3.4; rm' },
  },
  // qos
  {
    name: 'qos: ancho de banda fuera de rango',
    method: 'POST',
    url: '/api/qos/rules',
    payload: { name: 'Regla', target: 'x', uploadKbps: 20_000_000 },
  },
  {
    name: 'qos (patch): ancho de banda negativo',
    method: 'PATCH',
    url: '/api/qos/rules/x',
    payload: { downloadKbps: -1 },
  },
  // vlan
  { name: 'vlan: tag fuera de rango', method: 'POST', url: '/api/vlans', payload: { tag: 5000, name: 'V' } },
  {
    name: 'vlan (patch): nombre con espacios/metacaracteres',
    method: 'PATCH',
    url: '/api/vlans/x',
    payload: { name: 'mi vlan' },
  },
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
  {
    name: 'tuya (patch): IP vacía',
    method: 'PATCH',
    url: '/api/iot/tuya/devices/d1',
    payload: { ip: '' },
  },
  // system
  {
    name: 'system: clave de ajuste fuera del enum',
    method: 'PATCH',
    url: '/api/system/settings',
    payload: { key: 'no-existe', value: 'x' },
  },
  // push (auto-servicio)
  {
    name: 'push: suscripción sin keys',
    method: 'POST',
    url: '/api/push/subscribe',
    payload: { endpoint: 'https://push.example/abc' },
  },
  { name: 'push: baja sin endpoint', method: 'DELETE', url: '/api/push/subscribe', payload: {} },
  // webauthn (auto-servicio)
  {
    name: 'webauthn: register/verify sin response',
    method: 'POST',
    url: '/api/webauthn/register/verify',
    payload: { name: 'Llave' },
  },
  {
    name: 'webauthn: renombrar credencial sin nombre',
    method: 'PATCH',
    url: '/api/webauthn/credentials/x',
    payload: {},
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
