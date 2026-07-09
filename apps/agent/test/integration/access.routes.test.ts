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

  it('pausa y reanuda el internet de un dispositivo (US-111)', async () => {
    const mac = 'aa:bb:cc:dd:ee:ff';
    await app.prisma.device.create({ data: { mac, ip: '192.168.1.9' } });

    const pause = await app.inject({
      method: 'POST',
      url: '/api/access/pause',
      headers: authHeader(adminToken),
      payload: { mac, minutes: 30 },
    });
    expect(pause.statusCode).toBe(200);
    const { pausedUntil } = pause.json() as { pausedUntil: string };
    expect(new Date(pausedUntil).getTime()).toBeGreaterThan(Date.now());
    expect((await app.prisma.device.findUnique({ where: { mac } }))?.pausedUntil).not.toBeNull();

    const resume = await app.inject({
      method: 'POST',
      url: '/api/access/resume',
      headers: authHeader(adminToken),
      payload: { mac },
    });
    expect(resume.statusCode).toBe(204);
    expect((await app.prisma.device.findUnique({ where: { mac } }))?.pausedUntil).toBeNull();
  });

  it('el barrido desbloquea cuando la pausa expira (US-111)', async () => {
    const calls: string[] = [];
    const fakeDriver = {
      blockDevice: async (m: string) => calls.push(`block:${m}`),
      unblockDevice: async (m: string) => calls.push(`unblock:${m}`),
    } as unknown as HardwareDriver;
    const service = new AccessScheduleService(app, fakeDriver);

    const mac = 'aa:bb:cc:dd:ee:ff';
    await app.prisma.device.create({ data: { mac, ip: '192.168.1.9' } });
    await service.pause(mac, 30);
    expect(calls).toContain(`block:${mac}`);

    // Simula que la pausa expiró.
    await app.prisma.device.update({ where: { mac }, data: { pausedUntil: new Date(Date.now() - 1000) } });
    await service.tick(new Date());
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

  it('reconcilia tras un reinicio: desbloquea la pausa persistida que ya expiró (US-197)', async () => {
    const mac = 'aa:bb:cc:dd:ee:ff';
    await app.prisma.device.create({ data: { mac, ip: '192.168.1.9' } });

    // Primera "vida" del agente: pausa → persiste la MAC gestionada.
    const before = new AccessScheduleService(app, {
      blockDevice: async () => undefined,
      unblockDevice: async () => undefined,
    } as unknown as HardwareDriver);
    await before.pause(mac, 30);
    const persisted = await app.prisma.setting.findUnique({
      where: { key: 'access.managedBlocked' },
    });
    expect(JSON.parse(persisted?.value ?? '[]')).toContain(mac);

    // "Reinicio": instancia nueva (Set vacío) + la pausa ya expiró.
    await app.prisma.device.update({
      where: { mac },
      data: { pausedUntil: new Date(Date.now() - 1000) },
    });
    const calls: string[] = [];
    const after = new AccessScheduleService(app, {
      blockDevice: async (m: string) => calls.push(`block:${m}`),
      unblockDevice: async (m: string) => calls.push(`unblock:${m}`),
    } as unknown as HardwareDriver);
    await after.reconcile();
    expect(calls).toContain(`unblock:${mac}`);
    const cleared = await app.prisma.setting.findUnique({
      where: { key: 'access.managedBlocked' },
    });
    expect(JSON.parse(cleared?.value ?? '[]')).not.toContain(mac);
  });

  it('reconcilia tras un reinicio: mantiene el bloqueo si la ventana sigue activa (US-197)', async () => {
    const mac = 'aa:bb:cc:dd:ee:ff';
    const now = new Date(2026, 6, 6, 22, 0, 0); // dentro de la ventana [21:00, 23:00)
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
    await app.prisma.setting.create({
      data: { key: 'access.managedBlocked', value: JSON.stringify([mac]) },
    });

    const calls: string[] = [];
    const service = new AccessScheduleService(app, {
      blockDevice: async (m: string) => calls.push(`block:${m}`),
      unblockDevice: async (m: string) => calls.push(`unblock:${m}`),
    } as unknown as HardwareDriver);
    await service.reconcile(now);
    expect(calls).not.toContain(`unblock:${mac}`);
  });

  it('reconcilia con el estado persistido corrupto sin lanzar (US-197)', async () => {
    await app.prisma.setting.create({
      data: { key: 'access.managedBlocked', value: 'no-es-json{' },
    });
    const service = new AccessScheduleService(app, {
      blockDevice: async () => undefined,
      unblockDevice: async () => undefined,
    } as unknown as HardwareDriver);
    await expect(service.reconcile()).resolves.toBeUndefined();
  });
});
