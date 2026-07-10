import type { DiscoveryStatus } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DiscoveryService } from '../../src/modules/discovery/discovery.service.js';
import type {
  DiscoveryProbeResponse,
  DiscoveryTransport,
} from '../../src/discovery/transport.js';
import {
  authHeader,
  buildTestApp,
  eventually,
  resetDb,
  seedUser,
  signAccess,
  sleep,
} from '../helpers/app.js';

/** Respuesta SSDP sintética (más simple de fabricar que un datagrama DNS). */
function ssdp(headers: string, from: string): DiscoveryProbeResponse {
  return { data: Buffer.from(`HTTP/1.1 200 OK\r\n${headers}\r\n\r\n`), from };
}

/** Transporte fake: graba los destinos y devuelve fixtures por grupo. */
class FakeTransport implements DiscoveryTransport {
  readonly targets: string[] = [];
  constructor(
    private readonly responses: Record<string, DiscoveryProbeResponse[]> = {},
    private readonly delayMs = 0,
  ) {}

  async probe(group: string, port: number): Promise<DiscoveryProbeResponse[]> {
    this.targets.push(`${group}:${port}`);
    if (this.delayMs > 0) await sleep(this.delayMs);
    return this.responses[group] ?? [];
  }
}

/** Auto-descubrimiento de IoT (US-175). */
describe('auto-descubrimiento (US-175)', () => {
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
    adminToken = signAccess(app, await seedUser(app, { role: 'admin' }));
  });

  it('un barrido convierte las respuestas en sugerencias visibles', async () => {
    const transport = new FakeTransport({
      '239.255.255.250': [
        ssdp('SERVER: Hue/1.0 IpBridge/1.60.0\r\nhue-bridgeid: ECB5FA', '192.168.1.2'),
        ssdp('SERVER: Samsung TV UPnP/1.0', '192.168.1.90'), // desconocido: se ignora
      ],
    });
    const service = new DiscoveryService(app, transport, 1);
    await service.scanCycle();

    const status = await service.status();
    expect(status.suggestions).toHaveLength(1);
    expect(status.suggestions[0]).toMatchObject({
      id: 'hue:192.168.1.2',
      kind: 'hue',
      prefill: { bridgeUrl: 'http://192.168.1.2' },
    });
    expect(status.lastScanAt).not.toBeNull();
  });

  it('no-egress: el sondeo solo toca los grupos multicast de la LAN', async () => {
    const transport = new FakeTransport();
    const service = new DiscoveryService(app, transport, 1);
    await service.scanCycle();

    expect(transport.targets).toHaveLength(2);
    for (const target of transport.targets) {
      expect(['224.0.0.251:5353', '239.255.255.250:1900']).toContain(target);
    }
  });

  it('coalescing por descarte: un barrido en curso ignora los disparos extra', async () => {
    const transport = new FakeTransport({}, 50);
    const service = new DiscoveryService(app, transport, 1);
    await Promise.all([service.scanCycle(), service.scanCycle(), service.scanCycle()]);
    // Un solo barrido real = 2 sondeos (mDNS + SSDP), no 6.
    expect(transport.targets).toHaveLength(2);
  });

  it('descartar una sugerencia persiste y sobrevive a re-detecciones', async () => {
    const transport = new FakeTransport({
      '239.255.255.250': [ssdp('hue-bridgeid: X', '192.168.1.2')],
    });
    const service = new DiscoveryService(app, transport, 1);
    await service.scanCycle();
    await service.dismiss('hue:192.168.1.2');

    await service.scanCycle(); // el aparato sigue en la red y se re-detecta
    const status = await service.status();
    expect(status.suggestions).toHaveLength(0);

    const row = await app.prisma.setting.findUnique({ where: { key: 'discovery.dismissed' } });
    expect(JSON.parse(row?.value ?? '[]')).toContain('hue:192.168.1.2');
  });

  it('un backend ya configurado desde la UI no se vuelve a sugerir', async () => {
    const transport = new FakeTransport({
      '239.255.255.250': [ssdp('hue-bridgeid: X', '192.168.1.2')],
    });
    const service = new DiscoveryService(app, transport, 1);
    await service.scanCycle();

    await app.prisma.integrationConfig.create({
      data: { domain: 'iot', kind: 'hue,shelly', config: '{}', enabled: true },
    });
    expect((await service.status()).suggestions).toHaveLength(0);

    // Deshabilitada no cuenta: vuelve a sugerirse.
    await app.prisma.integrationConfig.update({ where: { domain: 'iot' }, data: { enabled: false } });
    expect((await service.status()).suggestions).toHaveLength(1);
  });

  it('las sugerencias en memoria están acotadas: una LAN hostil no infla el mapa sin límite', async () => {
    // 150 "bridges Hue" fabricados con IPs distintas en un solo barrido.
    const flood = Array.from({ length: 150 }, (_, i) =>
      ssdp('hue-bridgeid: X', `10.0.${Math.floor(i / 250)}.${(i % 250) + 1}`),
    );
    const service = new DiscoveryService(app, new FakeTransport({ '239.255.255.250': flood }), 1);
    await service.scanCycle();
    expect((await service.status()).suggestions.length).toBeLessThanOrEqual(100);
  });

  it('un ajuste discovery.dismissed corrupto se ignora sin romper el listado', async () => {
    await app.prisma.setting.create({ data: { key: 'discovery.dismissed', value: '{corrupto' } });
    const transport = new FakeTransport({
      '239.255.255.250': [ssdp('hue-bridgeid: X', '192.168.1.2')],
    });
    const service = new DiscoveryService(app, transport, 1);
    await service.scanCycle();
    expect((await service.status()).suggestions).toHaveLength(1);
  });

  it('GET /api/discovery exige autenticación; el barrido y el descarte, admin', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/discovery' });
    expect(anon.statusCode).toBe(401);

    const ok = await app.inject({ method: 'GET', url: '/api/discovery', headers: authHeader(adminToken) });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as DiscoveryStatus).suggestions).toEqual([]);

    const viewer = signAccess(app, await seedUser(app, { email: 'v@krakenos.test', role: 'viewer' }));
    const scan = await app.inject({ method: 'POST', url: '/api/discovery/scan', headers: authHeader(viewer) });
    expect(scan.statusCode).toBe(403);
    const dismiss = await app.inject({
      method: 'DELETE',
      url: '/api/discovery/suggestions/hue%3A192.168.1.2',
      headers: authHeader(viewer),
    });
    expect(dismiss.statusCode).toBe(403);
  });

  it('el barrido bajo demanda y el descarte quedan auditados', async () => {
    const scan = await app.inject({
      method: 'POST',
      url: '/api/discovery/scan',
      headers: authHeader(adminToken),
    });
    expect(scan.statusCode).toBe(200);

    const dismiss = await app.inject({
      method: 'DELETE',
      url: '/api/discovery/suggestions/hue%3A192.168.1.2',
      headers: authHeader(adminToken),
    });
    expect(dismiss.statusCode).toBe(204);

    await eventually(async () => {
      expect(await app.prisma.auditLog.count({ where: { action: 'discovery.scan' } })).toBe(1);
      expect(await app.prisma.auditLog.count({ where: { action: 'discovery.dismiss' } })).toBe(1);
    });
  });
});
