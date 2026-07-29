import type {
  Camera,
  CameraManager,
  CameraSnapshot,
  IotManager,
  NativeMotionEvent,
  UpdateIotStateRequest,
} from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeEventBus } from '../../src/automations/event-bus.js';
import { DigestService } from '../../src/alerts/digest.js';
import { MockIotManager } from '../../src/iot/mock.iot.js';
import { AutomationService } from '../../src/modules/automations/automations.service.js';
import { MotionService } from '../../src/modules/cameras/motion.service.js';
import { IotScheduleService } from '../../src/modules/iot-schedule/iot-schedule.service.js';
import { SceneService } from '../../src/modules/scenes/scenes.service.js';
import { buildTestApp, resetDb } from '../helpers/app.js';

/**
 * US-229 / AUD3-18 — «el minuto perdido».
 *
 * Varios barridos avanzaban su ventana temporal (`prevTick`, `lastPollMs`)
 * **antes** del `await` de su lectura. Si la lectura fallaba, el ciclo se
 * abortaba con la ventana ya movida: ese minuto no se disparaba **nunca** y el
 * único síntoma era «las luces no se encendieron a las 20:00 y no hay ningún
 * error en el log».
 *
 * Cada test aquí: hora T-1 (fija la base) → la lectura falla justo en el ciclo
 * que cruza T → el ciclo siguiente **sí** dispara, porque la ventana no se movió.
 */
