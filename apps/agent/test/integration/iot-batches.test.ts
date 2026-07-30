import type { IotDevice, IotManager, UpdateIotStateRequest } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeEventBus } from '../../src/automations/event-bus.js';
import { IOT_BATCH_CONCURRENCY } from '../../src/iot/batch.js';
import { AlarmService } from '../../src/modules/alarm/alarm.service.js';
import { RoomService } from '../../src/modules/rooms/rooms.service.js';
import { SceneService } from '../../src/modules/scenes/scenes.service.js';
import { buildTestApp, resetDb } from '../helpers/app.js';

/**
 * US-229 / AUD3-19 — los lotes IoT eran secuenciales con 10 s de timeout cada
 * uno (`withActionTimeout`, US-203). Con el bridge caído, una escena de 8 luces
 * tardaba **80 s** con el usuario esperando, y la alarma disparada encendía las
 * luces de una en una antes de que sonara nada más.
 *
 * `maxInFlight` es la aserción que importa: en serie vale 1 pase lo que pase.
 */

/** IoT falso que mide cuántos `setState` coinciden en vuelo. */
class ConcurrencyProbe implements IotManager {
  inFlight = 0;
  maxInFlight = 0;
  readonly calls: string[] = [];
  /** Ids que fallan (para comprobar que el reporte parcial sigue siendo correcto). */
  failing = new Set<string>();

  private readonly device: IotDevice = {
    id: 'x',
    name: 'Aparato',
    kind: 'light',
    room: null,
    reachable: true,
    on: false,
    brightness: null,
    color: null,
    reading: null,
  };

  async listDevices(): Promise<IotDevice[]> {
    return [this.device];
  }
  async getDevice(): Promise<IotDevice | null> {
    return this.device;
  }
  async setState(id: string, _input: UpdateIotStateRequest): Promise<IotDevice> {
    this.calls.push(id);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await new Promise((r) => setTimeout(r, 10));
      if (this.failing.has(id)) throw new Error(`${id} no responde`);
      return { ...this.device, id };
    } finally {
      this.inFlight -= 1;
    }
  }
}

describe('lotes IoT en paralelo (US-229)', () => {
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

  it('una escena aplica todas sus acciones a la vez y reporta el parcial', async () => {
    const iot = new ConcurrencyProbe();
    iot.failing.add('luz-3');
    const scenes = new SceneService(app, iot);
    const scene = await scenes.create({
      name: 'Cine',
      icon: 'sparkles',
      actions: ['luz-1', 'luz-2', 'luz-3', 'luz-4'].map((deviceId) => ({ deviceId, on: true })),
    });

    const result = await scenes.run(scene.id);

    expect(iot.maxInFlight).toBe(4); // en serie sería 1
    expect(result).toMatchObject({ applied: 3 });
    // El reporte conserva el dispositivo correcto pese al paralelismo (el mensaje
    // genérico es el de siempre: solo un `IotError` aporta texto propio).
    expect(result?.failed).toEqual([{ deviceId: 'luz-3', error: 'error al aplicar la acción' }]);
  });

  it('la acción de grupo de una habitación aplica a todos sus aparatos a la vez', async () => {
    const iot = new ConcurrencyProbe();
    const rooms = new RoomService(app, iot, { setRoom: vi.fn() } as never);
    const room = await rooms.create({ name: 'Salón', icon: 'sofa' });
    for (const id of ['luz-1', 'luz-2', 'luz-3']) {
      await app.prisma.iotRoomMember.create({ data: { roomId: room.id, iotDeviceId: id } });
    }

    const result = await rooms.runGroupAction(room.id, { on: false });

    expect(iot.maxInFlight).toBe(3);
    expect(result).toMatchObject({ applied: 3, failed: [] });
  });

  it('una escena enorme NO inunda el bridge: la concurrencia va acotada', async () => {
    // El schema admite 200 acciones por escena: paralelizar sin cota convertiría
    // «ejecutar escena» en 200 peticiones simultáneas contra el bridge del hogar.
    const iot = new ConcurrencyProbe();
    const scenes = new SceneService(app, iot);
    const scene = await scenes.create({
      name: 'Toda la casa',
      icon: 'sparkles',
      actions: Array.from({ length: 40 }, (_, i) => ({ deviceId: `luz-${i}`, on: true })),
    });

    const result = await scenes.run(scene.id);

    expect(result).toMatchObject({ applied: 40, failed: [] });
    expect(iot.maxInFlight).toBe(IOT_BATCH_CONCURRENCY);
    expect(iot.calls).toHaveLength(40); // se aplican todas, en olas
  });

  it('la alarma enciende sirena y luces a la vez al dispararse', async () => {
    const iot = new ConcurrencyProbe();
    let clock = 0;
    const bus = new HomeEventBus();
    const service = new AlarmService(app, iot, bus, { now: () => clock });
    vi.spyOn(app, 'audit').mockImplementation(() => {});
    await service.setConfig({
      sirenDeviceId: 'sirena',
      lightDeviceIds: ['luz-1', 'luz-2', 'luz-3'],
      cameraIds: ['cam-1'],
      exitDelaySec: 0,
      entryDelaySec: 0,
    });
    await service.armAlarm('away', 'ana@x');

    await service.onBusEvent({ type: 'motion-detected', cameraId: 'cam-1', cameraName: 'Entrada' });
    clock = 1_000;
    await service.tick();

    expect(service.getStateSync().phase).toBe('triggered');
    // Sirena + 3 luces: la sirena no espera a que respondan las luces.
    expect(iot.maxInFlight).toBe(4);
    expect(iot.calls).toContain('sirena');
  });
});
