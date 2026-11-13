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
    readings: [],
    ...over,
  };
}

function setup(initial: IotDevice[], reportsFailures = true) {
  let devices = initial;
  let failures: { prefix: string; message: string }[] = [];
  const iot = {
    listDevices: async () => devices,
    ...(reportsFailures ? { listFailures: () => failures } : {}),
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
  return {
    watcher,
    events,
    setDevices: (d: IotDevice[]) => (devices = d),
    setFailures: (prefixes: string[]) =>
      (failures = prefixes.map((prefix) => ({ prefix, message: 'caído' }))),
  };
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
    const sensor = device({
      id: 's',
      kind: 'sensor',
      on: null,
      readings: [{ metric: 'temperature', value: 20, unit: '°C' }],
    });
    const { watcher, events, setDevices } = setup([sensor]);
    await watcher.tick();
    setDevices([{ ...sensor, readings: [{ metric: 'temperature', value: 25, unit: '°C' }] }]);
    await watcher.tick();
    expect(events).toEqual([
      { type: 'sensor-reading', deviceId: 's', metric: 'temperature', value: 25, prevValue: 20 },
    ]);

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

  it('un aparato que vuelve tras un corte parcial conserva su línea base y publica su cambio', async () => {
    const a = device({
      id: 'hue:a',
      kind: 'contact',
      on: null,
      readings: [{ metric: 'contact', value: 0, unit: '' }],
    });
    const b = device({ id: 'govee:b' });
    const { watcher, events, setDevices, setFailures } = setup([a, b]);
    await watcher.tick();
    setDevices([b]); // el backend de A cae: la lista llega parcial
    setFailures(['hue']);
    await watcher.tick();
    setFailures([]);
    setDevices([
      { ...a, readings: [{ metric: 'contact', value: 1, unit: '' }] }, // se abrió durante el corte
      b,
    ]);
    await watcher.tick();
    expect(events).toEqual([
      { type: 'sensor-reading', deviceId: 'hue:a', metric: 'contact', value: 1, prevValue: 0 },
    ]);
  });

  const abierto = (id: string, value: number) =>
    device({
      id,
      kind: 'contact',
      on: null,
      readings: [{ metric: 'contact', value, unit: '' }],
    });

  it('un aparato que desaparece con todos los backends sanos se olvida: al volver es un alta nueva', async () => {
    const { watcher, events, setDevices } = setup([abierto('hue:a', 0), device({ id: 'govee:b' })]);
    await watcher.tick();
    setDevices([device({ id: 'govee:b' })]); // lo borraron: ningún backend caído
    await watcher.tick();
    setDevices([abierto('hue:a', 1), device({ id: 'govee:b' })]); // reaparece con otro estado
    await watcher.tick();
    expect(events).toEqual([]);
  });

  it('con un backend caído, el aparato de OTRO backend sano que desaparece sí se olvida', async () => {
    const { watcher, events, setDevices, setFailures } = setup([
      abierto('hue:a', 0),
      abierto('govee:b', 0),
    ]);
    await watcher.tick();
    setDevices([]); // hue cae (lista parcial) y govee, sano, ya no tiene b
    setFailures(['hue']);
    await watcher.tick();
    setFailures([]);
    setDevices([abierto('hue:a', 1), abierto('govee:b', 1)]);
    await watcher.tick();
    // a conservó su base (hue estaba caído) y dispara; b se olvidó y es alta nueva
    expect(events).toEqual([
      { type: 'sensor-reading', deviceId: 'hue:a', metric: 'contact', value: 1, prevValue: 0 },
    ]);
  });

  it('si el manager no reporta fallos, conserva la línea base de lo que falta', async () => {
    const { watcher, events, setDevices } = setup([abierto('hue:a', 0)], false);
    await watcher.tick();
    setDevices([]);
    await watcher.tick();
    setDevices([abierto('hue:a', 1)]);
    await watcher.tick();
    expect(events).toEqual([
      { type: 'sensor-reading', deviceId: 'hue:a', metric: 'contact', value: 1, prevValue: 0 },
    ]);
  });
});
