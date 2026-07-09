import type { IotManager, IotSchedule, UpdateIotStateRequest } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IotScheduleService } from '../../src/modules/iot-schedule/iot-schedule.service.js';
import { SceneService } from '../../src/modules/scenes/scenes.service.js';
import { MockIotManager } from '../../src/iot/mock.iot.js';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

/** Horarios para IoT/escenas (US-168): CRUD + barrido que dispara. */
describe('horarios IoT (US-168)', () => {
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

  it('CRUD (admin): crear con hora fija, listar, editar, borrar', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/iot-schedules',
      headers: authHeader(adminToken),
      payload: {
        name: 'Riego',
        days: [1, 2, 3, 4, 5],
        time: { kind: 'fixed', minute: 7 * 60 },
        target: { type: 'device', deviceId: 'plug-cafetera', on: true },
      },
    });
    expect(create.statusCode).toBe(201);
    const schedule = create.json() as IotSchedule;
    expect(schedule.time).toEqual({ kind: 'fixed', minute: 420 });
    expect(schedule.target).toMatchObject({ type: 'device', deviceId: 'plug-cafetera' });

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/iot-schedules/${schedule.id}`,
      headers: authHeader(adminToken),
      payload: { enabled: false },
    });
    expect((patch.json() as IotSchedule).enabled).toBe(false);

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/iot-schedules/${schedule.id}`,
      headers: authHeader(adminToken),
    });
    expect(del.statusCode).toBe(204);
  });

  it('acepta un horario solar (atardecer con desfase) y una escena como objetivo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/iot-schedules',
      headers: authHeader(adminToken),
      payload: {
        name: 'Luces al atardecer',
        days: [0, 6],
        time: { kind: 'sunset', offsetMin: -15 },
        target: { type: 'scene', sceneId: 'scene-1' },
      },
    });
    expect(res.statusCode).toBe(201);
    const schedule = res.json() as IotSchedule;
    expect(schedule.time).toEqual({ kind: 'sunset', offsetMin: -15 });
    expect(schedule.target).toEqual({ type: 'scene', sceneId: 'scene-1' });
  });

  it('el barrido dispara la acción al cruzar la hora (y no en el primer tick)', async () => {
    const calls: UpdateIotStateRequest[] = [];
    const fakeIot = {
      setState: async (_id: string, input: UpdateIotStateRequest) => {
        calls.push(input);
        return (await new MockIotManager().getDevice('plug-cafetera'))!;
      },
      getDevice: async () => null,
      listDevices: async () => [],
    } as unknown as IotManager;
    const service = new IotScheduleService(app, fakeIot, new SceneService(app, fakeIot));

    await app.prisma.iotSchedule.create({
      data: {
        name: 'x',
        enabled: true,
        days: JSON.stringify([0, 1, 2, 3, 4, 5, 6]),
        time: JSON.stringify({ kind: 'fixed', minute: 7 * 60 }),
        target: JSON.stringify({ type: 'device', deviceId: 'plug-cafetera', on: true }),
      },
    });

    // Primer tick: fija la base, NO dispara nada atrasado.
    await service.tick(new Date(2026, 5, 21, 6, 59));
    expect(calls).toHaveLength(0);

    // Segundo tick cruza las 07:00 → dispara.
    await service.tick(new Date(2026, 5, 21, 7, 0));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ on: true });

    // Tercer tick ya pasó la hora → no re-dispara.
    await service.tick(new Date(2026, 5, 21, 7, 1));
    expect(calls).toHaveLength(1);
  });

  it('un horario solar no dispara sin ubicación del hogar configurada', async () => {
    const calls: unknown[] = [];
    const fakeIot = {
      setState: async () => {
        calls.push(1);
        return null;
      },
      getDevice: async () => null,
      listDevices: async () => [],
    } as unknown as IotManager;
    const service = new IotScheduleService(app, fakeIot, new SceneService(app, fakeIot));

    await app.prisma.iotSchedule.create({
      data: {
        name: 'x',
        enabled: true,
        days: JSON.stringify([0, 1, 2, 3, 4, 5, 6]),
        time: JSON.stringify({ kind: 'sunset', offsetMin: 0 }),
        target: JSON.stringify({ type: 'device', deviceId: 'plug-cafetera', on: false }),
      },
    });

    // Sin homeLatitude/homeLongitude en Setting → el evento solar no se calcula.
    await service.tick(new Date(2026, 5, 21, 0, 0));
    await service.tick(new Date(2026, 5, 21, 23, 59));
    expect(calls).toHaveLength(0);
  });

  it('una fila corrupta se degrada a deshabilitada sin tumbar el GET ni el barrido (US-199)', async () => {
    // Fila corrupta (time/target no son JSON) + una sana que debe seguir funcionando.
    await app.prisma.iotSchedule.create({
      data: {
        name: 'corrupta',
        enabled: true,
        days: JSON.stringify([0, 1, 2, 3, 4, 5, 6]),
        time: 'no-json{',
        target: 'tampoco}',
      },
    });
    await app.prisma.iotSchedule.create({
      data: {
        name: 'sana',
        enabled: true,
        days: JSON.stringify([0, 1, 2, 3, 4, 5, 6]),
        time: JSON.stringify({ kind: 'fixed', minute: 7 * 60 }),
        target: JSON.stringify({ type: 'device', deviceId: 'plug-cafetera', on: true }),
      },
    });

    // GET responde 200 con la fila corrupta degradada (no 500).
    const list = await app.inject({
      method: 'GET',
      url: '/api/iot-schedules',
      headers: authHeader(adminToken),
    });
    expect(list.statusCode).toBe(200);
    const schedules = list.json() as IotSchedule[];
    expect(schedules).toHaveLength(2);
    expect(schedules.find((s) => s.name === 'corrupta')?.enabled).toBe(false);

    // El barrido no lanza y el horario sano sigue disparando.
    const calls: UpdateIotStateRequest[] = [];
    const fakeIot = {
      setState: async (_id: string, input: UpdateIotStateRequest) => {
        calls.push(input);
        return (await new MockIotManager().getDevice('plug-cafetera'))!;
      },
      getDevice: async () => null,
      listDevices: async () => [],
    } as unknown as IotManager;
    const service = new IotScheduleService(app, fakeIot, new SceneService(app, fakeIot));
    await service.tick(new Date(2026, 5, 21, 6, 59));
    await service.tick(new Date(2026, 5, 21, 7, 0));
    expect(calls).toEqual([{ on: true }]);
  });
});
