import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DAY_MS,
  pruneAuditLog,
  pruneAutomationRuns,
  pruneExpiredRefreshTokens,
  pruneExpiredWebAuthnChallenges,
  retentionDays,
} from '../../src/config/retention.js';
import { RetentionService } from '../../src/modules/system/retention.service.js';
import { buildTestApp, resetDb, seedUser } from '../helpers/app.js';

/** Retención de datos (US-102): los ajustes ya no están muertos y la auditoría se poda. */
describe('retención de datos (US-102)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
  });

  const seedAudit = (action: string, ageDays: number) =>
    app.prisma.auditLog.create({
      data: { action, createdAt: new Date(Date.now() - ageDays * DAY_MS) },
    });

  it('retentionDays lee el ajuste, lo acota y cae al fallback si falta', async () => {
    // Ausente → fallback.
    expect(await retentionDays(app.prisma, 'trafficRetentionDays', 7)).toBe(7);

    await app.prisma.setting.create({ data: { key: 'trafficRetentionDays', value: '30' } });
    expect(await retentionDays(app.prisma, 'trafficRetentionDays', 7)).toBe(30);

    // Fuera de rango → acotado al máximo (365).
    await app.prisma.setting.update({ where: { key: 'trafficRetentionDays' }, data: { value: '99999' } });
    expect(await retentionDays(app.prisma, 'trafficRetentionDays', 7)).toBe(365);

    // No numérico → fallback.
    await app.prisma.setting.update({ where: { key: 'trafficRetentionDays' }, data: { value: 'x' } });
    expect(await retentionDays(app.prisma, 'trafficRetentionDays', 7)).toBe(7);
  });

  it('pruneAuditLog borra lo más antiguo que la retención y conserva lo reciente', async () => {
    await seedAudit('viejo.1', 100);
    await seedAudit('viejo.2', 91);
    await seedAudit('reciente.1', 10);
    await seedAudit('reciente.2', 0);

    const removed = await pruneAuditLog(app.prisma, 90);
    expect(removed).toBe(2);

    const left = await app.prisma.auditLog.findMany();
    expect(left.map((r) => r.action).sort()).toEqual(['reciente.1', 'reciente.2']);
  });

  it('RetentionService.pruneOnce usa el ajuste auditRetentionDays', async () => {
    await seedAudit('viejo', 40);
    await seedAudit('reciente', 5);
    await app.prisma.setting.create({ data: { key: 'auditRetentionDays', value: '30' } });

    await new RetentionService(app).pruneOnce();

    const left = await app.prisma.auditLog.findMany();
    expect(left).toHaveLength(1);
    expect(left[0]?.action).toBe('reciente');
  });

  it('poda refresh tokens expirados con margen (conserva la ventana de reuso, US-206)', async () => {
    const user = await seedUser(app, { role: 'admin' });
    const seedToken = (hash: string, expiredDaysAgo: number) =>
      app.prisma.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: hash,
          revoked: true,
          expiresAt: new Date(Date.now() - expiredDaysAgo * DAY_MS),
        },
      });
    await seedToken('muerto-hace-mucho', 30); // > margen → se poda
    await seedToken('expirado-reciente', 2); // dentro del margen → se conserva (reuso US-78)
    await app.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: 'vigente',
        expiresAt: new Date(Date.now() + 10 * DAY_MS),
      },
    });

    const removed = await pruneExpiredRefreshTokens(app.prisma);
    expect(removed).toBe(1);
    const left = await app.prisma.refreshToken.findMany();
    expect(left.map((t) => t.tokenHash).sort()).toEqual(['expirado-reciente', 'vigente']);
  });

  it('poda desafíos WebAuthn expirados (US-206)', async () => {
    const user = await seedUser(app, { role: 'admin' });
    const seedChallenge = (challenge: string, offsetMs: number) =>
      app.prisma.webAuthnChallenge.create({
        data: {
          userId: user.id,
          type: 'authenticate',
          challenge,
          expiresAt: new Date(Date.now() + offsetMs),
        },
      });
    await seedChallenge('expirado', -60_000);
    await seedChallenge('vigente', 60_000);

    expect(await pruneExpiredWebAuthnChallenges(app.prisma)).toBe(1);
    const left = await app.prisma.webAuthnChallenge.findMany();
    expect(left[0]?.challenge).toBe('vigente');
  });

  it('poda ejecuciones de automatizaciones antiguas (US-167)', async () => {
    const rule = await app.prisma.automationRule.create({
      data: { name: 'r', trigger: '{"type":"device-new"}', actions: '[]' },
    });
    const seedRun = (event: string, ageDays: number) =>
      app.prisma.automationRun.create({
        data: { ruleId: rule.id, event, ok: true, createdAt: new Date(Date.now() - ageDays * DAY_MS) },
      });
    await seedRun('vieja', 40);
    await seedRun('reciente', 5);

    expect(await pruneAutomationRuns(app.prisma)).toBe(1);
    const left = await app.prisma.automationRun.findMany();
    expect(left[0]?.event).toBe('reciente');
  });

  it('pruneOnce cubre auditoría + tokens + desafíos en un solo barrido (US-206)', async () => {
    const user = await seedUser(app, { role: 'admin' });
    await seedAudit('viejo', 100);
    await app.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: 'muerto',
        revoked: true,
        expiresAt: new Date(Date.now() - 30 * DAY_MS),
      },
    });
    await app.prisma.webAuthnChallenge.create({
      data: {
        userId: user.id,
        type: 'register',
        challenge: 'expirado',
        expiresAt: new Date(Date.now() - 1000),
      },
    });

    await new RetentionService(app).pruneOnce();

    expect(await app.prisma.auditLog.count()).toBe(0);
    expect(await app.prisma.refreshToken.count()).toBe(0);
    expect(await app.prisma.webAuthnChallenge.count()).toBe(0);
  });
});