describe('los barridos no pierden su ventana si el ciclo falla (US-229)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ routes: false });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
    vi.restoreAllMocks();
  });

  it('iot-schedule: un fallo de DB al cruzar la hora no se come el disparo', async () => {
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
        name: 'Luces del salón',
        enabled: true,
        days: JSON.stringify([0, 1, 2, 3, 4, 5, 6]),
        time: JSON.stringify({ kind: 'fixed', minute: 20 * 60 }),
        target: JSON.stringify({ type: 'device', deviceId: 'plug-cafetera', on: true }),
      },
    });

    await service.tick(new Date(2026, 5, 21, 19, 59)); // fija la base
    expect(calls).toHaveLength(0);

    // El barrido que cruza las 20:00 falla al leer los horarios.
    const list = vi.spyOn(service, 'list').mockRejectedValueOnce(new Error('database is locked'));
    await expect(service.tick(new Date(2026, 5, 21, 20, 0))).rejects.toThrow();
    expect(calls).toHaveLength(0);
    list.mockRestore();

    // El ciclo siguiente recupera el minuto perdido: la ventana sigue en 19:59.
    await service.tick(new Date(2026, 5, 21, 20, 1));
    expect(calls).toEqual([{ on: true }]);
  });

  it('automations: un fallo de DB al cruzar la hora no se come la regla horaria', async () => {
    const bus = new HomeEventBus(() => undefined);
    const fakeIot = {
      setState: async () => (await new MockIotManager().getDevice('plug-cafetera'))!,
      getDevice: async () => null,
      listDevices: async () => [],
    } as unknown as IotManager;
    const service = new AutomationService(app, {
      iot: fakeIot,
      scenes: new SceneService(app, fakeIot),
      inventory: { setBlocked: vi.fn() } as never,
      access: { pause: vi.fn() } as never,
      bus,
      notify: vi.fn().mockResolvedValue(undefined),
    });

    await app.prisma.automationRule.create({
      data: {
        name: 'Aviso nocturno',
        enabled: true,
        trigger: JSON.stringify({ type: 'time', minute: 20 * 60, days: [0, 1, 2, 3, 4, 5, 6] }),
        actions: JSON.stringify([{ type: 'notify', message: 'buenas noches' }]),
      },
    });

    await service.tick(new Date(2026, 5, 21, 19, 59));
    expect(await app.prisma.automationRun.count()).toBe(0);

    const list = vi.spyOn(service, 'list').mockRejectedValueOnce(new Error('database is locked'));
    await expect(service.tick(new Date(2026, 5, 21, 20, 0))).rejects.toThrow();
    expect(await app.prisma.automationRun.count()).toBe(0);
    list.mockRestore();

    await service.tick(new Date(2026, 5, 21, 20, 1));
    expect(await app.prisma.automationRun.count()).toBe(1);
  });

  it('digest: un fallo al leer la frecuencia no se come el resumen del día', async () => {
    const sent: string[] = [];
    await app.prisma.setting.create({ data: { key: 'digestFrequency', value: 'daily' } });
    // Sin actividad el resumen no se envía («no hacer ruido»), así que hay que
    // darle algo que contar para poder observar el envío.
    await app.prisma.auditLog.create({
      data: { action: 'device.block', detail: 'aa:bb', createdAt: new Date(2026, 5, 21, 6, 0) },
    });

    // `app` con un único fallo inyectado en la lectura de ajustes; el resto del
    // cliente Prisma pasa tal cual (el resumen consulta varias tablas más).
    let failNextSettingRead = false;
    const appWithFlakySettings = new Proxy(app, {
      get(target, prop, receiver) {
        if (prop !== 'prisma') return Reflect.get(target, prop, receiver) as unknown;
        return new Proxy(target.prisma, {
          get(prisma, key) {
            const value = Reflect.get(prisma, key) as unknown;
            if (key !== 'setting') {
              return typeof value === 'function' ? (value as () => unknown).bind(prisma) : value;
            }
            const setting = value as typeof prisma.setting;
            return {
              ...setting,
              findUnique: async (args: never) => {
                if (failNextSettingRead) {
                  failNextSettingRead = false;
                  throw new Error('database is locked');
                }
                return setting.findUnique(args);
              },
            };
          },
        });
      },
    });

    const service = new DigestService(appWithFlakySettings, {
      email: async (_subject, body) => {
        sent.push(body);
      },
      telegram: async () => undefined,
    });

    await service.tick(new Date(2026, 5, 21, 7, 30)); // fija la base
    expect(sent).toHaveLength(0);

    failNextSettingRead = true;
    await expect(service.tick(new Date(2026, 5, 21, 8, 30))).rejects.toThrow('database is locked');
    expect(sent).toHaveLength(0);

    // La ventana sigue en 07:30, así que el cruce de las 08:00 no se ha perdido.
    await service.tick(new Date(2026, 5, 21, 9, 30));
    expect(sent).toHaveLength(1);
  });

  it('motion (detección nativa): un fallo del NVR no se salta sus eventos', async () => {
    const since: number[] = [];
    let failNext = false;
    const events: NativeMotionEvent[] = [
      { cameraId: 'cam-1', cameraName: 'Entrada', label: 'person', snapshot: null, detectedAtMs: 0 },
    ];
    const cameras = {
      listCameras: async (): Promise<Camera[]> => [
        { id: 'cam-1', name: 'Entrada', room: null, model: null, online: true },
      ],
      getSnapshot: async (id: string): Promise<CameraSnapshot | null> => ({
        cameraId: id,
        image: null,
        capturedAt: '2026-07-29T00:00:00.000Z',
      }),
      getMotionFrame: async () => null,
      pollEvents: async (from: number): Promise<NativeMotionEvent[]> => {
        since.push(from);
        if (failNext) throw new Error('el NVR no responde');
        return events.splice(0);
      },
      startStream: async () => null,
      stopStream: async () => undefined,
      readStreamPlaylist: async () => null,
      readStreamSegment: async () => null,
      reapIdleStreams: () => 0,
      stop: async () => undefined,
    } as unknown as CameraManager;

    let now = 1_000_000;
    const service = new MotionService(app, cameras, new HomeEventBus(() => undefined), {
      intervalMs: 5_000,
      now: () => now,
    });

    await service.tick(new Date(now)); // primer sondeo: fija la marca
    const firstSince = since[0]!;

    now += 5_000;
    failNext = true;
    await expect(service.tick(new Date(now))).rejects.toThrow('el NVR no responde');
    expect(since[1]).toBeGreaterThan(firstSince); // pidió desde la marca anterior

    now += 5_000;
    failNext = false;
    await service.tick(new Date(now));

    // La marca NO avanzó con el sondeo fallido: el tercer ciclo vuelve a pedir
    // desde donde falló, así que ningún evento del NVR se queda sin ver.
    expect(since[2]).toBe(since[1]);
  });
});
