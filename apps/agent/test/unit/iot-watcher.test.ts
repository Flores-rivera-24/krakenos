import type { HomeEvent, IotDevice, IotManager } from '@krakenos/types';
import { describe, expect, it } from 'vitest';
import { HomeEventBus } from '../../src/automations/event-bus.js';
import { IotWatcher } from '../../src/automations/iot-watcher.js';

function device(over: Partial<IotDevice> & { id: string }): IotDevice {
  return {
    name: over.id,
    kind: 'light',
    room: null,
    reachable: true,
    on: false,
    brightness: null,
    color: null,
    reading: null,
    ...over,
  };
}

function setup(initial: IotDevice[]) {
  let devices = initial;
  const iot = {
    listDevices: async () => devices,
    getDevice: async () => null,
    setState: async () => {
      throw new Error('no aplica');
    },
  } as unknown as IotManager;
  const events: HomeEvent[] = [];
  const bus = new HomeEventBus();
  bus.subscribe((e) => {
    events.push(e);
  });
  const watcher = new IotWatcher(iot, bus);
  return { watcher, events, setDevices: (d: IotDevice[]) => (devices = d) };
}

/** Observador de transiciones IoT (US-167). */
describe('IotWatcher', () => {
  it('el primer barrido fija la línea base sin publicar nada', async () => {
    const { watcher, events } = setup([device({ id: 'a', on: true })]);
    await watcher.tick();
    expect(events).toHaveLength(0);
  });

  it('publica iot-on/iot-off al cambiar el estado', async () => {
    const { watcher, events, setDevices } = setup([device({ id: 'a', on: false })]);
    await watcher.tick();
    setDevices([device({ id: 'a', on: true })]);
    await watcher.tick();
    expect(events).toEqual([{ type: 'iot-on', deviceId: 'a' }]);

    setDevices([device({ id: 'a', on: false })]);
    await watcher.tick();
    expect(events[1]).toEqual({ type: 'iot-off', deviceId: 'a' });
  });

  it('publica sensor-reading con la lectura previa al cambiar el valor', async () => {
    const sensor = device({ id: 's', kind: 'sensor', on: null, reading: { metric: 'temperatura', value: 20 } });
    const { watcher, events, setDevices } = setup([sensor]);
    await watcher.tick();
    setDevices([{ ...sensor, reading: { metric: 'temperatura', value: 25 } }]);
    await watcher.tick();
    expect(events).toEqual([{ type: 'sensor-reading', deviceId: 's', value: 25, prevValue: 20 }]);

    // Sin cambio de valor → no publica.
    await watcher.tick();
    expect(events).toHaveLength(1);
  });

  it('un dispositivo nuevo en el snapshot no genera transición', async () => {
    const { watcher, events, setDevices } = setup([device({ id: 'a' })]);
    await watcher.tick();
    setDevices([device({ id: 'a' }), device({ id: 'b', on: true })]);
    await watcher.tick();
    expect(events).toHaveLength(0);
  });

  it('applyKnownState actualiza la base y devuelve la transición sin re-publicarla', async () => {
    const { watcher, events, setDevices } = setup([device({ id: 'a', on: false })]);
    await watcher.tick();

    // Una automatización enciende 'a': registra el estado conocido.
    const caused = watcher.applyKnownState(device({ id: 'a', on: true }));
    expect(caused).toEqual([{ type: 'iot-on', deviceId: 'a' }]);

    // El siguiente sondeo ve el mismo estado → NO re-publica la transición.
    setDevices([device({ id: 'a', on: true })]);
    await watcher.tick();
    expect(events).toHaveLength(0);
  });
});
