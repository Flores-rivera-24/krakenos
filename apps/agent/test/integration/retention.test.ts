import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DAY_MS, pruneAuditLog, retentionDays } from '../../src/config/retention.js';
import { RetentionService } from '../../src/modules/system/retention.service.js';
import { buildTestApp, resetDb } from '../helpers/app.js';

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
});
