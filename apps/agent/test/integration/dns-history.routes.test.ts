import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DnsHistoryService } from '../../src/modules/dns/dns-history.service.js';
import { pruneDnsQueryLog } from '../../src/config/retention.js';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

/**
 * US-252. El histórico DNS es el historial de navegación del hogar, así que lo
 * que se prueba aquí no es «devuelve filas»: es **quién puede ver cuáles**, que
 * el aparato se resuelva en la ingesta y que la poda se lleve lo viejo dejando lo
 * reciente.
 */
describe('histórico DNS', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
  });

  /** Siembra dos aparatos con dueños distintos y una consulta de cada uno. */
  async function sembrarDosHogares() {
    const admin = await seedUser(app, { email: 'admin@krakenos.test', role: 'admin' });
    const marta = await seedUser(app, { email: 'marta@krakenos.test', role: 'member' });
    const pablo = await seedUser(app, { email: 'pablo@krakenos.test', role: 'member' });

    await app.prisma.device.createMany({
      data: [
        { mac: 'aa:00', ip: '192.168.1.10', label: 'Tablet de Marta', ownerId: marta.id, online: true },
        { mac: 'bb:00', ip: '192.168.1.11', label: 'Portátil de Pablo', ownerId: pablo.id, online: true },
        { mac: 'cc:00', ip: '192.168.1.12', label: 'Aparato sin dueño', online: true },
      ],
    });
    await app.prisma.dnsQueryLog.createMany({
      data: [
        { timestamp: new Date(), domain: 'marta.example', client: '192.168.1.10', blocked: false, mac: 'aa:00' },
        { timestamp: new Date(), domain: 'pablo.example', client: '192.168.1.11', blocked: false, mac: 'bb:00' },
        { timestamp: new Date(), domain: 'huerfana.example', client: '192.168.1.99', blocked: true, mac: null },
      ],
    });
    return { admin, marta, pablo };
  }

  it('un admin ve el hogar entero, incluidas las consultas sin aparato atribuido', async () => {
    const { admin } = await sembrarDosHogares();
    const res = await app.inject({
      method: 'GET',
      url: '/api/dns/history',
      headers: authHeader(signAccess(app, admin)),
    });
    expect(res.statusCode).toBe(200);
    const dominios = res.json().entries.map((e: { domain: string }) => e.domain).sort();
    expect(dominios).toEqual(['huerfana.example', 'marta.example', 'pablo.example']);
  });

  it('⚠️ un member ve SOLO sus aparatos, ni los de otros ni los no atribuidos', async () => {
    const { marta } = await sembrarDosHogares();
    const res = await app.inject({
      method: 'GET',
      url: '/api/dns/history',
      headers: authHeader(signAccess(app, marta)),
    });
    expect(res.statusCode).toBe(200);
    const entries = res.json().entries as { domain: string; deviceLabel: string }[];
    // Asimétrico: 1 suya de 3 totales, así que invertir el filtro no da el mismo número.
    expect(entries).toHaveLength(1);
    expect(entries[0]!.domain).toBe('marta.example');
    expect(entries[0]!.deviceLabel).toBe('Tablet de Marta');
  });

  it('un viewer sin aparatos propios ve una lista vacía, no un 403', async () => {
    await sembrarDosHogares();
    const nadie = await seedUser(app, { email: 'nadie@krakenos.test', role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/dns/history',
      headers: authHeader(signAccess(app, nadie)),
    });
    // No le falta permiso: le faltan aparatos. Un 403 le diría que hay algo que ocultar.
    expect(res.statusCode).toBe(200);
    expect(res.json().entries).toHaveLength(0);
  });

  it('⚠️ la respuesta NO publica la IP del cliente', async () => {
    const { admin } = await sembrarDosHogares();
    const res = await app.inject({
      method: 'GET',
      url: '/api/dns/history',
      headers: authHeader(signAccess(app, admin)),
    });
    // El mapa IP→persona es justo lo que esta vista existe para no repartir.
    expect(res.payload).not.toContain('192.168.1.10');
    expect(res.payload).not.toContain('192.168.1.99');
  });

  it('exige autenticación', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/dns/history' });
    expect(res.statusCode).toBe(401);
  });

  it('la cobertura cuenta los aparatos en línea que no han consultado nada', async () => {
    const { admin } = await sembrarDosHogares();
    const res = await app.inject({
      method: 'GET',
      url: '/api/dns/history',
      headers: authHeader(signAccess(app, admin)),
    });
    const { coverage } = res.json();
    // 3 en línea; 2 con consultas atribuidas → 1 callado (el de la consulta huérfana
    // no cuenta: esa fila no está atribuida a ningún aparato).
    expect(coverage.onlineDevices).toBe(3);
    expect(coverage.silentDevices).toBe(1);
    expect(coverage.recording).toBe(true);
    expect(coverage.retentionDays).toBe(7);
  });

  it('sin ninguna consulta, `recording` es false: la tabla vacía es eso y no «silencio»', async () => {
    const admin = await seedUser(app, { email: 'a@krakenos.test', role: 'admin' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/dns/history',
      headers: authHeader(signAccess(app, admin)),
    });
    expect(res.json().coverage.recording).toBe(false);
  });

  it('un admin borra el histórico y queda auditado', async () => {
    const { admin } = await sembrarDosHogares();
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/dns/history',
      headers: authHeader(signAccess(app, admin)),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().removed).toBe(3);
    expect(await app.prisma.dnsQueryLog.count()).toBe(0);

    const audit = await app.prisma.auditLog.findFirst({ where: { action: 'dns.history.clear' } });
    expect(audit).not.toBeNull();
  });
});

