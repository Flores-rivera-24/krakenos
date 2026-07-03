import type { AccessSchedule, HardwareDriver } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccessScheduleService } from '../../src/modules/access/access.service.js';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

/** Horarios de acceso / control parental (US-108): CRUD + aplicación por barrido. */
describe('horarios de acceso (US-108)', () => {
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

  it('CRUD de horarios (admin): crear, listar, editar, borrar', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/access/schedules',
      headers: authHeader(adminToken),
      payload: {
        name: 'Hora de dormir',
        mac: 'aa:bb:cc:dd:ee:ff',
        days: [0, 1, 2, 3, 4],
        startMinute: 21 * 60,
        endMinute: 7 * 60,
      },
    });
    expect(create.statusCode).toBe(201);
    const schedule = create.json() as AccessSchedule;
    expect(schedule.days).toEqual([0, 1, 2, 3, 4]);
    expect(schedule.enabled).toBe(true);

    const list = await app.inject({
      method: 'GET',
      url: '/api/access/schedules?mac=aa:bb:cc:dd:ee:ff',
      headers: authHeader(adminToken),
    });
    expect((list.json() as AccessSchedule[])).toHaveLength(1);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/access/schedules/${schedule.id}`,
      headers: authHeader(adminToken),
      payload: { enabled: false },
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as AccessSchedule).enabled).toBe(false);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/access/schedules/${schedule.id}`,
      headers: authHeader(adminToken),
    });
    expect(del.statusCode).toBe(204);
    const after = await app.inject({
      method: 'GET',
      url: '/api/access/schedules',
      headers: authHeader(adminToken),
    });
    expect((after.json() as AccessSchedule[])).toHaveLength(0);
  });

  it('el barrido bloquea y desbloquea vía driver según la ventana', async () => {
    const calls: string[] = [];
    const fakeDriver = {
      blockDevice: async (mac: string) => {
        calls.push(`block:${mac}`);
      },
      unblockDevice: async (mac: string) => {
        calls.push(`unblock:${mac}`);
      },
    } as unknown as HardwareDriver;
    const service = new AccessScheduleService(app, fakeDriver);

    const mac = 'aa:bb:cc:dd:ee:ff';
    const now = new Date(2026, 6, 6, 22, 0, 0); // ventana [21:00, 23:00)
    await app.prisma.device.create({ data: { mac, ip: '192.168.1.9' } });
    await app.prisma.accessSchedule.create({
      data: {
        name: 'x',
        mac,
        enabled: true,
        days: JSON.stringify([now.getDay()]),
        startMinute: 21 * 60,
        endMinute: 23 * 60,
      },
    });

    await service.tick(now);
    expect(calls).toContain(`block:${mac}`);

    // Fuera de la ventana → desbloquea (no está bloqueado a mano).
    const later = new Date(2026, 6, 6, 23, 30, 0);
    await service.tick(later);
    expect(calls).toContain(`unblock:${mac}`);
  });

  it('no desbloquea un dispositivo bloqueado a mano al terminar la ventana', async () => {
    const calls: string[] = [];
    const fakeDriver = {
      blockDevice: async (mac: string) => calls.push(`block:${mac}`),
      unblockDevice: async (mac: string) => calls.push(`unblock:${mac}`),
    } as unknown as HardwareDriver;
    const service = new AccessScheduleService(app, fakeDriver);

    const mac = 'aa:bb:cc:dd:ee:ff';
    const now = new Date(2026, 6, 6, 22, 0, 0);
    // Bloqueado A MANO además del horario.
    await app.prisma.device.create({ data: { mac, ip: '192.168.1.9', isBlocked: true } });
    await app.prisma.accessSchedule.create({
      data: {
        name: 'x',
        mac,
        enabled: true,
        days: JSON.stringify([now.getDay()]),
        startMinute: 21 * 60,
        endMinute: 23 * 60,
      },
    });

    await service.tick(now); // dentro de la ventana → no toca el driver (ya bloqueado a mano)
    const later = new Date(2026, 6, 6, 23, 30, 0);
    await service.tick(later); // fuera de la ventana → NO debe desbloquear (bloqueo manual)
    expect(calls).not.toContain(`unblock:${mac}`);
  });
});
