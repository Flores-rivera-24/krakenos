import { describe, expect, it, vi } from 'vitest';
import type { IotDevice, IotManager, UpdateIotStateRequest } from '@krakenos/types';
import { CompositeIotManager } from '../../src/iot/composite.iot.js';

function device(id: string, name = id): IotDevice {
  return {
    id,
    name,
    kind: 'light',
    room: null,
    reachable: true,
    on: false,
    brightness: 0,
    color: null,
    readings: [],
  };
}

/** Manager falso con dispositivos en memoria. */
class FakeManager implements IotManager {
  started = false;
  stopped = false;
  constructor(private readonly devices: IotDevice[]) {}
  async start(): Promise<void> {
    this.started = true;
  }
  async stop(): Promise<void> {
    this.stopped = true;
  }
  async listDevices(): Promise<IotDevice[]> {
    return this.devices;
  }
  async getDevice(id: string): Promise<IotDevice | null> {
    return this.devices.find((d) => d.id === id) ?? null;
  }
  async setState(id: string, input: UpdateIotStateRequest): Promise<IotDevice> {
    const d = this.devices.find((x) => x.id === id)!;
    return { ...d, on: input.on ?? d.on };
  }
}

describe('CompositeIotManager', () => {
  function makeComposite() {
    const hue = new FakeManager([device('abc', 'Foco Hue')]);
    const govee = new FakeManager([device('AA:BB', 'Tira Govee')]); // id con `:`
    const composite = new CompositeIotManager([
      { prefix: 'hue', manager: hue },
      { prefix: 'govee', manager: govee },
    ]);
    return { composite, hue, govee };
  }

  it('lista agregando y prefijando los ids', async () => {
    const { composite } = makeComposite();
    expect((await composite.listDevices()).map((d) => d.id)).toEqual(['hue:abc', 'govee:AA:BB']);
  });

  it('getDevice enruta por prefijo (y respeta ids con `:`)', async () => {
    const { composite } = makeComposite();
    expect((await composite.getDevice('govee:AA:BB'))!.name).toBe('Tira Govee');
    expect((await composite.getDevice('govee:AA:BB'))!.id).toBe('govee:AA:BB');
    expect(await composite.getDevice('hue:no-existe')).toBeNull();
    expect(await composite.getDevice('sin-prefijo')).toBeNull();
  });

  it('setState enruta al manager correcto y reprefija el resultado', async () => {
    const { composite, govee } = makeComposite();
    const spy = vi.spyOn(govee, 'setState');
    const updated = await composite.setState('govee:AA:BB', { on: true });
    expect(updated).toMatchObject({ id: 'govee:AA:BB', on: true });
    expect(spy).toHaveBeenCalledWith('AA:BB', { on: true });
  });

  it('setState con prefijo desconocido lanza IOT_NOT_FOUND', async () => {
    const { composite } = makeComposite();
    await expect(composite.setState('otro:x', { on: true })).rejects.toMatchObject({
      code: 'IOT_NOT_FOUND',
    });
  });

  it('start arranca todos los miembros', async () => {
    const { composite, hue, govee } = makeComposite();
    await composite.start();
    expect(hue.started && govee.started).toBe(true);
  });

  it('start ESPERA a que los miembros terminen de arrancar (US-248)', async () => {
    // Lanzarlo sin `await` devolvía el control al instante, y como desde US-243
    // TODO manager va envuelto en el composite, eso reabría por detrás lo que
    // US-242 cerró: «Probar conexión» respondía sin haber arrancado el backend.
    const lento = new FakeManager([]);
    let arrancado = false;
    lento.start = async () => {
      await new Promise((r) => setTimeout(r, 5));
      arrancado = true;
    };
    const composite = new CompositeIotManager([{ prefix: 'lento', manager: lento }]);
    await composite.start();
    expect(arrancado).toBe(true);
  });

  it('un miembro que falla al arrancar no impide arrancar a los demás', async () => {
    const roto = new FakeManager([]);
    roto.start = async () => {
      throw new Error('broker caído');
    };
    const bueno = new FakeManager([]);
    const composite = new CompositeIotManager([
      { prefix: 'roto', manager: roto },
      { prefix: 'bueno', manager: bueno },
    ]);
    await expect(composite.start()).resolves.toBeUndefined();
    expect(bueno.started).toBe(true);
  });

  it('stop libera todos los miembros aunque uno falle (US-201)', async () => {
    const { composite, hue, govee } = makeComposite();
    hue.stop = async () => {
      throw new Error('broker caído');
    };
    await expect(composite.stop()).resolves.toBeUndefined();
    expect(govee.stopped).toBe(true);
  });

  describe('listDevices con un backend caído', () => {
    class BrokenManager extends FakeManager {
      constructor(private readonly err: Error) {
        super([]);
      }
      override async listDevices(): Promise<IotDevice[]> {
        throw this.err;
      }
    }

    it('devuelve los aparatos (prefijados) del sano y avisa del caído', async () => {
      const onError = vi.fn();
      const composite = new CompositeIotManager(
        [
          { prefix: 'hue', manager: new BrokenManager(new Error('bridge caído')) },
          { prefix: 'govee', manager: new FakeManager([device('AA:BB', 'Tira')]) },
        ],
        onError,
      );
      const list = await composite.listDevices();
      expect(list.map((d) => d.id)).toEqual(['govee:AA:BB']);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]![0]).toBe('hue');
      expect((onError.mock.calls[0]![1] as Error).message).toBe('bridge caído');
    });

    it('si fallan todos, rechaza con el primer error', async () => {
      const composite = new CompositeIotManager([
        { prefix: 'hue', manager: new BrokenManager(new Error('primero')) },
        { prefix: 'govee', manager: new BrokenManager(new Error('segundo')) },
      ]);
      await expect(composite.listDevices()).rejects.toThrow('primero');
    });

    it('un miembro sano sin aparatos no oculta el fallo del otro: lista vacía, no error', async () => {
      const onError = vi.fn();
      const composite = new CompositeIotManager(
        [
          { prefix: 'hue', manager: new BrokenManager(new Error('x')) },
          { prefix: 'govee', manager: new FakeManager([]) },
        ],
        onError,
      );
      await expect(composite.listDevices()).resolves.toEqual([]);
      expect(onError).toHaveBeenCalledTimes(1);
    });

    it('un miembro colgado cuenta como fallo y no ciega a los demás', async () => {
      vi.useFakeTimers();
      try {
        const hung = new FakeManager([]);
        hung.listDevices = () => new Promise<IotDevice[]>(() => undefined);
        const onError = vi.fn();
        const composite = new CompositeIotManager(
          [
            { prefix: 'hue', manager: hung },
            { prefix: 'govee', manager: new FakeManager([device('AA:BB')]) },
          ],
          onError,
        );
        const p = composite.listDevices();
        await vi.advanceTimersByTimeAsync(10_500);
        expect((await p).map((d) => d.id)).toEqual(['govee:AA:BB']);
        expect(onError).toHaveBeenCalledWith(
          'hue',
          expect.objectContaining({ code: 'IOT_TIMEOUT' }),
        );
        expect(composite.listFailures()).toEqual([{ prefix: 'hue', message: expect.any(String) }]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('onError solo avisa al pasar a caído y onRecover al volver', async () => {
      const onError = vi.fn();
      const onRecover = vi.fn();
      const flaky = new FakeManager([device('1')]);
      let down = true;
      flaky.listDevices = async () => {
        if (down) throw new Error('x');
        return [device('1')];
      };
      const composite = new CompositeIotManager(
        [
          { prefix: 'hue', manager: flaky },
          { prefix: 'govee', manager: new FakeManager([device('2')]) },
        ],
        onError,
        onRecover,
      );
      await composite.listDevices();
      await composite.listDevices();
      expect(onError).toHaveBeenCalledTimes(1);
      down = false;
      await composite.listDevices();
      expect(onRecover).toHaveBeenCalledWith('hue');
      expect(composite.listFailures()).toEqual([]);
      down = true;
      await composite.listDevices();
      expect(onError).toHaveBeenCalledTimes(2);
    });
  });
});
