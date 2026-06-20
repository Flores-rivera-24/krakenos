import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryJsonStore } from '../../src/store/json-store.js';
import { TuyaIotManager } from '../../src/iot/tuya.iot.js';
import { toTuyaRecord, type TuyaDeviceRecord, type TuyaStore } from '../../src/iot/tuya.store.js';
import { MockTuyaTransport } from '../../src/iot/tuya.transport.js';

const DEV = {
  deviceId: 'dev-1',
  localKey: 'abcdef0123456789',
  ip: '192.168.1.80',
  name: 'Foco salón',
} as const;

async function seedStore(): Promise<TuyaStore> {
  const store = new MemoryJsonStore<TuyaDeviceRecord>();
  await store.upsert(toTuyaRecord(DEV));
  return store;
}

describe('TuyaIotManager', () => {
  let store: TuyaStore;
  let transport: MockTuyaTransport;
  let tuya: TuyaIotManager;

  beforeEach(async () => {
    store = await seedStore();
    transport = new MockTuyaTransport();
    tuya = new TuyaIotManager({ store, transport });
  });

  it('listDevices conecta a cada dispositivo del store y devuelve su estado', async () => {
    transport.states.set('dev-1', { '20': true, '22': 1000 });
    const devices = await tuya.listDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ id: 'dev-1', on: true, brightness: 100, reachable: true });
  });

  it('getDevice devuelve el dispositivo; null si no está en el store', async () => {
    expect(await tuya.getDevice('dev-1')).toMatchObject({ id: 'dev-1' });
    expect(await tuya.getDevice('no-existe')).toBeNull();
  });

  it('setState({ on: true }) escribe el DPS 20 correcto', async () => {
    await tuya.setState('dev-1', { on: true });
    expect(transport.setCalls).toContainEqual({ deviceId: 'dev-1', dps: { '20': true } });
  });

  it('setState({ brightness: 80 }) escala el brillo a DPS 22', async () => {
    await tuya.setState('dev-1', { brightness: 80 });
    expect(transport.setCalls).toContainEqual({ deviceId: 'dev-1', dps: { '22': 802 } });
  });

  it('un dispositivo offline devuelve el último estado con reachable: false', async () => {
    // Primera lectura con éxito → puebla la caché.
    transport.states.set('dev-1', { '20': true, '22': 1000 });
    await tuya.listDevices();
    // Ahora deja de responder.
    transport.offline.add('dev-1');
    const [device] = await tuya.listDevices();
    expect(device).toMatchObject({ id: 'dev-1', on: true, brightness: 100, reachable: false });
  });

  it('setState lanza IOT_NOT_FOUND si el dispositivo no está en el store', async () => {
    await expect(tuya.setState('no-existe', { on: true })).rejects.toMatchObject({
      code: 'IOT_NOT_FOUND',
    });
  });
});