describe('ingesta y poda del histórico DNS', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ routes: false });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
  });

  /** Resolver de mentira que devuelve siempre las mismas consultas. */
  const resolverCon = (queries: { domain: string; client: string; ms: number }[]) =>
    ({
      recentQueries: async () =>
        queries.map((q) => ({
          timestamp: new Date(q.ms).toISOString(),
          domain: q.domain,
          client: q.client,
          blocked: false,
        })),
    }) as never;

  it('resuelve la IP al aparato EN LA INGESTA y no vuelve a ingerir lo mismo', async () => {
    await app.prisma.device.create({
      data: { mac: 'aa:00', ip: '192.168.1.10', label: 'Tablet', online: true },
    });
    const service = new DnsHistoryService(
      app,
      resolverCon([{ domain: 'ejemplo.com', client: '192.168.1.10', ms: 1_000_000 }]),
    );

    expect(await service.ingestOnce()).toBe(1);
    const fila = await app.prisma.dnsQueryLog.findFirst();
    expect(fila?.mac).toBe('aa:00');

    // Segundo barrido con la misma ventana: no duplica.
    expect(await service.ingestOnce()).toBe(0);
    expect(await app.prisma.dnsQueryLog.count()).toBe(1);
  });

  it('⚠️ la IP reasignada NO reescribe a quién pertenecía la consulta vieja', async () => {
    // El caso que hace daño: la tablet de Marta tenía la .10 ayer y hoy la tiene el
    // portátil de Pablo. Si la MAC se resolviera al leer, la navegación de Marta
    // aparecería como de Pablo.
    await app.prisma.device.create({
      data: { mac: 'marta:00', ip: '192.168.1.10', label: 'Tablet de Marta', online: true },
    });
    const service = new DnsHistoryService(
      app,
      resolverCon([{ domain: 'ayer.example', client: '192.168.1.10', ms: 1_000_000 }]),
    );
    await service.ingestOnce();

    // El DHCP le da esa IP a otro aparato.
    await app.prisma.device.update({ where: { mac: 'marta:00' }, data: { ip: '192.168.1.50' } });
    await app.prisma.device.create({
      data: { mac: 'pablo:00', ip: '192.168.1.10', label: 'Portátil de Pablo', online: true },
    });

    const fila = await app.prisma.dnsQueryLog.findFirst({ where: { domain: 'ayer.example' } });
    expect(fila?.mac).toBe('marta:00');
  });

  it('una IP que no está en el inventario se guarda sin atribuir, no se descarta', async () => {
    const service = new DnsHistoryService(
      app,
      resolverCon([{ domain: 'desconocido.example', client: '10.9.9.9', ms: 1_000_000 }]),
    );
    expect(await service.ingestOnce()).toBe(1);
    expect((await app.prisma.dnsQueryLog.findFirst())?.mac).toBeNull();
  });

  it('un resolver caído no tumba la ingesta ni mueve la marca', async () => {
    const roto = {
      recentQueries: async () => {
        throw new Error('resolver apagado');
      },
    } as never;
    const service = new DnsHistoryService(app, roto);
    expect(await service.ingestOnce()).toBe(0);
    expect(await app.prisma.dnsQueryLog.count()).toBe(0);
  });

  it('la poda se lleva lo viejo Y DEJA lo reciente', async () => {
    const ahora = Date.now();
    await app.prisma.dnsQueryLog.createMany({
      data: [
        { timestamp: new Date(ahora - 8 * 24 * 60 * 60 * 1000), domain: 'vieja.example', client: '1.1.1.1', blocked: false },
        { timestamp: new Date(ahora - 30 * 24 * 60 * 60 * 1000), domain: 'antigua.example', client: '1.1.1.1', blocked: false },
        { timestamp: new Date(ahora - 60 * 60 * 1000), domain: 'reciente.example', client: '1.1.1.1', blocked: false },
      ],
    });

    const borradas = await pruneDnsQueryLog(app.prisma);
    expect(borradas).toBe(2);
    const quedan = await app.prisma.dnsQueryLog.findMany();
    // Comprobar solo el borrado dejaría pasar una poda que se lo lleva todo.
    expect(quedan.map((q) => q.domain)).toEqual(['reciente.example']);
  });
});
