import type { AlertRule } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DigestService, buildDigest } from '../../src/alerts/digest.js';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

const MONDAY = new Date(2026, 6, 6); // 2026-07-06 es lunes
const at = (base: Date, h: number, m: number) =>
  new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m);

/** Resumen del hogar + canal Telegram en reglas (US-180). */
describe('resumen del hogar (US-180)', () => {
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

  function makeService() {
    const sent: { channel: string; title: string; body: string }[] = [];
    const service = new DigestService(app, {
      push: async (title, body) => {
        sent.push({ channel: 'push', title, body });
      },
      email: (title, body) => {
        sent.push({ channel: 'email', title, body });
      },
      telegram: (title, body) => {
        sent.push({ channel: 'telegram', title, body });
      },
    });
    return { service, sent };
  }

  async function seedActivity(now: Date) {
    const user = await seedUser(app, {
      email: 'persona@krakenos.test',
      role: 'member',
      displayName: 'Ana',
    });
    await app.prisma.device.create({
      data: {
        mac: 'aa:bb:cc:dd:0d:01',
        ip: '10.0.0.30',
        label: 'Tele del salón',
        firstSeen: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        ownerId: user.id,
      },
    });
    await app.prisma.auditLog.create({
      data: { action: 'device.block', detail: 'aa:bb', createdAt: now },
    });
    const rule = await app.prisma.automationRule.create({
      data: { name: 'R', trigger: '{"type":"device-new"}', actions: '[]' },
    });
    await app.prisma.automationRun.createMany({
      data: [
        { ruleId: rule.id, event: 'x', ok: true },
        { ruleId: rule.id, event: 'y', ok: false },
      ],
    });
  }

  it('el resumen semanal incluye el uso de internet del hogar (US-184), el diario no', async () => {
    const now = new Date();
    // Tráfico WAN en la ventana (dos rollups). El detalle por persona NO va aquí
    // (privacidad por rol): solo el total del hogar.
    await app.prisma.trafficSample.create({ data: { rxBytesPerSec: 1_000_000, txBytesPerSec: 200_000 } });
    await app.prisma.trafficSample.create({ data: { rxBytesPerSec: 500_000, txBytesPerSec: 100_000 } });

    const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weekly = await buildDigest(app.prisma, since, new Date(now.getTime() + 1000), 'weekly');
    expect(weekly?.body).toContain('Uso de internet esta semana');

    // El resumen diario no lleva la línea de uso (es semanal).
    const daily = await buildDigest(app.prisma, since, new Date(now.getTime() + 1000), 'daily');
    expect(daily?.body ?? '').not.toContain('Uso de internet');
  });

  it('buildDigest resume el periodo con nombres amables y SIN PII (emails/IPs)', async () => {
    const now = new Date();
    await seedActivity(now);
    const digest = await buildDigest(
      app.prisma,
      new Date(now.getTime() - 24 * 60 * 60 * 1000),
      new Date(now.getTime() + 1000),
      'daily',
    );
    expect(digest).not.toBeNull();
    expect(digest?.body).toContain('Tele del salón');
    expect(digest?.body).toContain('1 evento(s) de seguridad');
    expect(digest?.body).toContain('2 automatización(es)');
    expect(digest?.body).toContain('1 con fallos');
    // Sin PII en claro (patrón hashEmail, US-85): ni emails ni MACs ni IPs.
    expect(digest?.body).not.toContain('@');
    expect(digest?.body).not.toContain('aa:bb');
    expect(digest?.body).not.toContain('10.0.0.30');
  });

  it('sanea los nombres del resumen: un hostname hostil no cuela texto largo ni saltos', async () => {
    const now = new Date();
    await app.prisma.device.create({
      data: {
        mac: 'aa:bb:cc:dd:0d:02',
        ip: '10.0.0.31',
        hostname: 'URGENTE\nrenueva tu clave en http://evil.tld/con/una/ruta/larguisima',
        firstSeen: new Date(now.getTime() - 60 * 60 * 1000),
      },
    });
    const digest = await buildDigest(
      app.prisma,
      new Date(now.getTime() - 24 * 60 * 60 * 1000),
      new Date(now.getTime() + 1000),
      'daily',
    );
    expect(digest?.body).not.toContain('\nrenueva');
    expect(digest?.body).not.toContain('evil.tld/con/una/ruta');
  });

  it('un periodo sin novedades no genera resumen (no hacer ruido)', async () => {
    const now = new Date();
    expect(
      await buildDigest(app.prisma, new Date(now.getTime() - 1000), now, 'daily'),
    ).toBeNull();
  });

  it('due(): diario cruza las 08:00; semanal solo el lunes', () => {
    const tuesday = new Date(2026, 6, 7);
    expect(DigestService.due('daily', at(tuesday, 7, 30), at(tuesday, 8, 30))).toBe(true);
    expect(DigestService.due('daily', at(tuesday, 8, 30), at(tuesday, 9, 30))).toBe(false);
    expect(DigestService.due('weekly', at(MONDAY, 7, 30), at(MONDAY, 8, 30))).toBe(true);
    expect(DigestService.due('weekly', at(tuesday, 7, 30), at(tuesday, 8, 30))).toBe(false);
    expect(DigestService.due('off', at(MONDAY, 7, 30), at(MONDAY, 8, 30))).toBe(false);
  });

  it('el barrido envía por TODOS los canales al cruzar la hora, y no antes ni repetido', async () => {
    await app.prisma.setting.create({ data: { key: 'digestFrequency', value: 'daily' } });
    const day = new Date(2026, 6, 7);
    await seedActivity(at(day, 6, 0));
    const { service, sent } = makeService();

    await service.tick(at(day, 7, 0)); // primer barrido: fija la base
    await service.tick(at(day, 7, 50)); // aún no son las 08:00
    expect(sent).toHaveLength(0);

    await service.tick(at(day, 8, 10)); // cruza las 08:00 → envía
    expect(sent.map((s) => s.channel).sort()).toEqual(['email', 'push', 'telegram']);
    expect(sent[0]?.title).toContain('diario');

    await service.tick(at(day, 9, 10)); // ya enviado hoy → nada
    expect(sent).toHaveLength(3);
  });

  it('con digestFrequency=off (o ausente) el barrido no envía nunca', async () => {
    const day = new Date(2026, 6, 7);
    await seedActivity(at(day, 6, 0));
    const { service, sent } = makeService();
    await service.tick(at(day, 7, 0));
    await service.tick(at(day, 8, 10));
    expect(sent).toHaveLength(0);
  });

  it('PATCH /api/alerts/:event acepta el canal telegram y lo persiste', async () => {
    const adminToken = signAccess(app, await seedUser(app, { role: 'admin' }));
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/alerts/rules/device.block',
      headers: authHeader(adminToken),
      payload: { telegram: true },
    });
    expect(res.statusCode).toBe(200);
    const rule = res.json() as AlertRule;
    expect(rule.telegram).toBe(true);
    expect(
      (await app.prisma.alertRule.findUnique({ where: { event: 'device.block' } }))?.telegram,
    ).toBe(true);
  });
});
