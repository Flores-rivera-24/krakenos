import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NoneCameraManager } from '../../src/cameras/none.cameras.js';
import { NoneDnsManager } from '../../src/dns/none.dns.js';
import { NoneDriver } from '../../src/drivers/none.driver.js';
import { NoneFirewallManager } from '../../src/firewall/none.firewall.js';
import { NoneIotManager } from '../../src/iot/none.iot.js';
import { NoneQosManager } from '../../src/qos/none.qos.js';
import { NoneVlanManager } from '../../src/vlan/none.vlan.js';
import { NoneVpnManager } from '../../src/vpn/none.vpn.js';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

/**
 * Las rutas de cada dominio contra su manager `none`: lecturas vacías (200) y escrituras con
 * 409 `DOMAIN_NOT_CONFIGURED`, sin que ninguna ruta lo sepa — lo pone el manager y lo sirve el
 * manejador global de errores.
 */
describe('rutas con los ocho dominios sin configurar', () => {
  let app: FastifyInstance;
  let admin: string;
  const auth = () => authHeader(admin);

  beforeAll(async () => {
    app = await buildTestApp({
      routes: true,
      driver: new NoneDriver(),
      vpn: new NoneVpnManager({ listenPort: 51820 }),
      firewall: new NoneFirewallManager(),
      qos: new NoneQosManager(),
      vlan: new NoneVlanManager(),
      dns: new NoneDnsManager(),
      iot: new NoneIotManager(),
      cameras: new NoneCameraManager(),
    });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
    admin = signAccess(app, await seedUser(app, { email: 'admin@krakenos.test', role: 'admin' }));
  });

  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
  ) => app.inject({ method, url, headers: auth(), ...(payload ? { payload } : {}) });

  describe('lecturas: vacías y 200, nunca datos de demostración', () => {
    const lecturas: [string, unknown][] = [
      ['/api/vpn/peers', []],
      ['/api/firewall/rules', []],
      ['/api/qos/rules', []],
      ['/api/vlans', []],
      ['/api/dns/blocklist', []],
      ['/api/dns/queries', []],
      ['/api/dns/feeds', []],
      ['/api/iot/devices', []],
      ['/api/cameras', []],
      ['/api/wifi/access-points', []],
      ['/api/wifi/networks', []],
    ];
    it.each(lecturas)('GET %s', async (url, esperado) => {
      const res = await call('GET', url);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(esperado);
    });

    it('el estado de la VPN dice que no hay servidor (no un servidor de mentira)', async () => {
      const res = await call('GET', '/api/vpn/status');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        enabled: false,
        publicKey: '',
        endpoint: null,
        peerCount: 0,
        capability: { status: 'not-configured', reason: 'not-configured' },
      });
    });

    it.each(['/api/firewall/status', '/api/qos/status'])(
      '%s declara not-configured (el MISMO aviso, no un segundo)',
      async (url) => {
        const res = await call('GET', url);
        expect(res.json()).toEqual({
          capability: { status: 'not-configured', reason: 'not-configured' },
        });
      },
    );

    it('el inventario está vacío y el barrido manual no inventa nada', async () => {
      const scan = await call('POST', '/api/inventory/rescan');
      expect(scan.statusCode).toBe(200);
      expect(scan.json()).toEqual([]);
      const list = await call('GET', '/api/inventory/devices');
      expect(list.json()).toEqual([]);
    });
  });

  describe('escrituras: 409 DOMAIN_NOT_CONFIGURED', () => {
    const escrituras: [string, 'POST' | 'PUT' | 'PATCH' | 'DELETE', string, object?][] = [
      ['vpn: alta de peer', 'POST', '/api/vpn/peers', { name: 'movil' }],
      ['vpn: baja de peer', 'DELETE', '/api/vpn/peers/x'],
      ['firewall: nueva regla', 'POST', '/api/firewall/rules', { name: 'r', action: 'deny' }],
      ['firewall: editar regla', 'PATCH', '/api/firewall/rules/x', { enabled: false }],
      ['firewall: borrar regla', 'DELETE', '/api/firewall/rules/x'],
      ['qos: nueva regla', 'POST', '/api/qos/rules', { name: 'r', target: '192.168.1.5' }],
      ['qos: editar regla', 'PATCH', '/api/qos/rules/x', { enabled: false }],
      ['qos: borrar regla', 'DELETE', '/api/qos/rules/x'],
      ['vlan: nueva', 'POST', '/api/vlans', { tag: 20, name: 'IoT' }],
      ['vlan: editar', 'PATCH', '/api/vlans/x', { name: 'otra' }],
      ['vlan: borrar', 'DELETE', '/api/vlans/x'],
      ['dns: bloquear dominio', 'POST', '/api/dns/blocklist', { domain: 'ads.example.com' }],
      ['dns: desbloquear', 'DELETE', '/api/dns/blocklist/x'],
      ['dns: activar feed', 'PATCH', '/api/dns/feeds/x', { enabled: true }],
      ['iot: mandar un cambio a un aparato', 'PATCH', '/api/iot/devices/x', { on: true }],
      [
        'cámaras: alta (escribe en un almacén propio)',
        'POST',
        '/api/cameras',
        {
          name: 'Entrada',
          rtspUrl: 'rtsp://192.168.1.50/stream',
        },
      ],
      ['cámaras: baja', 'DELETE', '/api/cameras/x'],
      ['wifi: cambiar la red', 'PUT', '/api/wifi', { ssid: 'Casa' }],
      ['wifi: red de invitados', 'PUT', '/api/wifi/guest', { enabled: true }],
      [
        'acceso: pausar internet de un aparato',
        'POST',
        '/api/access/pause',
        {
          mac: 'aa:bb:cc:dd:ee:ff',
          minutes: 30,
        },
      ],
    ];

    it.each(escrituras)('%s', async (_nombre, method, url, payload) => {
      const res = await call(method, url, payload);
      expect(res.statusCode, `${method} ${url} → ${res.body}`).toBe(409);
      expect(res.json()).toMatchObject({ code: 'DOMAIN_NOT_CONFIGURED' });
    });

    it('lleva copy nuestro, sin detalles internos', async () => {
      const res = await call('POST', '/api/vpn/peers', { name: 'movil' });
      const { message } = res.json() as { message: string };
      expect(message).toContain('Conecta');
      expect(message).not.toMatch(/stack|prisma|errno/i);
    });

    it('bloquear un aparato desde el inventario no lo marca como bloqueado en la base', async () => {
      // El driver falla ANTES de tocar la base: si no, el panel diría «Bloqueado» sin router.
      const dev = await app.prisma.device.create({
        data: { mac: 'aa:bb:cc:00:00:01', ip: '192.168.1.9', online: true, sources: '["arp"]' },
      });
      const res = await call('POST', `/api/inventory/devices/${dev.id}/block`);
      expect(res.statusCode).toBe(409);
      const after = await app.prisma.device.findUnique({ where: { id: dev.id } });
      expect(after?.isBlocked).toBe(false);
    });

    it('pausar a una persona (varios aparatos a la vez) es un 409, no un 200 con «0 aplicados»', async () => {
      const persona = await seedUser(app, { email: 'ana@krakenos.test', role: 'member' });
      const res = await call('POST', `/api/people/${persona.id}/pause`, { minutes: 30 });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ code: 'DOMAIN_NOT_CONFIGURED' });
      // Y no deja una pausa fingida en la base.
      expect(await app.prisma.device.count({ where: { pausedUntil: { not: null } } })).toBe(0);
    });

    it('pausar un aparato tampoco deja `pausedUntil` escrito', async () => {
      await app.prisma.device.create({
        data: { mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.8', online: true, sources: '["arp"]' },
      });
      const res = await call('POST', '/api/access/pause', {
        mac: 'aa:bb:cc:dd:ee:ff',
        minutes: 30,
      });
      expect(res.statusCode).toBe(409);
      expect(await app.prisma.device.count({ where: { pausedUntil: { not: null } } })).toBe(0);
    });
  });
});
