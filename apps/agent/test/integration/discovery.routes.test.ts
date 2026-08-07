import type { DiscoveryStatus } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DiscoveryService } from '../../src/modules/discovery/discovery.service.js';
import type {
  DiscoveryProbeResponse,
  DiscoveryTransport,
} from '../../src/discovery/transport.js';
import { IntegrationConfigStore } from '../../src/integrations/integration-config.store.js';
import { createSecretbox, generateSecretboxKey } from '../../src/config/secretbox.js';
import {
  authHeader,
  buildTestApp,
  resetDb,
  seedUser,
  signAccess,
  sleep,
} from '../helpers/app.js';
import { esperarAuditoria } from '../helpers/audit.js';

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

/** Store de integraciones para los tests que tocan la config guardada (US-249). */
const store = (app: FastifyInstance) =>
  new IntegrationConfigStore(app.prisma, createSecretbox(generateSecretboxKey()));

/** Auto-descubrimiento de IoT (US-175) + alta de un toque (US-249). */
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

  it('el APARATO ya configurado no se vuelve a sugerir (US-249)', async () => {
    // ⚠️ Este test fijaba el comportamiento viejo —bastaba con que el `kind`
    // estuviera configurado— y US-249 lo cambia **a propósito**: se compara
    // aparato a aparato, porque lo otro enterraba el segundo Shelly de la casa.
    const transport = new FakeTransport({
      '239.255.255.250': [ssdp('hue-bridgeid: X', '192.168.1.2')],
    });
    const service = new DiscoveryService(app, transport, 1, store(app));
    await service.scanCycle();

    // Configurado el kind pero SIN ese bridge: la sugerencia sigue siendo útil.
    await app.prisma.integrationConfig.create({
      data: { domain: 'iot', kind: 'hue,shelly', config: '{}', enabled: true },
    });
    expect((await service.status()).suggestions).toHaveLength(1);

    // Con su URL guardada, ya está: se deja de sugerir.
    await app.prisma.integrationConfig.update({
      where: { domain: 'iot' },
      data: { config: JSON.stringify({ 'hue.bridgeUrl': 'http://192.168.1.2' }) },
    });
    expect((await service.status()).suggestions).toHaveLength(0);

    // Deshabilitada no cuenta: vuelve a sugerirse.
    await app.prisma.integrationConfig.update({ where: { domain: 'iot' }, data: { enabled: false } });
    expect((await service.status()).suggestions).toHaveLength(1);
  });

  it('⚠️ el SEGUNDO aparato de un backend ya configurado sigue apareciendo (US-249)', async () => {
    // El fallo que cierra la historia: quien conectaba un Shelly no volvía a ver
    // ninguno más, nunca, y sin ninguna pista de por qué.
    await app.prisma.integrationConfig.create({
      data: {
        domain: 'iot',
        kind: 'shelly',
        config: JSON.stringify({ 'shelly.devices': '[{"ip":"192.168.1.80"}]' }),
        enabled: true,
      },
    });
    const service = new DiscoveryService(
      app,
      new FakeTransport({ '239.255.255.250': [ssdp('SERVER: Shelly/1.0', '192.168.1.81')] }),
      1,
      store(app),
    );
    await service.scanCycle();

    const status = await service.status();
    expect(status.suggestions.map((s) => s.ip)).toEqual(['192.168.1.81']);
    expect(status.suggestions[0]?.adoptable).toBe(true);
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

    expect(await esperarAuditoria(app, { action: 'discovery.scan' })).toHaveLength(1);
    expect(await esperarAuditoria(app, { action: 'discovery.dismiss' })).toHaveLength(1);
  });
});

/**
 * Alta de un toque (US-249) **por HTTP**: el camino real que recorre el usuario
 * desde la tarjeta de sugerencia, con su auditoría y su config guardada.
 */
describe('alta de un toque desde el descubrimiento (US-249)', () => {
  let app: FastifyInstance;
  let adminToken: string;

  /** Sondas SSDP que verá el próximo `POST /api/discovery/scan`. */
  const probes = (a: FastifyInstance) =>
    (a as unknown as { discoveryProbes: DiscoveryProbeResponse[] }).discoveryProbes;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    probes(app).length = 0;
    adminToken = signAccess(app, await seedUser(app, { role: 'admin' }));
  });

  /** Siembra una sugerencia y devuelve el estado tras el barrido. */
  async function descubrir(headers: string, from: string): Promise<DiscoveryStatus> {
    probes(app).push(ssdp(headers, from));
    const res = await app.inject({
      method: 'POST',
      url: '/api/discovery/scan',
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);
    return res.json() as DiscoveryStatus;
  }

  it('un Shelly descubierto se da de alta con un toque y deja de sugerirse', async () => {
    const antes = await descubrir('SERVER: Shelly/1.0', '192.168.1.80');
    expect(antes.suggestions[0]).toMatchObject({ kind: 'shelly', adoptable: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/discovery/suggestions/shelly%3A192.168.1.80/adopt',
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);
    // La respuesta ya trae el estado nuevo: la sugerencia adoptada desaparece.
    expect((res.json() as DiscoveryStatus).suggestions).toHaveLength(0);

    const row = await app.prisma.integrationConfig.findUnique({ where: { domain: 'iot' } });
    expect(row?.kind).toContain('shelly');
    expect(JSON.parse(JSON.parse(row?.config ?? '{}')['shelly.devices'])).toEqual([
      expect.objectContaining({ ip: '192.168.1.80' }),
    ]);

    expect(await esperarAuditoria(app, { action: 'discovery.adopt' })).toHaveLength(1);
  });

  it('⚠️ adoptar el segundo AÑADE, no reemplaza', async () => {
    await descubrir('SERVER: Shelly/1.0', '192.168.1.80');
    await app.inject({
      method: 'POST',
      url: '/api/discovery/suggestions/shelly%3A192.168.1.80/adopt',
      headers: authHeader(adminToken),
    });
    await descubrir('SERVER: Shelly/1.0', '192.168.1.81');
    const res = await app.inject({
      method: 'POST',
      url: '/api/discovery/suggestions/shelly%3A192.168.1.81/adopt',
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);

    const row = await app.prisma.integrationConfig.findUnique({ where: { domain: 'iot' } });
    const devices = JSON.parse(JSON.parse(row?.config ?? '{}')['shelly.devices']) as { ip: string }[];
    expect(devices.map((d) => d.ip)).toEqual(['192.168.1.80', '192.168.1.81']);
  });

  it('lo que necesita un secreto NO se adopta: responde 400 y manda al asistente', async () => {
    const status = await descubrir('hue-bridgeid: ECB5FA', '192.168.1.2');
    expect(status.suggestions[0]).toMatchObject({ kind: 'hue', adoptable: false });

    const res = await app.inject({
      method: 'POST',
      url: '/api/discovery/suggestions/hue%3A192.168.1.2/adopt',
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'DISCOVERY_NEEDS_INPUT' });
    // Y no se ha escrito ninguna config a medias.
    expect(await app.prisma.integrationConfig.findUnique({ where: { domain: 'iot' } })).toBeNull();
  });

  it('una sugerencia que ya no existe da 404 y no rompe', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/discovery/suggestions/shelly%3A10.0.0.9/adopt',
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'SUGGESTION_NOT_FOUND' });
  });

  it('adoptar es admin: un viewer no puede', async () => {
    const viewer = signAccess(app, await seedUser(app, { email: 'v2@krakenos.test', role: 'viewer' }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/discovery/suggestions/shelly%3A192.168.1.80/adopt',
      headers: authHeader(viewer),
    });
    expect(res.statusCode).toBe(403);
  });
});
