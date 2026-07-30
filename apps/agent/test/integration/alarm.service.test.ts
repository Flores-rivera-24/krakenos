import type { IotDevice, IotManager } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeEventBus } from '../../src/automations/event-bus.js';
import { AlarmPinError, AlarmService } from '../../src/modules/alarm/alarm.service.js';
import { buildTestApp, resetDb } from '../helpers/app.js';

/** IoT falso: registra setState y expone dispositivos con reachable configurable. */
class FakeIot implements IotManager {
  setCalls: { id: string; on?: boolean }[] = [];
  devices: IotDevice[] = [
    { id: 'siren', name: 'Sirena', kind: 'plug', room: null, reachable: true, on: false, brightness: null, color: null, reading: null },
    { id: 'sensor-door', name: 'Puerta', kind: 'sensor', room: null, reachable: true, on: null, brightness: null, color: null, reading: { metric: 'contact', value: 0, unit: '' } },
  ];
  async listDevices() {
    return this.devices;
  }
  async getDevice(id: string) {
    return this.devices.find((d) => d.id === id) ?? null;
  }
  async setState(id: string, input: { on?: boolean }) {
    this.setCalls.push({ id, on: input.on });
    return this.devices.find((d) => d.id === id)!;
  }
}

describe('AlarmService (US-188)', () => {
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

  const build = (iot: FakeIot, now: () => number) => {
    const bus = new HomeEventBus();
    const service = new AlarmService(app, iot, bus, { now });
    return { service, bus };
  };

  it('armar → disparo de cámara → entry → triggered enciende la sirena y audita', async () => {
    const iot = new FakeIot();
    let clock = 0;
    const { service, bus } = build(iot, () => clock);
    const auditSpy = vi.spyOn(app, 'audit').mockImplementation(() => {});
    service.start();
    await service.setConfig({ sirenDeviceId: 'siren', cameraIds: ['cam-1'], exitDelaySec: 0, entryDelaySec: 10 });

    await service.armAlarm('away', 'ana@x');
    expect(service.getStateSync().phase).toBe('armed');

    // Movimiento de una cámara vigilada → entra en la cuenta de entrada.
    bus.publish({ type: 'motion-detected', cameraId: 'cam-1', cameraName: 'Entrada' });
    await vi.waitFor(() => expect(service.getStateSync().phase).toBe('entry'));

    // Vence la entrada → dispara: sirena ON + auditoría.
    clock = 11_000;
    await service.tick();
    expect(service.getStateSync().phase).toBe('triggered');
    expect(iot.setCalls).toContainEqual({ id: 'siren', on: true });
    expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({ action: 'alarm.triggered' }));

    service.stop();
    auditSpy.mockRestore();
  });

  it('desarmar exige el PIN correcto (kid/guest no llegan aquí); apaga la sirena', async () => {
    const iot = new FakeIot();
    const { service } = build(iot, () => 0);
    vi.spyOn(app, 'audit').mockImplementation(() => {});
    await service.setConfig({ sirenDeviceId: 'siren', pin: '1234', exitDelaySec: 0, entryDelaySec: 0, cameraIds: ['cam-1'] });
    await service.armAlarm('away', 'ana@x');

    await expect(service.disarmAlarm('9999', 'ana@x')).rejects.toBeInstanceOf(AlarmPinError);
    await expect(service.disarmAlarm(undefined, 'ana@x')).rejects.toBeInstanceOf(AlarmPinError);

    const state = await service.disarmAlarm('1234', 'ana@x');
    expect(state.phase).toBe('disarmed');
    // Al desarmar tras estar activa, intenta apagar la sirena.
    expect(iot.setCalls).toContainEqual({ id: 'siren', on: false });
  });

  it('fail-safe: un sensor vigilado caído estando armada avisa una sola vez', async () => {
    const iot = new FakeIot();
    const { service } = build(iot, () => 0);
    const auditSpy = vi.spyOn(app, 'audit').mockImplementation(() => {});
    await service.setConfig({ sensorDeviceIds: ['sensor-door'], exitDelaySec: 0 });
    await service.armAlarm('away', 'ana@x');

    iot.devices.find((d) => d.id === 'sensor-door')!.reachable = false;
    await service.tick();
    await service.tick(); // segundo barrido: no repite el aviso
    const faults = auditSpy.mock.calls.filter((c) => c[0].action === 'alarm.sensor_fault');
    expect(faults).toHaveLength(1);
    expect(faults[0]![0].detail).toContain('Puerta');

    auditSpy.mockRestore();
  });

  it('el fail-safe no sondea el hardware en cada barrido de 1 s (US-229)', async () => {
    // El barrido corre cada segundo porque las cuentas atrás lo exigen, pero
    // consultaba el IoT en cada ciclo: 60 `listDevices()` por minuto solo desde
    // la alarma, de los ~71 que medía la auditoría (AUD3-18).
    const iot = new FakeIot();
    let clock = 0;
    const { service } = build(iot, () => clock);
    await service.setConfig({ sensorDeviceIds: ['sensor-door'], exitDelaySec: 0 });
    await service.armAlarm('away', 'ana@x');
    const listSpy = vi.spyOn(iot, 'listDevices');

    for (let i = 0; i < 10; i++) {
      clock += 1_000;
      await service.tick();
    }
    expect(listSpy).toHaveBeenCalledTimes(1);

    clock += 30_000; // pasada la ventana, vuelve a comprobar los sensores
    await service.tick();
    expect(listSpy).toHaveBeenCalledTimes(2);

    listSpy.mockRestore();
  });

  it('auto-armado: el hogar en modo away arma si autoArmAway está activo', async () => {
    const iot = new FakeIot();
    const { service, bus } = build(iot, () => 0);
    vi.spyOn(app, 'audit').mockImplementation(() => {});
    service.start();
    await service.setConfig({ autoArmAway: true, exitDelaySec: 0 });

    bus.publish({ type: 'mode-changed', mode: 'away', prevMode: 'home' });
    await vi.waitFor(() => expect(service.getStateSync().phase).toBe('armed'));
    expect(service.getStateSync().mode).toBe('away');
    service.stop();
  });

  it('el estado se persiste y se rehidrata (reconcile) al reiniciar', async () => {
    const iot = new FakeIot();
    const { service } = build(iot, () => 0);
    vi.spyOn(app, 'audit').mockImplementation(() => {});
    await service.setConfig({ exitDelaySec: 0 });
    await service.armAlarm('night', 'ana@x');

    const fresh = new AlarmService(app, iot, new HomeEventBus(), { now: () => 0 });
    expect(fresh.getStateSync().phase).toBe('disarmed');
    await fresh.reconcile();
    expect(fresh.getStateSync().phase).toBe('armed');
    expect(fresh.getStateSync().mode).toBe('night');
  });
});
