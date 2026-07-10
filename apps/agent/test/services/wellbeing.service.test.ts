import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WellbeingService } from '../../src/modules/wellbeing/wellbeing.service.js';
import { buildTestApp } from '../helpers/app.js';

describe('WellbeingService (US-184)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await app.prisma.deviceTrafficSample.deleteMany();
    await app.prisma.device.deleteMany();
    await app.prisma.user.deleteMany();
  });

  async function seed() {
    const ana = await app.prisma.user.create({
      data: { email: 'ana@test', displayName: 'Ana', role: 'member', passwordHash: 'x' },
    });
    const leo = await app.prisma.user.create({
      data: { email: 'leo@test', displayName: 'Leo', role: 'kid', passwordHash: 'x' },
    });
    // Aparatos con dueño + uno sin asignar.
    await app.prisma.device.create({ data: { mac: 'aa:aa:aa:00:00:01', ip: '1.1.1.1', ownerId: ana.id } });
    await app.prisma.device.create({ data: { mac: 'bb:bb:bb:00:00:02', ip: '1.1.1.2', ownerId: leo.id } });
    await app.prisma.device.create({ data: { mac: 'cc:cc:cc:00:00:03', ip: '1.1.1.3' } }); // sin dueño
    // Tráfico: Ana consume más que Leo; el sin-dueño también.
    await app.prisma.deviceTrafficSample.create({
      data: { mac: 'aa:aa:aa:00:00:01', rxBytesPerSec: 1000, txBytesPerSec: 500 },
    });
    await app.prisma.deviceTrafficSample.create({
      data: { mac: 'bb:bb:bb:00:00:02', rxBytesPerSec: 100, txBytesPerSec: 50 },
    });
    await app.prisma.deviceTrafficSample.create({
      data: { mac: 'cc:cc:cc:00:00:03', rxBytesPerSec: 200, txBytesPerSec: 0 },
    });
    return { ana, leo };
  }

  it('un admin ve todo el hogar, incluidos los aparatos sin dueño', async () => {
    const { ana } = await seed();
    const svc = new WellbeingService(app);
    const { people } = await svc.usageByPerson('week', { sub: 'admin-x', role: 'admin' });

    expect(people).toHaveLength(3); // Ana, Leo, Sin asignar
    // Orden descendente por total: Ana primero (1500 B/s × 60).
    expect(people[0]?.name).toBe('Ana');
    expect(people[0]?.userId).toBe(ana.id);
    expect(people[0]?.totalBytes).toBe((1000 + 500) * 60);
    expect(people.some((p) => p.userId === null && p.name === 'Sin asignar')).toBe(true);
  });

  it('un no-admin solo ve su propio uso (privacidad por rol)', async () => {
    const { ana } = await seed();
    const svc = new WellbeingService(app);
    const { people } = await svc.usageByPerson('week', { sub: ana.id, role: 'member' });

    expect(people).toHaveLength(1);
    expect(people[0]?.userId).toBe(ana.id);
    // No ve a Leo ni los aparatos sin asignar.
    expect(people.some((p) => p.name === 'Leo')).toBe(false);
    expect(people.some((p) => p.userId === null)).toBe(false);
  });

  it('un no-admin sin aparatos propios no ve nada', async () => {
    await seed();
    const svc = new WellbeingService(app);
    const { people } = await svc.usageByPerson('week', { sub: 'nadie', role: 'viewer' });
    expect(people).toHaveLength(0);
  });

  it('cuenta los dispositivos y agrega en buckets', async () => {
    const { ana } = await seed();
    await app.prisma.device.create({ data: { mac: 'aa:aa:aa:00:00:09', ip: '1.1.1.9', ownerId: ana.id } });
    await app.prisma.deviceTrafficSample.create({
      data: { mac: 'aa:aa:aa:00:00:09', rxBytesPerSec: 10, txBytesPerSec: 10 },
    });
    const svc = new WellbeingService(app);
    const { people } = await svc.usageByPerson('week', { sub: ana.id, role: 'member' });
    expect(people[0]?.deviceCount).toBe(2);
    expect((people[0]?.buckets.length ?? 0) >= 1).toBe(true);
  });
});
